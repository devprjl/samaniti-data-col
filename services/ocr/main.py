# SPDX-License-Identifier: MIT
"""
main.py - Try the OCR on a single document from the command line.

    python main.py <source> [options]

This is the easy way to check that a document comes out right. The unattended
version is worker.py, which reads jobs off a queue instead.

How it works: PDF -> image -> EasyOCR reads the words -> Docling rebuilds the
layout -> Markdown. See ocr/pipeline.py for the details.
"""

import argparse
import os
from pathlib import Path

from ocr.config import ENGINE_NAME, describe_device
from ocr.pipeline import DEFAULT_IMAGE_SCALE, build_converter, convert_document
from ocr.utils import get_base_name


def run_ocr(source, max_pages=None, scale=DEFAULT_IMAGE_SCALE):
    """
    Run OCR on one PDF or image and save the Markdown next to this file.

    source:     path to a PDF or image (PNG, JPG, TIFF, WEBP)
    max_pages:  stop after this many pages, or None for all of them
    scale:      image sharpness; 2.0 is normal, 3.0 for small or faded print

    Nothing is written to the database from here. Only worker.py does that.
    """
    print(f"\nOCR - EasyOCR\n  source: {source}\n  device: {describe_device()}\n")

    converter = build_converter(scale=scale)
    print("[ocr] converting ...")

    try:
        markdown_text = convert_document(
            converter=converter,
            source=source,
            max_pages=max_pages,
            scale=scale,
        )
    except Exception as exc:
        print(f"[error] conversion failed: {exc}")
        raise SystemExit(1) from exc

    # Where to save. OCR_OUTPUT_DIR overrides the default location.
    output_dir = Path(os.environ.get("OCR_OUTPUT_DIR", Path(__file__).parent / "output"))
    output_dir.mkdir(parents=True, exist_ok=True)

    # Use the document's own name for the file, so it is easy to find later.
    file_name = get_base_name(source)
    output_file = output_dir / f"{file_name}_{ENGINE_NAME}.md"
    output_file.write_text(markdown_text, encoding="utf-8")

    print(f"\ndone: {output_file}")
    print("-" * 56)
    print(markdown_text[:1200])


def main():
    parser = argparse.ArgumentParser(
        prog="main.py",
        description="Convert one PDF or image to Markdown using EasyOCR",
    )
    parser.add_argument("source", help="Path to a PDF or image")
    parser.add_argument(
        "--scale",
        type=float,
        default=DEFAULT_IMAGE_SCALE,
        metavar="FLOAT",
        help="Image sharpness: 1.0=72dpi, 2.0=150dpi (default), 3.0=216dpi",
    )
    parser.add_argument(
        "--max-pages", type=int, default=None, metavar="N", help="Only read N pages"
    )

    args = parser.parse_args()

    run_ocr(source=args.source, max_pages=args.max_pages, scale=args.scale)


if __name__ == "__main__":
    main()
