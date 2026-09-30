# SPDX-License-Identifier: MIT
"""
Database access for the OCR service, using psycopg v3 directly.

The OCR service is Python, so it does not go through Prisma. It talks to the same
`documents` table the scraper writes, and has to agree with Prisma on three
things: the column names (`original_url`, not `originalUrl`), the status
vocabulary, and the `?schema=public` suffix that DATABASE_URL carries.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit

import psycopg
from psycopg.rows import dict_row

import settings

# Statuses the Node side also knows about; see src/core/queue/types.ts. The
# worker owns "processing", "completed" and "failed"; the producers own "queued".
STATUS_PENDING = "pending"
STATUS_QUEUED = "queued"
STATUS_PROCESSING = "processing"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_SKIPPED = "skipped"


def get_database_url() -> str:
    """DATABASE_URL with Prisma's query parameters removed."""
    raw_url = settings.require("DATABASE_URL")

    # Prisma appends ?schema=public, which psycopg passes to the server as an
    # unknown startup parameter and refuses. Any other query parameters are kept.
    parsed = urlsplit(raw_url)
    if not parsed.query:
        return raw_url

    query_params = parse_qs(parsed.query)
    query_params.pop("schema", None)
    return urlunsplit(
        (
            parsed.scheme,
            parsed.netloc,
            parsed.path,
            urlencode(query_params, doseq=True),
            parsed.fragment,
        )
    )


@contextmanager
def get_db_cursor(commit: bool = True) -> Iterator[psycopg.Cursor]:
    conn = psycopg.connect(get_database_url(), row_factory=dict_row)
    try:
        with conn.cursor() as cur:
            yield cur
        if commit:
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_document(document_id: str) -> dict[str, Any] | None:
    """Retrieve a document by ID."""
    with get_db_cursor(commit=False) as cur:
        cur.execute(
            """
            SELECT id, file_name, file_type, original_url, storage_path,
                   policy_entity_id, ocr_status, ocr_data, ocr_error, ocr_engine
            FROM documents WHERE id = %s
            """,
            (document_id,),
        )
        return cur.fetchone()


def update_document_status(
    document_id: str, status: str, error: str | None = None
) -> None:
    """Update a document's OCR lifecycle status."""
    with get_db_cursor() as cur:
        cur.execute(
            """
            UPDATE documents
            SET ocr_status = %s, ocr_error = %s, updated_at = NOW()
            WHERE id = %s
            """,
            (status, error, document_id),
        )


def save_document_ocr(
    document_id: str,
    ocr_data: str,
    ocr_engine: str,
    status: str = STATUS_COMPLETED,
) -> None:
    """
    Store the extracted Markdown and close out the document's OCR lifecycle.

    The status travels in the same statement as the text on purpose. Writing the
    text and the status separately is what produced rows that held real OCR
    output while still reading "pending", because a run that was interrupted
    between the two writes left the document looking unprocessed forever.
    """
    with get_db_cursor() as cur:
        cur.execute(
            """
            UPDATE documents
            SET ocr_data = %s,
                ocr_status = %s,
                ocr_engine = %s,
                ocr_error = NULL,
                ocr_completed_at = NOW(),
                updated_at = NOW()
            WHERE id = %s
            """,
            (ocr_data, status, ocr_engine, document_id),
        )


def get_pending_documents(limit: int = 50) -> list[dict[str, Any]]:
    """
    Fetch documents that still need OCR, read-only.

    This does not claim anything. It backs the queue-inspection and health
    endpoints, which must not change any state.
    """
    with get_db_cursor(commit=False) as cur:
        cur.execute(
            """
            SELECT id, file_name, file_type, original_url, storage_path
            FROM documents
            WHERE ocr_status = %s AND (ocr_data IS NULL OR ocr_data = '')
            ORDER BY created_at ASC
            LIMIT %s
            """,
            (STATUS_PENDING, limit),
        )
        return cur.fetchall()


def ocr_status_counts() -> dict[str, int]:
    """Documents grouped by OCR status, for the sweep tool's report."""
    with get_db_cursor(commit=False) as cur:
        cur.execute("SELECT ocr_status, COUNT(*) AS n FROM documents GROUP BY ocr_status")
        return {row["ocr_status"]: row["n"] for row in cur.fetchall()}


def mark_skipped(
    document_ids: list[str], reasons: dict[str, str]
) -> int:
    """
    Writes "skipped" plus the reason to documents that are still "pending".

    The `ocr_status = 'pending'` guard is what keeps this safe to run against a
    live queue: a document the worker has already picked up is left alone, so a
    sweep can never overwrite a real result with a skip.
    """
    if not document_ids:
        return 0

    with get_db_cursor() as cur:
        cur.executemany(
            """
            UPDATE documents
            SET ocr_status = %(skipped)s,
                ocr_error = %(reason)s,
                updated_at = NOW()
            WHERE id = %(id)s AND ocr_status = %(pending)s
            """,
            [
                {
                    "id": doc_id,
                    "reason": reasons.get(doc_id, ""),
                    "skipped": STATUS_SKIPPED,
                    "pending": STATUS_PENDING,
                }
                for doc_id in document_ids
            ],
        )
        return cur.rowcount


# Must match the Node producer in src/core/queue/ocr-producer.ts. A job left in
# "queued" this long was lost; a document left in "processing" this long means
# the worker was killed mid-conversion. Both are handed back out, otherwise a
# single kill would strand documents permanently.
STALE_QUEUED_MINUTES = 60
STALE_PROCESSING_MINUTES = 360


def claim_pending_documents(limit: int = 50) -> list[dict[str, Any]]:
    """
    Atomically move eligible documents from "pending" to "queued" and return them.

    This is what makes queueing idempotent, and it is the same claim the Node
    producer performs. Without it this endpoint queued the same backlog on every
    call, so calling it twice in a row filled the queue with duplicate work.

    FOR UPDATE SKIP LOCKED lets concurrent claimers skip rows another claimer is
    holding instead of blocking, and RETURNING reports only the rows this
    statement actually took.
    """
    with get_db_cursor() as cur:
        cur.execute(
            """
            WITH claimable AS (
                SELECT d.id
                FROM documents d
                WHERE (
                        (d.ocr_status = %(pending)s
                         AND (d.ocr_data IS NULL OR d.ocr_data = ''))
                     OR (d.ocr_status = %(queued)s
                         AND d.updated_at
                             < NOW() - make_interval(mins => %(stale_queued)s))
                     OR (d.ocr_status = %(processing)s
                         AND d.updated_at
                             < NOW() - make_interval(mins => %(stale_processing)s))
                )
                ORDER BY d.created_at ASC
                LIMIT %(limit)s
                FOR UPDATE SKIP LOCKED
            )
            UPDATE documents AS d
            SET ocr_status = %(queued)s, updated_at = NOW()
            FROM claimable
            WHERE d.id = claimable.id
            RETURNING d.id, d.file_name, d.file_type, d.original_url
            """,
            {
                "pending": STATUS_PENDING,
                "queued": STATUS_QUEUED,
                "processing": STATUS_PROCESSING,
                "stale_queued": STALE_QUEUED_MINUTES,
                "stale_processing": STALE_PROCESSING_MINUTES,
                "limit": limit,
            },
        )
        return cur.fetchall()
