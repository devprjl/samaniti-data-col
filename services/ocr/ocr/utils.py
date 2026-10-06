"""
ocr/utils.py - Turning a document's name into a safe file name.

Documents arrive from government websites, so their names are messy: they can be
full of percent-encoding ("%E0%A4%B8"), or characters a filesystem will not
accept. This cleans that up so we can name the output file after the source.
"""

from __future__ import annotations

import re
from pathlib import PurePosixPath
from urllib.parse import unquote

# ext4 and APFS cap a name at 255 *bytes*; save_outputs() then appends
# "_<engine>.md" on top. 200 leaves comfortable room for that suffix.
MAX_STEM_BYTES = 200


def _decode_percent(raw: str, max_passes: int = 3) -> str:
    """
    Fully percent-decode a name, the way JavaScript's decodeURIComponent()
    handles one layer.

    Some sources -- re-saved links, redirect chains, exporters that re-escape
    -- arrive double- or triple-encoded, so decoding repeats until the text
    stops changing. A "%" that survives every pass is either a literal percent
    sign or an escape that is not valid UTF-8; both read as encoding noise in a
    filename, so they are dropped rather than carried into the output.
    """
    name = raw
    for _ in range(max_passes):
        decoded = unquote(name)
        if decoded == name:
            break
        name = decoded
    return name.replace("%", "")


def _truncate_bytes(name: str, max_bytes: int) -> str:
    """Cut to a byte budget without splitting a multi-byte character."""
    encoded = name.encode("utf-8")
    if len(encoded) <= max_bytes:
        return name
    return encoded[:max_bytes].decode("utf-8", errors="ignore")


def sanitize_filename(raw: str, max_bytes: int = MAX_STEM_BYTES) -> str:
    """
    Turn a source name into a filesystem-safe stem.

    Percent-encoding is decoded (see _decode_percent), characters that are
    unsafe on any major filesystem are replaced, and the result is truncated
    to a UTF-8 *byte* budget rather than a character count: the filesystem
    limit is in bytes, and Devanagari text spends three bytes per character,
    so a 100-character cap on Nepali names overruns it.
    """
    name = _decode_percent(raw)
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name)
    name = name.strip(". ")
    return _truncate_bytes(name, max_bytes).strip(". ") or "document"


def get_base_name(source: str) -> str:
    """
    Extract a safe base filename stem from a file path or URL.
    Handles:
      - Local paths:   /path/to/file.pdf            → file
      - URL with stem: https://example.com/doc.pdf  → doc
      - URL-encoded:   .../%E0%A4%B8...              → स्थानीय...
      - Re-encoded:    .../%25E0%25A4%25B8...        → स्थानीय...
    """
    clean = source.split("?")[0]
    stem = PurePosixPath(clean).stem
    return sanitize_filename(stem) or "document"
