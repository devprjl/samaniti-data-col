# SPDX-License-Identifier: MIT
"""
Environment loading shared by every entry point (main, worker, server, db).

Each of those modules needs DATABASE_URL and REDIS_URL before it does anything,
and each used to carry its own copy of the "find the .env" loop. The copies
drifted and the relative candidates were wrong: `../../.env` is only the
repository root when the process happens to be started from a two-deep
directory, so running the CLI from the repository root or from `/` silently
picked up an unrelated file or none at all.

This module resolves the file once, relative to this file's own location, so the
result does not depend on the working directory.
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

# settings.py -> services/ocr -> services -> repository root
SERVICE_DIR = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_DIR.parent.parent


def load_env() -> Path | None:
    """
    Loads the first .env that exists and returns its path.

    Real environment variables always win: load_dotenv does not override what is
    already set, which is what lets a container be configured through the
    environment while a developer runs against the repository's .env.
    """
    for candidate in (SERVICE_DIR / ".env", REPO_ROOT / ".env"):
        if candidate.is_file():
            load_dotenv(candidate)
            return candidate
    return None


ENV_FILE = load_env()


def require(name: str) -> str:
    """Returns an environment variable, or explains which file to put it in."""
    value = os.environ.get(name)
    if value:
        return value
    raise RuntimeError(
        f"[ocr] {name} is not set. Put it in {ENV_FILE or 'the environment'} "
        f"(see .env.example) or export it."
    )
