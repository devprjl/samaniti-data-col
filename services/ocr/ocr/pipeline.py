# SPDX-License-Identifier: MIT
"""
ocr/pipeline.py - DocumentConverter factory.

Builds a docling `DocumentConverter` for the requested OCR engine.

Why the engines all produce the same tables
-------------------------------------------
Only *text recognition* is delegated to the engine (Paddle / Surya / EasyOCR).
Layout analysis, cell matching and table structure stay inside docling's
standard pipeline via TableFormer. So switching engines changes the words that
come out, never the table markup. That is what makes the output comparable
across engines.

Why images are tagged rather than extracted
--------------------------------------------
`generate_picture_images` stays False, so no image bytes are written to disk,
and markdown export uses `ImageRefMode.PLACEHOLDER`, which emits a tag where
the picture was. Cost stays flat on low-memory machines.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from docling.datamodel.accelerator_options import AcceleratorOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    EasyOcrOptions,
    OcrMode,
    PdfPipelineOptions,
    TableFormerMode,
    TableStructureOptions,
    VlmConvertOptions,
    VlmPipelineOptions,
)
from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
from docling.pipeline.vlm_pipeline import VlmPipeline

from ocr.config import (
    EASYOCR_LANGS,
    PADDLEOCR_LANGS,
    SURYAOCR_LANGS,
    HardwareProfile,
    engine_hint,
    engine_readiness,
    profile_hardware,
    select_engine,
    suggest_model,
)
from ocr.engines import register_engines

_log = logging.getLogger(__name__)

ALLOWED_FORMATS = [InputFormat.PDF, InputFormat.IMAGE]

# Docling's own accelerator options, driven by the validated device.
_ACCEL_DEVICE = {"cuda": "cuda", "mps": "mps", "cpu": "cpu"}


def _accelerator(hw: HardwareProfile) -> AcceleratorOptions:
    """
    Map our validated hardware profile onto docling's accelerator options.

    Flash Attention 2 is left off deliberately: it is only valid on newer
    NVIDIA architectures, and a wrong guess here is a hard crash. Users on
    supported cards can opt in via DOCLING_CUDA_USE_FLASH_ATTENTION2=1.
    """
    try:
        return AcceleratorOptions(
            device=_ACCEL_DEVICE.get(hw.device, "cpu"),
            num_threads=hw.threads,
            cuda_use_flash_attention2=False,
        )
    except Exception as exc:  # pragma: no cover - defensive
        _log.debug("AcceleratorOptions rejected (%s); using defaults", exc)
        return AcceleratorOptions(device="cpu", num_threads=hw.threads)


def _ocr_options_for(engine: str, scale: float, hw: HardwareProfile):
    """
    Build the engine's own OcrOptions, registered with docling's factory.

    Raises RuntimeError when the engine is not installed, with a hint naming
    the exact package to install.
    """
    # Register before options are validated. The pipeline resolves the engine
    # through its own get_ocr_factory(allow_external_plugins=...) cache entry,
    # so registration covers every variant.
    register_engines()
    from ocr.engines import is_registered

    if engine in ("paddleocr", "suryaocr") and not is_registered(engine):
        raise RuntimeError(
            f"engine {engine!r} is not available in this environment "
            f"(install it with: pip install {engine_hint(engine)})"
        )

    if engine == "paddleocr":
        from ocr.engines.paddle_model import PaddleOcrOptions

        opts = PaddleOcrOptions(
            lang=list(PADDLEOCR_LANGS),
            mode=OcrMode.FULL_PAGE,
            scale=max(1.0, scale),
        )
    elif engine == "suryaocr":
        from ocr.engines.surya_model import SuryaOcrOptions

        opts = SuryaOcrOptions(
            lang=list(SURYAOCR_LANGS),
            mode=OcrMode.FULL_PAGE,
            scale=max(1.0, scale),
        )
    elif engine == "easyocr":
        opts = EasyOcrOptions(
            lang=list(EASYOCR_LANGS),
            mode=OcrMode.FULL_PAGE,
            use_gpu=hw.has_gpu,
            confidence_threshold=0.1,
            scale=max(1.0, scale),
        )
    else:
        # docling's own availability probe (easyocr, tesseract, rapidocr, ...)
        from docling.datamodel.pipeline_options import OcrAutoOptions

        opts = OcrAutoOptions(mode=OcrMode.FULL_PAGE)

    # Registration was verified above; return the engine-specific options.
    return opts


def _standard_converter(
    engine: str,
    artifacts_path: Path | None,
    hw: HardwareProfile,
    images_scale: float,
) -> DocumentConverter:
    """Classic docling pipeline: layout + TableFormer + the chosen OCR engine."""
    pdf_kwargs: dict = {}
    if artifacts_path:
        pdf_kwargs["artifacts_path"] = artifacts_path

    opts = PdfPipelineOptions(**pdf_kwargs)
    opts.do_ocr = True
    # Tables are always reconstructed: the user needs them rendered exactly.
    opts.do_table_structure = True
    opts.table_structure_options = TableStructureOptions(
        do_cell_matching=True,
        mode=TableFormerMode.ACCURATE,
    )
    opts.accelerator_options = _accelerator(hw)
    opts.images_scale = images_scale
    opts.ocr_options = _ocr_options_for(engine, images_scale, hw)

    # Do not extract image bytes: pictures become a placeholder tag in the
    # markdown instead. Keeps memory and output size predictable.
    opts.generate_picture_images = False
    opts.generate_table_images = False
    opts.generate_page_images = False

    return DocumentConverter(
        allowed_formats=ALLOWED_FORMATS,
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts),
        },
    )


def _vlm_converter(
    model: str,
    artifacts_path: Path | None,
    hw: HardwareProfile,
    images_scale: float,
) -> DocumentConverter:
    """Docling VLM pipeline: holistic layout/table understanding from a render."""
    from ocr.config import VLM_PRESET_ALIASES

    preset = VLM_PRESET_ALIASES.get(model, model)
    pipeline_opts = VlmPipelineOptions(
        vlm_options=VlmConvertOptions.from_preset(preset),
        accelerator_options=_accelerator(hw),
        images_scale=images_scale,
    )
    if artifacts_path:
        pipeline_opts.artifacts_path = artifacts_path

    return DocumentConverter(
        allowed_formats=ALLOWED_FORMATS,
        format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_cls=VlmPipeline, pipeline_options=pipeline_opts
            ),
            InputFormat.IMAGE: ImageFormatOption(
                pipeline_cls=VlmPipeline, pipeline_options=pipeline_opts
            ),
        },
    )


def build_converter(
    engine: str = "auto",
    model: str | None = None,
    artifacts_path: Path | None = None,
    cache_dir: str = ".cache",
    images_scale: float = 2.0,
    prefer_device: str | None = None,
) -> tuple[DocumentConverter, str]:
    """
    Build a converter and return (converter, effective_engine_label).

    engine: 'auto' | 'paddleocr' | 'suryaocr' | 'easyocr' | 'vlm'
        'auto' picks the best engine that is actually installed and usable on
        this machine. An explicitly requested engine that is unavailable falls
        back rather than crashing, and the fallback is reported on stderr.
    model: VLM preset, used only by the 'vlm' engine.
    """
    hw = profile_hardware(prefer_device)

    # 'auto' resolves against what is actually usable here.
    if engine == "auto":
        engine = select_engine("auto", hw)
        print(f"[Pipeline] engine=auto -> {engine}  (device: {hw.device})", file=sys.stderr)
    elif engine not in ("easyocr", "vlm"):
        # An explicitly requested engine that cannot run here degrades to
        # EasyOCR -- a known-good engine -- rather than to a bare converter,
        # which recognises no Devanagari and silently returns empty pages.
        ready, reason = engine_readiness(engine)
        if not ready:
            print(
                f"[Pipeline] engine {engine!r} unavailable: {reason}",
                file=sys.stderr,
            )
            print("[Pipeline] falling back to easyocr\n", file=sys.stderr)
            engine = "easyocr"

    if engine == "vlm":
        preset = model or suggest_model(hw)
        try:
            print(f"[Pipeline] VLM preset: {preset}  (device: {hw.device})", file=sys.stderr)
            return _vlm_converter(preset, artifacts_path, hw, images_scale), f"vlm_{preset}"
        except Exception as exc:
            print(f"[Pipeline] VLM unavailable ({exc}); falling back", file=sys.stderr)
            engine = "easyocr"

    try:
        print(
            f"[Pipeline] engine: {engine}  (device: {hw.device}, scale: {images_scale}x)",
            file=sys.stderr,
        )
        converter = _standard_converter(engine, artifacts_path, hw, images_scale)
        return converter, engine
    except Exception as exc:
        # Last resort: a bare converter still extracts embedded text.
        print(
            f"[Pipeline] engine {engine!r} failed to start ({exc}); using docling auto",
            file=sys.stderr,
        )
        opts = PdfPipelineOptions()
        opts.do_ocr = True
        opts.do_table_structure = True
        opts.accelerator_options = _accelerator(hw)
        opts.images_scale = images_scale
        opts.generate_picture_images = False
        return (
            DocumentConverter(
                allowed_formats=ALLOWED_FORMATS,
                format_options={
                    InputFormat.PDF: PdfFormatOption(pipeline_options=opts),
                    InputFormat.IMAGE: ImageFormatOption(pipeline_options=opts),
                },
            ),
            "docling",
        )


def convert_document(
    converter: DocumentConverter,
    source: str | Path,
    max_pages: int | None = None,
    images_scale: float = 2.0,
) -> str:
    """
    Converts a document (PDF or Image) into clean Markdown using DocumentConverter.

    For PDFs:
    Nepali government PDFs consistently feature legacy font encodings (e.g. Preeti
    font mappings) in their embedded text streams, which causes Docling's PDF parser
    to extract garbled ASCII symbols and misguide table cell matching.

    By rendering each PDF page directly to a high-resolution raster image first,
    the corrupted font layer is completely bypassed. The document converter then
    runs table extraction and OCR directly on the rendered pixels, generating
    accurate Devanagari text and structured markdown tables.
    """
    import tempfile

    import pypdfium2 as pdfium

    path = Path(source)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        pdf = pdfium.PdfDocument(path)
        total_pages = len(pdf)
        pages_to_process = min(total_pages, max_pages) if max_pages and max_pages > 0 else total_pages

        pages_md: list[str] = []
        for i in range(pages_to_process):
            page = pdf[i]
            image = page.render(scale=images_scale).to_pil()
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                tmp_path = Path(tmp.name)
            try:
                image.save(tmp_path)
                res = converter.convert(tmp_path)
                page_markdown = res.document.export_to_markdown()
                if total_pages > 1:
                    header = f"<!-- Page {i + 1} of {total_pages} -->" + chr(10)
                    pages_md.append(header + page_markdown)
                else:
                    pages_md.append(page_markdown)
            finally:
                if tmp_path.exists():
                    try:
                        tmp_path.unlink()
                    except OSError:
                        pass

        return (chr(10) + chr(10)).join(pages_md)
    else:
        res = converter.convert(str(path))
        return res.document.export_to_markdown()

