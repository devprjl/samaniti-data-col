# SPDX-License-Identifier: MIT
"""
PaddleOCR as a native docling OCR engine.

PaddleOCR is a strong, fast choice for Devanagari (Nepali/Hindi) and brings its
own detection + angle-classification + recognition stack. Docling keeps
ownership of layout analysis and table structure (TableFormer), so table output
stays identical across engines -- only the text recognition differs.

PaddlePaddle has no wheels for every Python version, so every import here is
lazy and guarded, and the engine reports itself unavailable rather than raising
at import time.
"""

from __future__ import annotations

import logging
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

# PaddleOCR accepts either a single language code or a list. Devanagari codes.
_PADDLE_DEVA = {"ne", "hi", "mr", "sa", "ne_devanagari", "hi_devanagari"}

_PADDLE_LANG_ALIASES: dict[str, str] = {
    "nepali": "ne",
    "nep": "ne",
    "hindi": "hi",
    "hin": "hi",
    "marathi": "mr",
    "mar": "mr",
    "sanskrit": "sa",
    "san": "sa",
    "english": "en",
    "eng": "en",
}


class PaddleOcrOptions(OcrOptions):
    """Configuration for the PaddleOCR engine."""

    # `kind` and `canonicalize_lang` are ClassVar on the base. Declaring them
    # as plain annotations would make pydantic treat them as instance fields,
    # leaving the class attribute at the base default -- the factory keys
    # engines off `kind`, so the engine would register as "".
    kind: ClassVar[Literal["paddleocr"]] = "paddleocr"
    # PaddleOCR wants its own codes ("ne", "hi"), which are close to but not
    # identical with the canonical tags, so hand them over untouched.
    canonicalize_lang: ClassVar[bool] = False

    mode: OcrMode = OcrMode.FULL_PAGE
    lang: list[str] = Field(default_factory=lambda: ["ne", "en", "hi"])
    scale: Annotated[float, Field(gt=0.0)] = 3.0

    # Detection / recognition tuning
    use_textline_orientation: bool = True
    det_db_unclip_ratio: Annotated[float, Field(gt=0.0)] = 1.5
    # Devanagari recognition scores noticeably lower than Latin, so the default
    # PaddleOCR threshold (0.5) silently drops legitimate Nepali/Hindi text.
    # 0.1 matches the threshold the EasyOCR path uses; garbage is filtered
    # later by docling's layout model, not by the score gate.
    drop_score: Annotated[float, Field(ge=0.0, le=1.0)] = 0.1
    cpu_threads: int | None = None
    enable_hpi: bool = False
    use_gpu: bool | None = None


def _paddle_code(tag: str) -> str:
    """Map a language tag to a PaddleOCR language code."""
    t = tag.strip().lower()
    if t in _PADDLE_LANG_ALIASES:
        return _PADDLE_LANG_ALIASES[t]
    if "-" in t:
        base = t.split("-")[0]
        if base in _PADDLE_LANG_ALIASES:
            return _PADDLE_LANG_ALIASES[base]
    return t


def _paddle2_accepts_list_lang(params: dict) -> bool:
    """
    True when the installed PaddleOCR takes `lang` as a list.

    PaddleOCR 2.x accepted a list of language codes; 3.x requires a single
    string and does a set membership test on it, so passing a list raises
    ``TypeError: unhashable type: 'list'``. 3.x is identified by its renamed
    parameters, which is more reliable than parsing the version number.
    """
    if "use_gpu" in params and "text_rec_score_thresh" not in params:
        return True
    return "use_angle_cls" in params and "use_textline_orientation" not in params


def _is_line(item) -> bool:
    """
    True if `item` is a single result ``[box, (text, score)]``.

    The (text, score) pair is distinguished from a box point by its content:
    text is a string and score is numeric. A 4-point polygon box also satisfies
    a naive ``len(pair) >= 2`` test, so the types are checked instead.
    """
    if not (isinstance(item, (list, tuple)) and len(item) >= 2):
        return False
    box, pair = item[0], item[1]
    if not isinstance(box, (list, tuple, numpy.ndarray)) or len(box) == 0:
        return False
    if not (isinstance(pair, (list, tuple)) and len(pair) >= 2):
        return False
    text, score = pair[0], pair[1]
    if isinstance(text, (list, tuple, numpy.ndarray)):
        return False
    try:
        float(score)
    except (TypeError, ValueError):
        return False
    return True


