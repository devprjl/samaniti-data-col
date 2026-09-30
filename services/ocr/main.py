# SPDX-License-Identifier: MIT
"""
main.py - CLI entry point for OCR Robust.

    python main.py <source> [options]

The engine is chosen at runtime from what is actually installed and usable, so
the same command works on a workstation, a laptop, a CPU-only server, or in a
container. Nothing here depends on a specific GPU model.

Run `python main.py --help` for options, or see README.md.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from ocr.config import (
    ENGINES,
    VLM_MODELS,
    profile_hardware,
    ready_engines,
    unavailable_reasons,
)
from ocr.pipeline import build_converter, convert_document
from ocr.utils import get_base_name, get_local_artifacts_path


def _banner(source: str, engine: str, hw) -> None:
    avail = ", ".join(ready_engines()) or "none"
    print(
        f"\nOCR Robust\n"
        f"  source   : {source}\n"
        f"  engine   : {engine}\n"
        f"  device   : {hw.summary}\n"
        f"  engines  : {avail}\n",
        file=sys.stderr,
    )


def _report_missing() -> None:
    """Explain, per engine, why it cannot be used here."""
    reasons = unavailable_reasons()
    optional = {k: v for k, v in reasons.items() if k in ("paddleocr", "suryaocr")}
    if not optional:
        return
    print("[setup] engines unavailable on this machine:", file=sys.stderr)
    for engine, why in optional.items():
        print(f"          {engine}: {why}", file=sys.stderr)
    print(
        "[setup] continuing with the engines that are usable "
        "(override with --engine).\n",
        file=sys.stderr,
    )


def run_ocr(
    source: str,
    engine: str = "auto",
    model: str | None = None,
    max_pages: int | None = None,
    cache_dir: str = ".cache",
    images_scale: float = 2.0,
    prefer_device: str | None = None,
) -> None:
    """
    Run OCR on a PDF or image and write the Markdown to the output directory.

    engine:       'auto' | 'paddleocr' | 'suryaocr' | 'easyocr' | 'vlm'
    model:        VLM preset, only used by engine='vlm'
    images_scale: page render multiplier (1.0 ~72 DPI, 2.0 ~150 DPI, 3.0 ~216 DPI)
    """
    hw = profile_hardware(prefer_device)

    converter, label = build_converter(
        engine=engine,
        model=model,
        artifacts_path=get_local_artifacts_path(cache_dir),
        cache_dir=cache_dir,
        images_scale=images_scale,
        prefer_device=prefer_device,
    )
    _banner(source, label, hw)
    _report_missing()

    print("[ocr] converting (rendered image pipeline)...", file=sys.stderr)
    try:
        markdown_text = convert_document(
            converter=converter,
            source=source,
            max_pages=max_pages,
            images_scale=images_scale,
        )
    except Exception as exc:
        print(f"[error] conversion failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc

    output_dir = Path(
        os.environ.get("OCR_OUTPUT_DIR", Path(__file__).parent.resolve() / "output")
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    base_name = get_base_name(source)
    if base_name in ("", "pdf"):
        base_name = "document"

    md_path = output_dir / f"{base_name}_{label}.md"
    md_path.write_text(markdown_text, encoding="utf-8")
    print(f"done: {md_path}", file=sys.stderr)
    print("-" * 56, file=sys.stderr)
    print(markdown_text[:1200])
    return


def main() -> None:
    engine_help = ["OCR engines (auto-detected; 'auto' picks the best available):", ""]
    for name, meta in ENGINES.items():
        engine_help.append(f"  {name:<11} {meta['blurb']}")
    engine_help += [
        "",
        "Only installed engines are selectable; anything else falls back",
        "automatically. PaddleOCR and SuryaOCR need an extra native runtime:",
        "  pip install paddlepaddle paddleocr     # PaddleOCR",
        "  pip install surya-ocr                  # SuryaOCR",
    ]

    parser = argparse.ArgumentParser(
        prog="main.py",
        description="OCR Robust - multilingual OCR for Nepali / Hindi / English documents",
        epilog="\n".join(engine_help),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("source", help="Path or URL to a PDF or image")
    parser.add_argument(
        "--engine",
        choices=["auto", "paddleocr", "suryaocr", "easyocr", "vlm"],
        default="auto",
        help="OCR engine to use (default: auto).",
    )
    parser.add_argument(
        "--model",
        choices=sorted(VLM_MODELS),
        default=None,
        help="VLM preset; only used with --engine vlm (default: auto-sized).",
    )
    parser.add_argument(
        "--scale",
        type=float,
        default=2.0,
        metavar="FLOAT",
        help="Render multiplier: 1.0~72DPI, 2.0~150DPI (default), 3.0~216DPI.",
    )
    parser.add_argument(
        "--max-pages", type=int, default=None, metavar="N", help="Limit PDF pages."
    )
    parser.add_argument(
        "--cache-dir", default=".cache", metavar="DIR", help="Model cache directory."
    )
    parser.add_argument(
        "--device",
        choices=["cpu", "cuda", "mps"],
        default=None,
        help="Force a device. Unavailable requests fall back to auto.",
    )

    args = parser.parse_args()
    run_ocr(
        source=args.source,
        engine=args.engine,
        model=args.model,
        max_pages=args.max_pages,
        cache_dir=args.cache_dir,
        images_scale=args.scale,
        prefer_device=args.device,
    )


if __name__ == "__main__":
    main()
