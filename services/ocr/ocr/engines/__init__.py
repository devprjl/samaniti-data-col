# SPDX-License-Identifier: MIT
"""
Register the PaddleOCR and SuryaOCR engines with docling's OCR plugin factory.

Docling 2.130 ships EasyOCR, Tesseract, RapidOCR, OcrMac and Nemotron, but
neither Paddle nor Surya. Registering them through the same factory means they
participate in the standard pipeline: layout analysis, cell matching and
TableFormer all stay exactly where docling puts them, so table output is
identical across engines.

Two details matter for portability:

* Registration goes through `process_plugin` directly. Docling's own
  `load_from_plugins` relies on setuptools entry points and skips any module
  that does not start with "docling.", so an out-of-tree engine would be
  dropped (and, with `allow_external_plugins=True`, the built-ins would be
  skipped instead). Calling the factory directly registers ours *and* keeps
  the built-ins.
* An engine is only registered if its dependency genuinely imports. A mere
  `find_spec` hit is not enough -- a package can be present while its native
  runtime is missing (`paddleocr` without `paddlepaddle`, for example).
  Registering such an engine would make docling's auto-selector choose it and
  then fail at conversion time.
"""

from __future__ import annotations

import importlib
import logging
from typing import Any

_log = logging.getLogger(__name__)

_PLUGIN_NAME = "ocr_robust"
_PLUGIN_MODULE = __name__


def _imports(module: str) -> bool:
    """True only if `module` can actually be imported, not merely located."""
    try:
        importlib.import_module(module)
        return True
    except Exception as exc:
        _log.debug("Engine dependency %r unavailable: %s", module, exc)
        return False


def ocr_engines() -> dict[str, list[Any]]:
    """
    OCR engine plugin group: docling's built-ins plus our available engines.

    Each custom engine is included only when its runtime imports cleanly, so
    docling's automatic engine selection can never select a broken engine.
    """
    # Imported as a module attribute, not by the same name as this function:
    # binding `ocr_engines` here would shadow docling's hook and make the
    # lookup below resolve to this function (iterating its dict yields a str).
    from docling.models.plugins import defaults as docling_defaults

    engines: list[Any] = list(docling_defaults.ocr_engines()["ocr_engines"])

    if _imports("paddleocr"):
        try:
            from ocr.engines.paddle_model import PaddleOcrModel

            engines.append(PaddleOcrModel)
        except Exception as exc:
            _log.debug("PaddleOCR engine unavailable: %s", exc)

    if _imports("surya"):
        try:
            from ocr.engines.surya_model import SuryaOcrModel

            engines.append(SuryaOcrModel)
        except Exception as exc:
            _log.debug("SuryaOCR engine unavailable: %s", exc)

    return {"ocr_engines": engines}


def _factory_variants() -> list:
    """
    Every `get_ocr_factory` cache variant the pipeline might use.

    `get_ocr_factory` is `@lru_cache`d, and lru_cache keys on the arguments as
    *passed*: `get_ocr_factory()` and `get_ocr_factory(allow_external_plugins=
    False)` are distinct entries returning distinct OcrFactory instances. The
    standard pipeline calls it with the explicit `allow_external_plugins`
    value from its options (False by default), so registering only into the
    no-arg instance leaves the engine "registered" here yet unknown at
    conversion time. We therefore register on all variants.
    """
    from docling.models.factories import get_ocr_factory

    variants = []
    for flag in (False, True):
        try:
            variants.append(get_ocr_factory(allow_external_plugins=flag))
        except Exception as exc:  # pragma: no cover - defensive
            _log.debug("could not get ocr factory(allow_external_plugins=%s): %s", flag, exc)
    try:
        variants.append(get_ocr_factory())
    except Exception as exc:  # pragma: no cover - defensive
        _log.debug("could not get default ocr factory: %s", exc)

    # De-duplicate by identity while preserving order.
    seen: set[int] = set()
    unique = []
    for f in variants:
        if id(f) not in seen:
            seen.add(id(f))
            unique.append(f)
    return unique


def _target_factory():
    """The default OCR factory instance (for membership checks)."""
    variants = _factory_variants()
    return variants[0] if variants else None


def register_engines() -> list[str]:
    """
    Register our engines into every OCR factory cache variant.

    Only our own engines are registered. The built-ins are left to docling,
    which registers them itself; re-registering them would raise (and log) a
    duplicate-registration error on every call.

    Returns the custom engine kinds that are now registered. Idempotent.
    """
    candidates = []
    if _imports("paddleocr"):
        try:
            from ocr.engines.paddle_model import PaddleOcrModel

            candidates.append(PaddleOcrModel)
        except Exception as exc:
            _log.debug("PaddleOCR engine unavailable: %s", exc)
    if _imports("surya"):
        try:
            from ocr.engines.surya_model import SuryaOcrModel

            candidates.append(SuryaOcrModel)
        except Exception as exc:
            _log.debug("SuryaOCR engine unavailable: %s", exc)

    registered: set[str] = set()
    for factory in _factory_variants():
        for model in candidates:
            kind = model.get_options_type().kind
            if kind in factory.registered_kind:
                registered.add(kind)
                continue
            try:
                factory.register(model, _PLUGIN_NAME, _PLUGIN_MODULE)
                registered.add(kind)
            except ValueError:
                _log.debug("engine %r already registered elsewhere", kind)
    return sorted(registered)


def is_registered(engine: str) -> bool:
    """True if `engine`'s kind is present in any factory variant."""
    return any(engine in f.registered_kind for f in _factory_variants())