def _iter_lines(results):
    """
    Yield each [box, (text, score)] result from PaddleOCR's nested output.

    PaddleOCR returns one entry per image, each a list of result lines:
    ``[[[box, (text, score)], ...]]``. Older builds add or drop a wrapper
    level. Rather than indexing blindly -- ``res[0][0]`` is itself a list (the
    box) when ``res[0]`` is the list of lines, so a naive descent silently
    yields the box instead of the lines and all text is lost -- the structure is
    probed for the first level that actually contains recognisable lines.
    """
    stack = list(results or [])
    while stack:
        item = stack.pop(0)
        if not item:
            continue
        if _is_line(item):
            yield item
            continue
        if isinstance(item, (list, tuple)):
            stack = list(item) + stack


def _box_to_minmax(box) -> tuple[list[float], list[float]]:
    """
    Normalise a PaddleOCR detection box into (xs, ys).

    Accepted forms:
      * [[x, y], [x, y], ...]  -- 4-point polygon
      * [x1, y1, x2, y2]       -- flat quad
      * [x, y, x, y, ...]      -- flattened N-point polygon

    A flat list is read as consecutive (x, y) pairs, which covers both the quad
    and the flattened-polygon cases. Anything unrecognised yields empty lists
    and the line is skipped.
    """
    try:
        if not box:
            return [], []
        if isinstance(box[0], (list, tuple, numpy.ndarray)):
            return [float(p[0]) for p in box], [float(p[1]) for p in box]
        flat = [float(v) for v in box]
        if len(flat) >= 4:
            return flat[0::2], flat[1::2]
    except (TypeError, ValueError, IndexError):
        return [], []
    return [], []


