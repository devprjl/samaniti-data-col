# SPDX-License-Identifier: MIT
"""
Flask HTTP interface for the OCR service.

Exposes health, queue inspection, and manual enqueueing. The web application does
not call this -- the scraper pushes straight onto the Redis queue -- so it
exists for operating the service and for backfilling the backlog by hand.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import threading

import redis
from flask import Flask, jsonify, request

import db
import settings
from ocr.config import ENGINE_NAME, describe_device

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [ocr-server] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("ocr-server")

QUEUE_NAME = os.environ.get("OCR_QUEUE_NAME", "ocr:jobs")

app = Flask(__name__)


def get_redis_client() -> redis.Redis:
    return redis.Redis.from_url(
        settings.require("REDIS_URL"), decode_responses=True
    )


@app.route("/health", methods=["GET"])
def health_check():
    """
    Reports whether the service can actually do work.

    Both dependencies are checked for real: a Redis PING and a database query,
    not just that the process is alive. Redis and Postgres are separate
    containers and either can be down while this one is fine.
    """
    try:
        redis_ok = bool(get_redis_client().ping())
    except Exception as exc:
        redis_ok = False
        logger.warning(f"Redis ping failed: {exc}")

    try:
        db.get_pending_documents(1)
        db_ok = True
    except Exception as exc:
        db_ok = False
        logger.warning(f"Database query failed: {exc}")

    healthy = redis_ok and db_ok
    return jsonify(
        {
            "status": "healthy" if healthy else "degraded",
            "redis": "connected" if redis_ok else "disconnected",
            "database": "connected" if db_ok else "disconnected",
            "engine": ENGINE_NAME,
            "device": describe_device(),
        }
    ), (200 if healthy else 503)


@app.route("/queue", methods=["GET"])
def get_queue_status():
    client = get_redis_client()
    return jsonify(
        {
            "queue": QUEUE_NAME,
            "pending_count": client.llen(QUEUE_NAME),
        }
    )


@app.route("/jobs", methods=["POST"])
def enqueue_job():
    """Queues one document given explicitly. Does not touch the database."""
    payload = request.get_json(silent=True) or {}
    document_id = payload.get("document_id")
    source_url = payload.get("source_url")

    if not document_id or not source_url:
        return jsonify({"error": "document_id and source_url are required"}), 400

    job = {
        "document_id": document_id,
        "source_url": source_url,
        "file_name": payload.get("file_name", "document.pdf"),
        "max_pages": payload.get("max_pages"),
        "scale": payload.get("scale", 2.0),
    }
    get_redis_client().lpush(QUEUE_NAME, json.dumps(job))
    return jsonify({"status": "queued", "job": job}), 202


@app.route("/jobs/enqueue-pending", methods=["POST"])
def enqueue_pending_jobs():
    """
    Queues a batch of documents that still need OCR.

    Uses the same atomic claim as the Node producer, so calling this twice does
    not queue the same documents twice: the first call moves them to "queued" and
    the second does not select them again.
    """
    payload = request.get_json(silent=True) or {}
    try:
        limit = max(1, min(int(payload.get("limit", 100)), 5000))
    except (TypeError, ValueError):
        return jsonify({"error": "limit must be an integer"}), 400

    claimed = db.claim_pending_documents(limit=limit)
    if not claimed:
        return jsonify({"message": "No pending documents found", "queued_count": 0}), 200

    client = get_redis_client()
    pipeline = client.pipeline()
    for doc in claimed:
        pipeline.lpush(
            QUEUE_NAME,
            json.dumps(
                {
                    "document_id": doc["id"],
                    "source_url": doc["original_url"],
                    "file_name": doc["file_name"],
                }
            ),
        )
    pipeline.execute()

    logger.info(f"Queued {len(claimed)} pending document(s) onto {QUEUE_NAME}")
    return jsonify(
        {
            "message": f"Successfully queued {len(claimed)} pending document(s)",
            "queued_count": len(claimed),
        }
    )


def start_background_worker() -> threading.Thread:
    """
    Runs the worker in a daemon thread beside the HTTP server.

    Only suitable when the service is the sole worker. Running several replicas
    with this enabled is safe for correctness -- BRPOP hands each job to exactly
    one worker -- but it multiplies the CPU each OCR conversion competes for.
    """
    from worker import OcrWorker

    logger.info("Starting background OCR worker thread...")
    worker = OcrWorker()
    thread = threading.Thread(target=worker.run, daemon=True, name="OcrWorkerThread")
    thread.start()
    return thread


def main() -> None:
    parser = argparse.ArgumentParser(description="OCR Flask Service")
    parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", 5050)))
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument(
        "--with-worker",
        action="store_true",
        help="Run the queue worker in a background thread of this process",
    )
    args = parser.parse_args()

    if args.with_worker or os.environ.get("RUN_WORKER_IN_PROCESS") == "true":
        start_background_worker()

    app.run(host=args.host, port=args.port)


if __name__ == "__main__":
    main()
