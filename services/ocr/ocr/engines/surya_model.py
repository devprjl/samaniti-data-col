# SPDX-License-Identifier: MIT
"""
SuryaOCR as a native docling OCR engine.

Surya is a detection + recognition stack trained for document OCR, and is the
strongest of the two for layout-heavy pages. It is script-aware rather than
language-list-driven, so Nepali and Hindi (both Devanagari) are served by the
same script model; `lang` is accepted for interface symmetry and used only to
keep docling's language plumbing happy.

Docling retains layout analysis and TableFormer, so tables render identically
no matter which recognition engine is selected.
"""

from __future__ import annotations

import logging
import re
import warnings
from collections.abc import Iterable
from pathlib import Path
from typing import Annotated, ClassVar, Literal

import numpy
from docling.datamodel.accelerator_options import AcceleratorOptions
from docling.datamodel.base_models import Page
from docling.datamodel.document import ConversionResult
from docling.datamodel.pipeline_options import OcrMode, OcrOptions
from docling.datamodel.settings import settings
from docling.exceptions import OcrLanguageNotSupportedError
from docling.models.base_ocr_model import BaseOcrModel
from docling.utils.ocr_language import OcrLanguage, OcrLanguageSupport
from docling.utils.profiling import TimeRecorder
from docling_core.types.doc import BoundingBox, CoordOrigin
from docling_core.types.doc.page import BoundingRectangle, TextCell
from pydantic import Field

_log = logging.getLogger(__name__)


def _poly_to_minmax(poly) -> tuple[list[float], list[float]]:
    """
    Normalise a Surya detection polygon into (xs, ys).

    Accepted forms:
      * [[x, y], [x, y], ...]  -- list of points
      * [x, y, x, y, ...]      -- flattened N-point polygon
      * [x1, y1, x2, y2]       -- a single flat quad

    A flat list is therefore read as consecutive (x, y) pairs, which is correct
    for both the flattened and the quad case. Unparseable input yields empty
    lists and the line is skipped rather than aborting the page.
    """
    try:
        if not poly:
            return [], []
        if isinstance(poly[0], (list, tuple, numpy.ndarray)):
            return [float(p[0]) for p in poly], [float(p[1]) for p in poly]
        flat = [float(v) for v in poly]
        if len(flat) >= 4:
            xs = flat[0::2]
            ys = flat[1::2]
            return xs, ys
    except (TypeError, ValueError, IndexError):
        return [], []
    return [], []


def _block_text(block) -> str:
    """
    Extract plain text from a Surya result block.

    Current surya releases return text in `.html` (often ``<p>…</p>`` or with
    inline markup), and there is no `.text` attribute, so the tags are stripped.
    A plain `.text`/`.label` is still honoured for forward/backward
    compatibility with other result shapes.
    """
    raw = getattr(block, "html", None)
    if raw is None:
        raw = getattr(block, "text", None)
    if raw is None:
        return ""
    text = str(raw)
    if "<" in text and ">" in text:
        text = re.sub(r"<[^>]+>", "", text)
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
    )
    return " ".join(text.split())


def _first_bbox(bboxes) -> object | None:
    """First usable bbox from a Surya detection result, if any."""
    for bbox in bboxes or []:
        if bbox is None:
            continue
        if hasattr(bbox, "x0"):
            return [bbox.x0, bbox.y0, bbox.x1, bbox.y1]
        return bbox
    return None


class SuryaOcrOptions(OcrOptions):
    """Configuration for the SuryaOCR engine."""

    # See PaddleOcrOptions: these must stay ClassVar or `kind` never takes and
    # the factory registers the engine under an empty kind.
    kind: ClassVar[Literal["suryaocr"]] = "suryaocr"
    # Surya is script-driven, so let it see the tag we were given.
    canonicalize_lang: ClassVar[bool] = False

    mode: OcrMode = OcrMode.FULL_PAGE
    lang: list[str] = Field(default_factory=lambda: ["ne", "hi", "en"])
    scale: Annotated[float, Field(gt=0.0)] = 3.0

    # Recognition controls
    batch_size: int | None = None
    recognition_batch_size: int | None = None
    new_lines: bool = True
    y_thresh: Annotated[float, Field(ge=0.0, le=1.0)] = 0.5
    x_thresh: Annotated[float, Field(ge=0.0, le=1.0)] = 0.5
    # Devanagari recognition confidence runs lower than Latin; a 0.4 gate drops
    # valid Nepali/Hindi lines. Kept low and left to docling's layout model to
    # discard noise, matching the other engines' threshold.
    text_score: Annotated[float, Field(ge=0.0, le=1.0)] = 0.1
    use_doc_orientation_classify: bool = False
    use_doc_unwarping: bool = False


