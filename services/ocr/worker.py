# SPDX-License-Identifier: MIT
"""
Background OCR worker.

Pops document jobs off the Redis queue, runs docling OCR over each document, and
writes the extracted Markdown back into PostgreSQL. The Node scraper is the
producer; this is the only consumer.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import tempfile
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import redis
import requests

import db
import settings
from ocr.config import ENGINE_NAME, describe_device
from ocr.pipeline import build_converter, convert_document, count_pages

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [ocr-worker] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ocr-worker")

QUEUE_NAME = os.environ.get("OCR_QUEUE_NAME", "ocr:jobs")
EVENTS_CHANNEL = os.environ.get("OCR_EVENTS_CHANNEL", "ocr:events")

# The user-agent the government portals expect. Several of them answer a
# default urllib request with an error page rather than the file.
USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
)

DOWNLOAD_TIMEOUT_S = 120
# Several municipal hosts answer slowly or not at all. A dead host must not look
# like a slow one, or a single unreachable portal stalls the queue for an hour.
CONNECT_TIMEOUT_S = 20

# How long a single blocking pop waits before the loop checks its stop flag
# again, so Ctrl+C and SIGTERM are noticed promptly on an idle queue.
#
# This has to stay comfortably below the connection's socket timeout, which
# redis-py sets to DEFAULT_SOCKET_TIMEOUT (5s). A blocking pop that waits as long
# as the socket timeout races the server's own reply and raises TimeoutError
# instead of returning None -- `brpop(timeout=5)` fails every time while
# `brpop(timeout=2)` is reliable.
BRPOP_TIMEOUT_S = 2

OCR_SUFFIXES = (".pdf", ".jpg", ".jpeg", ".png", ".webp", ".tiff", ".bmp")


def get_redis_client() -> redis.Redis:
    return redis.Redis.from_url(
        settings.require("REDIS_URL"), decode_responses=True
    )


class OcrWorker:
    """Pulls documents off the queue, converts them, and saves the result."""

    def __init__(self):
        self.running = True
        self.redis_client = get_redis_client()

        logger.info(f"Connecting to Redis (Queue: {QUEUE_NAME})")
        self.redis_client.ping()

        logger.info(f"Device: {describe_device()}")
        logger.info("Loading EasyOCR and Docling models, please wait ...")
        # Built once and reused for every document. Building it again per job
        # would reload all the models each time.
        self.converter = build_converter()
        logger.info("Ready. Waiting for documents.")

    def stop(self) -> None:
        self.running = False

    def publish_event(self, event_type: str, data: dict[str, Any]) -> None:
        try:
            payload = json.dumps({"event": event_type, "timestamp": time.time(), **data})
            self.redis_client.publish(EVENTS_CHANNEL, payload)
        except Exception as exc:
            logger.warning(f"Failed to publish event {event_type}: {exc}")

    def _download_file(self, url: str) -> Path:
        """Downloads a document to a temporary file and returns its path."""
        resp = requests.get(
            url,
            headers={"User-Agent": USER_AGENT, "Accept": "*/*"},
            timeout=(CONNECT_TIMEOUT_S, DOWNLOAD_TIMEOUT_S),
            stream=True,
        )
        resp.raise_for_status()

        suffix = Path(urlparse(url).path).suffix.lower()
        if suffix not in OCR_SUFFIXES:
            suffix = ".pdf"

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            for chunk in resp.iter_content(chunk_size=65536):
                if chunk:
                    tmp.write(chunk)
        finally:
            tmp.close()
        return Path(tmp.name)

    def process_job(self, job_data: dict[str, Any]) -> bool:
        document_id = job_data.get("document_id")
        source_url = job_data.get("source_url")
        max_pages = job_data.get("max_pages")
        scale = float(job_data.get("scale", 2.0))

        if not document_id or not source_url:
            logger.error(f"Invalid job payload missing document_id or source_url: {job_data}")
            return False

        logger.info(f"Processing document {document_id}: {source_url}")
        db.update_document_status(document_id, db.STATUS_PROCESSING)
        self.publish_event("job_started", {"document_id": document_id, "source_url": source_url})

        temp_file_path: Path | None = None
        try:
            if source_url.startswith(("http://", "https://")):
                temp_file_path = self._download_file(source_url)
                input_source = str(temp_file_path)
            else:
                input_source = source_url

            # Record the page count measured from the file we just downloaded.
            # This is the authoritative number, and it is what makes the OCR queue's
            # shortest-document-first ordering converge: documents the pre-download
            # probe could not measure arrive here with no count, and this fills it in
            # for the next time they are considered.
            if str(input_source).lower().endswith(".pdf"):
                pages = count_pages(input_source)
                if pages:
                    try:
                        db.save_page_count(document_id, pages)
                        logger.info(f"Recorded {pages} page(s) for {document_id}")
                    except Exception as exc:
                        # Never fail a completed conversion over a bookkeeping write.
                        logger.warning(f"Could not record page count: {exc}")

            # This runs the three steps in ocr/pipeline.py: render each page to
            # an image, read it with EasyOCR, rebuild the layout with docling.
            start_t = time.time()
            markdown_content = convert_document(
                converter=self.converter,
                source=input_source,
                max_pages=int(max_pages) if (max_pages and int(max_pages) > 0) else None,
                scale=scale,
            )
            elapsed = time.time() - start_t

            logger.info(
                f"Successfully converted document {document_id} in {elapsed:.2f}s "
                f"(Length: {len(markdown_content)} chars)"
            )

            db.save_document_ocr(
                document_id=document_id,
                ocr_data=markdown_content,
                ocr_engine=ENGINE_NAME,
                status=db.STATUS_COMPLETED,
            )

            self.publish_event(
                "job_completed",
                {
                    "document_id": document_id,
                    "engine": ENGINE_NAME,
                    "duration_s": elapsed,
                    "char_count": len(markdown_content),
                },
            )
            return True

        except Exception as exc:
            err_msg = str(exc)
            logger.error(f"Failed processing document {document_id}: {err_msg}", exc_info=True)
            db.update_document_status(document_id, db.STATUS_FAILED, error=err_msg)
            self.publish_event("job_failed", {"document_id": document_id, "error": err_msg})
            return False

        finally:
            if temp_file_path and temp_file_path.exists():
                try:
                    temp_file_path.unlink()
                except OSError:
                    pass

    def run(self, max_jobs: int | None = None) -> None:
        logger.info(f"Worker listening on queue '{QUEUE_NAME}'. Press Ctrl+C to exit.")
        jobs_processed = 0

        while self.running:
            if max_jobs is not None and jobs_processed >= max_jobs:
                logger.info(f"Reached target limit of {max_jobs} jobs. Shutting down.")
                break

            try:
                # BRPOP blocks for up to `timeout` seconds and returns None, not
                # a pair, when nothing arrived. Unpacking before checking that
                # raises on every idle poll, which on a quiet queue means an
                # exception and a log line every few seconds, forever.
                item = self.redis_client.brpop(QUEUE_NAME, timeout=BRPOP_TIMEOUT_S)
                if item is None:
                    continue
                _, raw_payload = item

                try:
                    job_data = json.loads(raw_payload)
                except json.JSONDecodeError:
                    logger.error(f"Invalid JSON in queue: {raw_payload}")
                    continue

                self.process_job(job_data)
                jobs_processed += 1

            except redis.exceptions.TimeoutError:
                # A slow or half-open socket surfaced as a read timeout rather
                # than an empty pop. Nothing was lost: BRPOP either returns the
                # job or the reply never arrives, so just poll again.
                continue
            except redis.exceptions.ConnectionError as exc:
                logger.warning(f"Redis connection lost: {exc}. Retrying in 5 seconds...")
                time.sleep(5)
            except Exception as exc:
                logger.error(f"Unexpected error in worker loop: {exc}", exc_info=True)
                time.sleep(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="OCR queue worker: reads documents off the Redis queue and saves them as Markdown"
    )
    parser.add_argument("--limit", type=int, default=None, help="Process up to N jobs and exit")
    args = parser.parse_args()

    worker = OcrWorker()

    def _sig_handler(sig, frame):
        logger.info("Shutdown requested. Finishing up ...")
        worker.stop()

    signal.signal(signal.SIGINT, _sig_handler)
    signal.signal(signal.SIGTERM, _sig_handler)

    worker.run(max_jobs=args.limit)


if __name__ == "__main__":
    main()