class PaddleOcrModel(BaseOcrModel):
    _model_repo_folder = "PaddleOcr"
    multiple_languages = True

    def __init__(
        self,
        enabled: bool,
        artifacts_path: Path | None,
        options: PaddleOcrOptions,
        accelerator_options: AcceleratorOptions,
    ):
        super().__init__(
            enabled=enabled,
            artifacts_path=artifacts_path,
            options=options,
            accelerator_options=accelerator_options,
        )
        self.options: PaddleOcrOptions
        self.scale = self.options.scale
        self.reader = None

        if not self.enabled:
            return

        try:
            from paddleocr import PaddleOCR
        except ImportError as exc:  # pragma: no cover - depends on environment
            raise ImportError(
                "PaddleOCR is not available. Install a PaddlePaddle build that "
                "matches your Python version first:\n"
                "  pip install paddlepaddle          # CPU\n"
                "  pip install paddlepaddle-gpu      # CUDA\n"
                "  pip install paddleocr\n"
                "PaddlePaddle publishes no wheels for some Python versions; "
                "check https://www.paddlepaddle.org.cn/install/quick for a "
                "supported interpreter."
            ) from exc

        langs = [_paddle_code(x) for x in (self.options.lang or ["ne", "en"])]

        # Decide GPU usage from the *validated* device, not from assumptions.
        use_gpu = self.options.use_gpu
        if use_gpu is None:
            dev = str(getattr(accelerator_options, "device", "cpu"))
            use_gpu = dev.startswith("cuda") or dev.startswith("mps")

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            self.reader = PaddleOCR(
                **self._build_kwargs(PaddleOCR, langs, use_gpu, artifacts_path)
            )
        _log.info("PaddleOCR ready (langs=%s, gpu=%s)", langs, use_gpu)

    def _run_ocr(self, im):
        """
        Invoke whichever inference method the installed PaddleOCR provides.

        3.x renamed `ocr(img, cls=True)` to `predict(img)`: the angle/
        orientation stage is now switched by `use_textline_orientation` on the
        constructor, and passing `cls` raises TypeError. The signature is
        inspected so both work.
        """
        import inspect

        reader = self.reader
        method = getattr(reader, "ocr", None)
        if method is None:
            method = reader.predict

        try:
            params = inspect.signature(method).parameters
        except (TypeError, ValueError):
            params = {}

        if "cls" in params:
            return method(im, cls=self.options.use_textline_orientation)
        # 3.x: orientation is configured on the constructor already.
        return method(im)

    def _build_kwargs(
        self, paddle_cls, langs: list[str], use_gpu: bool, artifacts_path: Path | None
    ) -> dict:
        """
        Build constructor kwargs for whichever PaddleOCR major version is
        installed.

        PaddleOCR 3.x reworked this constructor: `lang` became a single string
        (a list raises "unhashable type: 'list'"), `use_gpu` was replaced by
        `device`, `drop_score` by `text_rec_score_thresh`, `use_angle_cls` by
        `use_textline_orientation`, and the per-stage model directories were
        renamed. 2.x keeps the older names. Rather than branching on a version
        number, the live signature is inspected and only parameters it actually
        accepts are passed, so both lines work -- and a future rename degrades
        to a default rather than a TypeError.
        """
        import inspect

        params = inspect.signature(paddle_cls.__init__).parameters
        accepts_kw = any(
            p.kind is inspect.Parameter.VAR_KEYWORD for p in params.values()
        )
        has = lambda n: (n in params) or accepts_kw  # noqa: E731

        kwargs: dict = {}

        # -- language: a list on 2.x, a single string on 3.x
        if has("lang"):
            kwargs["lang"] = langs if _paddle2_accepts_list_lang(params) else langs[0]

        # -- device / gpu
        if has("device"):
            kwargs["device"] = "gpu:0" if use_gpu else "cpu"
        elif has("use_gpu"):
            kwargs["use_gpu"] = use_gpu

        # -- score threshold
        if has("text_rec_score_thresh"):
            kwargs["text_rec_score_thresh"] = self.options.drop_score
        elif has("drop_score"):
            kwargs["drop_score"] = self.options.drop_score

        # -- text-line orientation (replaces angle classifier)
        if has("use_textline_orientation"):
            kwargs["use_textline_orientation"] = self.options.use_textline_orientation
        elif has("use_angle_cls"):
            kwargs["use_angle_cls"] = self.options.use_textline_orientation

        # -- detection box expansion
        if has("text_det_unclip_ratio"):
            kwargs["text_det_unclip_ratio"] = self.options.det_db_unclip_ratio
        elif has("det_db_unclip_ratio"):
            kwargs["det_db_unclip_ratio"] = self.options.det_db_unclip_ratio

        # -- batching
        if self.options.cpu_threads and has("cpu_threads"):
            kwargs["cpu_threads"] = self.options.cpu_threads

        # -- model directories
        #
        # Only override a stage directory when it already holds a downloaded
        # model. Pointing PaddleOCR at a freshly created empty directory makes
        # it look for `inference.yml` there and fail, instead of downloading
        # to its own cache.
        if artifacts_path is not None:
            model_root = artifacts_path / self._model_repo_folder
            for param, sub in (
                ("text_detection_model_dir", "det"),
                ("text_recognition_model_dir", "rec"),
                ("textline_orientation_model_dir", "cls"),
                ("det_model_dir", "det"),
                ("rec_model_dir", "rec"),
                ("cls_model_dir", "cls"),
            ):
                if param not in params:
                    continue
                stage = model_root / sub
                if stage.is_dir() and any(stage.iterdir()):
                    kwargs[param] = str(stage)

        return kwargs

    # -- language plumbing -------------------------------------------------
    def supported_ocr_languages(self) -> OcrLanguageSupport:
        return OcrLanguageSupport(
            bcp47=["en", "hi", "ne", "mr", "sa"],
            native=sorted(_PADDLE_DEVA),
        )

    def map_ocr_language(self, language: OcrLanguage) -> str:
        code = _paddle_code(language.tag())
        if code not in self.supported_ocr_languages().bcp47 and code not in _PADDLE_DEVA:
            raise OcrLanguageNotSupportedError(
                self._engine_name,
                language.tag(),
                supported=self.supported_ocr_languages(),
            )
        return code

    # -- execution ---------------------------------------------------------
    def __call__(
        self, conv_res: ConversionResult, page_batch: Iterable[Page]
    ) -> Iterable[Page]:
        if not self.enabled or self.reader is None:
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
                    img = page._backend.get_page_image(scale=self.scale, cropbox=ocr_rect)
                    im = numpy.array(img)
                    del img

                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        results = self._run_ocr(im)

                    idx = 0
                    for line in _iter_lines(results):
                        try:
                            box, (text, score) = line[0], line[1]
                            score = float(score)
                        except (TypeError, ValueError, IndexError):
                            continue
                        if score < self.options.drop_score:
                            continue
                        xs, ys = _box_to_minmax(box)
                        if not xs:
                            continue
                        all_cells.append(
                            TextCell(
                                index=idx,
                                text=str(text),
                                orig=str(text),
                                from_ocr=True,
                                confidence=score,
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
        return PaddleOcrOptions