class SuryaOcrModel(BaseOcrModel):
    _model_repo_folder = "SuryaOcr"
    multiple_languages = True

    def __init__(
        self,
        enabled: bool,
        artifacts_path: Path | None,
        options: SuryaOcrOptions,
        accelerator_options: AcceleratorOptions,
    ):
        super().__init__(
            enabled=enabled,
            artifacts_path=artifacts_path,
            options=options,
            accelerator_options=accelerator_options,
        )
        self.options: SuryaOcrOptions
        self.scale = self.options.scale
        self.predictor = None
        self._det = None
        self._rec = None
        # Set when the installed surya exposes the modern predictor API rather
        # than the older batch_text_detection/batch_recognition helpers.
        self._modern = False

        if not self.enabled:
            return

        try:
            # Modern API (surya-ocr >= 0.15, current on PyPI): class-based
            # predictors returning structured results.
            from surya.detection import DetectionPredictor
            from surya.recognition import RecognitionPredictor

            device = None
            dev = str(getattr(accelerator_options, "device", "cpu"))
            if dev.startswith("cuda"):
                device = "cuda"
            elif dev.startswith("mps"):
                device = "mps"
            elif dev.startswith("cpu"):
                device = "cpu"

            self._det = DetectionPredictor()
            self._rec = RecognitionPredictor()
            self._modern = True
            _log.info("SuryaOCR ready (predictor API, device=%s)", device)
        except ImportError:
            # Older API: module-level batch helpers.
            try:
                from surya.detection import batch_text_detection
                from surya.recognition import batch_recognition
            except ImportError as exc:  # pragma: no cover - environment specific
                raise ImportError(
                    "SuryaOCR is not available. Install it with:\n"
                    "  pip install surya-ocr\n"
                    "Surya needs Python <= 3.13 and pins Pillow<11; on Python 3.14 "
                    "neither applies, so use the 'paddleocr' or 'easyocr' engine."
                ) from exc
            self._batch_text_detection = batch_text_detection
            self._batch_recognition = batch_recognition
            self._modern = False
            _log.info("SuryaOCR ready (batch API)")

        if artifacts_path is not None:
            # Surya resolves its own cache via HF; just record where it is.
            settings.cache_dir.mkdir(parents=True, exist_ok=True)

    # -- language plumbing -------------------------------------------------
    def supported_ocr_languages(self) -> OcrLanguageSupport:
        return OcrLanguageSupport(
            bcp47=["en", "hi", "ne", "mr", "sa", "bn", "gu", "kn", "ml", "ta", "te"],
            native=["devanagari"],
        )

    def map_ocr_language(self, language: OcrLanguage) -> str:
        tag = language.tag().lower()
        supported = self.supported_ocr_languages()
        base = tag.split("-")[0]
        if base not in supported.bcp47:
            raise OcrLanguageNotSupportedError(
                self._engine_name, language.tag(), supported=supported
            )
        return base

    # -- execution ---------------------------------------------------------
    def _run_modern(self, images: list) -> list[tuple[str, object, float]]:
        """
        Run the current predictor API and normalise to (text, polygon, conf).

        RecognitionPredictor already performs detection internally and returns
        per-block results carrying their own polygon, so a separate detection
        pass is not needed here. Text arrives in `.html`, not `.text`, and is
        emitted in `reading_order`, which is what determines page order.
        """
        results = self._rec(images)
        out: list[tuple[str, object, float]] = []
        for page in results or []:
            blocks = getattr(page, "blocks", None) or []
            ordered = sorted(
                blocks, key=lambda b: getattr(b, "reading_order", 0) or 0
            )
            for block in ordered:
                if getattr(block, "skipped", False) or getattr(block, "error", False):
                    continue
                text = _block_text(block)
                if not text:
                    continue
                poly = getattr(block, "polygon", None)
                if not poly:
                    # Fall back to a detection box when the block carries none.
                    poly = _first_bbox(getattr(page, "bboxes", None))
                    if not poly:
                        continue
                conf = getattr(block, "confidence", None)
                out.append((text, poly, float(conf) if conf is not None else 1.0))
        return out

    def _run_batch(self, im, **kwargs) -> list[tuple[str, object, float]]:
        """Run the older batch_* API and normalise to (text, polygon, conf)."""
        det_polys = self._batch_text_detection(
            [im],
            new_lines=kwargs.get("new_lines", True),
            y_thresh=kwargs.get("y_thresh", 0.5),
            x_thresh=kwargs.get("x_thresh", 0.5),
        )
        rec = self._batch_recognition([im], det_polys, batch_size=kwargs.get("batch_size"))
        texts = list(getattr(rec[0], "texts", []) or []) if rec else []
        polys = det_polys[0] if det_polys else []
        scores = list(getattr(rec[0], "confidence", []) or []) if rec else []
        out = []
        # strict=False on purpose: the detector and the recogniser can return
        # different counts, and the shorter one should simply end the batch
        # rather than raise.
        for ix, (text, poly) in enumerate(zip(texts, polys, strict=False)):
            conf = float(scores[ix]) if ix < len(scores) else 1.0
            out.append((str(text), poly, conf))
        return out

    def __call__(
        self, conv_res: ConversionResult, page_batch: Iterable[Page]
    ) -> Iterable[Page]:
        if not self.enabled or (self._det is None and not hasattr(self, "_batch_text_detection")):
            yield from page_batch
            return

        for page in page_batch:
            assert page._backend is not None
            if not page._backend.is_valid():
                yield page
                continue

            with TimeRecorder(conv_res, "ocr"):
                ocr_rects = self.get_ocr_rects(page)
                all_cells: list[TextCell] = []

                for ocr_rect in ocr_rects:
                    if ocr_rect.area() == 0:
                        continue
                    pil_img = page._backend.get_page_image(
                        scale=self.scale, cropbox=ocr_rect
                    )

                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        if self._modern:
                            items = self._run_modern([pil_img])
                        else:
                            im = numpy.array(pil_img)
                            items = self._run_batch(
                                im,
                                new_lines=self.options.new_lines,
                                y_thresh=self.options.y_thresh,
                                x_thresh=self.options.x_thresh,
                                batch_size=self.options.batch_size,
                            )
                    del pil_img

                    idx = 0
                    for text, poly, conf in items:
                        if not text:
                            continue
                        if conf < self.options.text_score:
                            continue
                        xs, ys = _poly_to_minmax(poly)
                        if not xs:
                            continue
                        all_cells.append(
                            TextCell(
                                index=idx,
                                text=text,
                                orig=text,
                                from_ocr=True,
                                confidence=conf,
                                rect=BoundingRectangle.from_bounding_box(
                                    BoundingBox.from_tuple(
                                        coord=(
                                            (min(xs) / self.scale) + ocr_rect.l,
                                            (min(ys) / self.scale) + ocr_rect.t,
                                            (max(xs) / self.scale) + ocr_rect.l,
                                            (max(ys) / self.scale) + ocr_rect.t,
                                        ),
                                        origin=CoordOrigin.TOPLEFT,
                                    )
                                ),
                            )
                        )
                        idx += 1

                    del im

                self.post_process_cells(all_cells, page, conv_res)

            if settings.debug.visualize_ocr:
                self.draw_ocr_rects_and_cells(conv_res, page, ocr_rects)

            yield page

    @classmethod
    def get_options_type(cls) -> type[OcrOptions]:
        return SuryaOcrOptions
