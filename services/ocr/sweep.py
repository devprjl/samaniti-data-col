# SPDX-License-Identifier: MIT
"""
Backlog triage for documents the OCR service cannot process.

    python sweep.py unreachable --limit 500 --dry-run
    python sweep.py unreachable --limit 500 --mark
    python sweep.py stats

Why this exists
---------------
Roughly four out of five queued documents point at a host that no longer
responds. These are small municipal portals; some were decommissioned and never
came back. The worker's download then fails, the document is marked "failed",
and it sits there -- which looks like a backlog of work while being neither
processable nor interesting.

Marking them "skipped" with the reason recorded separates "we have not gotten to
this yet" from "this can never be processed", so the real backlog is visible and
the queue stops spending its time on dead hosts.

"failed" is deliberately left alone. A failure is evidence about one attempt; a
host being unreachable now says nothing about whether it was reachable when the
portal was alive, and the document may be worth re-trying later. This tool only
writes "skipped", and only to documents that are still "pending".
"""

from __future__ import annotations

import argparse
import logging
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from typing import Any
from urllib.parse import urlparse

import requests

import db
import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [ocr-sweep] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ocr-sweep")

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

# Short on purpose. A host that has not answered in this long is not going to
# answer during a sweep, and 3474 documents at a long timeout would take days.
CONNECT_TIMEOUT_S = 5
READ_TIMEOUT_S = 10

# Skipped documents are reclaimed by the producers the same way stranded jobs
# are, so a portal that comes back to life can be re-queued later.
SKIP_REASON = "{reason} (swept {when})"

MAX_WORKERS = 24


def _skip_reason(doc: dict[str, Any]) -> str | None:
    """Returns why this document cannot be fetched, or None if it can."""
    url = doc.get("original_url") or ""
    if not url.startswith(("http://", "https://")):
        return SKIP_REASON.format(reason="original_url is not an http(s) URL", when="")

    try:
        resp = requests.head(
            url,
            headers={"User-Agent": USER_AGENT},
            timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
            allow_redirects=True,
        )
        # Some of these portals answer HEAD with 405 while serving GET fine, so
        # a refusal to answer the cheap request is not itself a verdict.
        if resp.status_code < 400:
            return None
        if resp.status_code not in (403, 405, 501):
            return SKIP_REASON.format(reason=f"HTTP {resp.status_code}", when="")
    except requests.exceptions.SSLError:
        return SKIP_REASON.format(reason="TLS handshake failed", when="")
    except requests.exceptions.ConnectTimeout:
        return SKIP_REASON.format(reason="host did not accept a connection", when="")
    except requests.exceptions.ReadTimeout:
        return SKIP_REASON.format(reason="host accepted but never answered", when="")
    except requests.exceptions.ConnectionError as exc:
        return SKIP_REASON.format(reason=f"connection failed: {str(exc)[:80]}", when="")
    except requests.RequestException as exc:
        return SKIP_REASON.format(reason=f"request failed: {str(exc)[:80]}", when="")

    # HEAD was refused or unhelpful; fall back to a ranged GET, which is what the
    # worker actually does.
    try:
        resp = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Range": "bytes=0-0"},
            timeout=(CONNECT_TIMEOUT_S, READ_TIMEOUT_S),
            allow_redirects=True,
            stream=True,
        )
    except requests.RequestException as exc:
        return SKIP_REASON.format(reason=f"unreachable: {str(exc)[:80]}", when="")

    if resp.status_code >= 400:
        return SKIP_REASON.format(reason=f"HTTP {resp.status_code}", when="")
    return None


def sweep_unreachable(limit: int, mark: bool) -> None:
    candidates = db.get_pending_documents(limit=limit)
    if not candidates:
        logger.info("Nothing pending.")
        return

    logger.info(f"Probing {len(candidates)} pending document(s)...")

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        reasons = list(pool.map(_skip_reason, candidates))

    by_host: Counter[str] = Counter()
    by_reason: Counter[str] = Counter()
    doomed: list[tuple[str, str]] = []

    for doc, reason in zip(candidates, reasons, strict=True):
        if reason is None:
            continue
        host = urlparse(doc.get("original_url") or "").hostname or "(none)"
        by_host[host] += 1
        by_reason[reason.split(" (swept")[0]] += 1
        doomed.append((doc["id"], reason))

    total = len(candidates)
    logger.info(f"{total - len(doomed)}/{total} reachable, {len(doomed)} unreachable.")
    for host, count in by_host.most_common(12):
        logger.info(f"    {count:>5}  {host}")
    for reason, count in by_reason.most_common():
        logger.info(f"    {count:>5}  {reason}")

    if not mark:
        logger.info("Dry run. Pass --mark to write 'skipped' to those documents.")
        return

    skipped = db.mark_skipped(
        [doc_id for doc_id, _ in doomed],
        {doc_id: reason for doc_id, reason in doomed},
    )
    logger.info(f"Marked {skipped} document(s) as skipped.")


def show_stats() -> None:
    counts = db.ocr_status_counts()
    total = sum(counts.values())
    logger.info(f"{total} document(s) total")
    for status, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        logger.info(f"    {count:>6}  {status}")
    claimed = counts.get("queued", 0) + counts.get("processing", 0)
    if claimed:
        logger.info(
            f"    {claimed} document(s) are claimed but not finished. If no worker is "
            f"running they are reclaimed after the stale window and may be picked up again."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Triage the OCR backlog")
    sub = parser.add_subparsers(dest="command", required=True)

    unreachable = sub.add_parser(
        "unreachable", help="Mark documents whose host no longer responds as skipped"
    )
    unreachable.add_argument("--limit", type=int, default=500)
    unreachable.add_argument(
        "--mark", action="store_true", help="Write the result. Without this it only reports."
    )

    sub.add_parser("stats", help="Show the current OCR status breakdown")

    args = parser.parse_args()
    settings.load_env()

    if args.command == "unreachable":
        sweep_unreachable(limit=args.limit, mark=args.mark)
    elif args.command == "stats":
        show_stats()


if __name__ == "__main__":
    main()
