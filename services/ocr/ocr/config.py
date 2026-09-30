"""
ocr/config.py – Engine registry, model presets, and runtime device detection.

Design goals
------------
1. Engines are *runtime-pluggable and toggleable*. The available engines are
   discovered dynamically, so a machine that lacks PaddlePaddle (or Surya)
   still runs fine on the ones it does have.
2. Nothing here encodes a per-GPU recommendation table. Whether an engine is
   usable is a *capability* question (is it installed? is a device visible?),
   not a "which laptop is this" question. The same code path is used on
   desktops, laptops, CPU-only servers, and inside containers.
3. Device detection is defensive: any probing failure degrades to CPU rather
   than raising, so a broken/absent accelerator never blocks a run.
"""

from __future__ import annotations

import importlib
import os
import shutil
from dataclasses import dataclass, field

try:
    import torch
except ImportError:
    # torch is genuinely optional: PaddleOCR has its own runtime and does not
    # need it. Importing it unconditionally would break design goal (1) above --
    # a paddle-only install would die at import time instead of running. Every
    # use below is already wrapped, so None degrades cleanly to CPU.
    torch = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Engine registry
# ---------------------------------------------------------------------------

# Languages per engine. Nepali ("ne") and Hindi ("hi") share the Devanagari
# script, so they are both requested wherever the engine supports both.
EASYOCR_LANGS = ["ne", "en", "hi"]
PADDLEOCR_LANGS = ["ne", "en", "hi"]
SURYAOCR_LANGS = ["en"]  # Surya auto-detects Devanagari; no per-lang model

# Engines, in preference order for the "auto" engine selector.
# "acc" = expected accuracy on Devanagari, "tables" = native table support.
ENGINES: dict[str, dict[str, str]] = {
    "paddleocr": {
        "acc": "high",
        "tables": "yes",
        "module": "paddleocr",
        "runtime": "paddlepaddle",
        "pkg": "paddlepaddle",
        "blurb": "PaddleOCR - fast, strong on Devanagari, native table structure",
    },
    "suryaocr": {
        "acc": "high",
        "tables": "yes",
        "module": "surya",
        "runtime": "surya-ocr",
        "pkg": "surya-ocr",
        "blurb": "SuryaOCR - excellent layout + tables, multilingual",
    },
    "easyocr": {
        "acc": "medium",
        "tables": "via TableFormer",
        "module": "easyocr",
        "runtime": "easyocr",
        "pkg": "easyocr",
        "blurb": "EasyOCR - light, widely available, Devanagari capable",
    },
    "vlm": {
        "acc": "highest",
        "tables": "yes",
        "module": "docling",
        "runtime": "torch",
        "pkg": "docling",
        "blurb": "Docling VLM - holistic layout understanding, heaviest",
    },
}

# Engine used when none is specified and none is available.
FALLBACK_ENGINE = "easyocr"


def module_available(name: str) -> bool:
    """True if `name` can actually be imported.

    Deliberately a real import rather than `importlib.util.find_spec`: a
    package can be present while its native runtime is missing. `paddleocr`
    without `paddlepaddle` is the common case -- find_spec succeeds, and the
    engine is then selected and only explodes mid-conversion. Importing is
    slower but it is the only check that answers the question actually being
    asked: "will this engine start?"
    """
    try:
        importlib.import_module(name)
        return True
    except Exception:
        return False


def engine_installed(engine: str) -> bool:
    """True if the engine's backing module imports successfully."""
    meta = ENGINES.get(engine)
    if not meta:
        return False
    return module_available(meta["module"])


def engine_readiness(engine: str) -> tuple[bool, str]:
    """
    Can this engine actually *run* here, not merely import?

    Importing is necessary but not sufficient, and the gap is where the
    confusing failures live:

    * PaddleOCR imports fine without PaddlePaddle, and PaddlePaddle itself
      imports on CPUs whose oneDNN kernels it cannot actually execute
      (AVX-512 is required; AVX2-only parts fail at the first inference).
    * surya-ocr imports fine, but current releases delegate inference to an
      external backend: vLLM in Docker with an NVIDIA runtime, or a
      `llama-server` binary. Neither is present by default, so the import
      succeeds and the first OCR call dies with a spawn error.

    Returns (ready, reason). `reason` is a short actionable message when not
    ready, empty when ready. Probed by attempting the cheap parts only; model
    weights are never downloaded here.
    """
    if not engine_installed(engine):
        return False, f"not installed (pip install {engine_hint(engine)})"

    if engine == "paddleocr":
        # PaddlePaddle needs AVX-512 for its oneDNN kernels. Without it the
        # import succeeds and the first inference raises an opaque
        # ConvertPirAttribute2RuntimeAttribute error.
        try:
            with open("/proc/cpuinfo", encoding="utf-8") as fh:
                cpuinfo = fh.read()
        except OSError:
            cpuinfo = ""
        if cpuinfo and "avx512" not in cpuinfo:
            return (
                False,
                "PaddlePaddle needs AVX-512 (this CPU has AVX2 only); "
                "inference will fail. Use --engine easyocr or suryaocr.",
            )
        return True, ""

    if engine == "suryaocr":
        # Choose the backend the way surya *should*: from the device we have
        # actually verified, not from whether nvidia-smi merely exists. Surya's
        # own autodetect only checks that nvidia-smi is present, so on a box
        # with an unusable GPU it picks vLLM and then dies asking Docker for an
        # NVIDIA runtime that is not configured.
        backend = (os.environ.get("SURYA_INFERENCE_BACKEND") or "").strip().lower()
        if not backend:
            backend = "vllm" if detect_device() == "cuda" else "llamacpp"

        if backend == "vllm":
            if detect_device() != "cuda":
                return (
                    False,
                    "surya's vLLM backend needs a working NVIDIA GPU + Docker "
                    "runtime; none usable here. Set "
                    "SURYA_INFERENCE_BACKEND=llamacpp for CPU, or use "
                    "--engine easyocr.",
                )
            if shutil.which("docker") is None:
                return (
                    False,
                    "surya needs the vLLM backend (Docker + NVIDIA runtime); "
                    "docker not found. Set SURYA_INFERENCE_BACKEND=llamacpp "
                    "for CPU.",
                )
            return True, ""

        if os.environ.get("LLAMA_CPP_BINARY") or shutil.which("llama-server"):
            return True, ""
        return (
            False,
            "surya needs an inference backend: install llama-server and set "
            "SURYA_INFERENCE_BACKEND=llamacpp (CPU), or use vLLM via Docker on "
            "GPU. Use --engine easyocr or paddleocr instead.",
        )

    return True, ""


def engine_hint(engine: str) -> str:
    """Short install hint for an unavailable engine."""
    meta = ENGINES.get(engine)
    if not meta:
        return ""
    return meta.get("pkg") or meta["module"]


def installed_engines() -> list[str]:
    """All engines whose backing module imports right now."""
    return [name for name in ENGINES if engine_installed(name)]


def ready_engines() -> list[str]:
    """Engines that are installed *and* runnable on this machine."""
    return [name for name in ENGINES if engine_readiness(name)[0]]


def unavailable_reasons() -> dict[str, str]:
    """Engine -> why it cannot be used, for every unusable engine."""
    out: dict[str, str] = {}
    for name in ENGINES:
        ready, reason = engine_readiness(name)
        if not ready:
            out[name] = reason
    return out


def missing_engines() -> dict[str, str]:
    """Map of engine -> pip package, for engines that cannot be used."""
    out: dict[str, str] = {}
    for name in ENGINES:
        if not engine_installed(name):
            out[name] = engine_hint(name)
    return out


# ---------------------------------------------------------------------------
# VLM presets (only meaningful for the "vlm" engine)
# ---------------------------------------------------------------------------

VLM_PRESET_ALIASES: dict[str, str] = {
    "qwen": "qwen",
    "qwen2.5": "qwen",
    "qwen2.5-vl": "qwen",
    "smoldocling": "smoldocling",
    "granite": "granite_docling",
    "granite-docling": "granite_docling",
    "granite_docling": "granite_docling",
    "granite-vision": "granite_vision",
    "granite_vision": "granite_vision",
    "got-ocr": "got_ocr",
    "got_ocr": "got_ocr",
    "phi4": "phi4",
    "deepseek": "deepseek_ocr",
    "deepseek-ocr": "deepseek_ocr",
    "deepseek_ocr": "deepseek_ocr",
    "dots-ocr": "dots_ocr",
    "dots_ocr": "dots_ocr",
}

VLM_MODELS: dict[str, str] = {
    "smoldocling": "SmolDocling-256M  – smallest VLM, runs anywhere",
    "got-ocr": "GOT-OCR 2.0        – fast dense-text OCR",
    "granite": "Granite-Docling    – balanced, good Devanagari",
    "granite-vision": "Granite-Vision  – high accuracy",
    "qwen": "Qwen2.5-VL-3B       – strong multilingual + tables",
    "dots-ocr": "Dots-OCR 3B        – multilingual layout parser",
    "phi4": "Phi-4              – heaviest",
    "deepseek": "DeepSeek-OCR      – heaviest multilingual",
}

# Smallest-first: auto-selection walks this list and takes the first that both
# fits the detected device and is installed. No per-GPU names anywhere.
VLM_TIERS: tuple[str, ...] = (
    "smoldocling",
    "got-ocr",
    "granite",
    "granite-vision",
    "dots-ocr",
    "qwen",
    "phi4",
    "deepseek",
)

DEFAULT_VLM_MODEL = "smoldocling"


# ---------------------------------------------------------------------------
# Device detection (defensive; never raises)
# ---------------------------------------------------------------------------

def cuda_is_usable() -> bool:
    """
    True only if a CUDA device exists *and* can actually run kernels.

    `torch.cuda.is_available()` is not sufficient. A GPU can be visible while
    being incompatible with the installed torch build -- e.g. a Pascal card
    (sm_61) against a wheel compiled for sm_75+ reports available and then
    fails on the first kernel launch. That combination is common on older
    consumer cards and inside containers with a host-driver/wheel mismatch.

    Two checks, cheapest first:
      1. the device's compute capability is in torch's compiled arch list
      2. a real 1x1 matmul succeeds (catches driver/arch mismatches that the
         capability list misses, and an unusable device)
    """
    try:
        if not torch.cuda.is_available():
            return False
    except Exception:
        return False

    # 1. compute-capability check
    try:
        major, minor = torch.cuda.get_device_capability(0)
        arch = f"sm_{major}{minor}"
        built = {a.split("_")[-1] for a in torch.cuda.get_arch_list() if a.startswith("sm_")}
        if built and arch not in built:
            return False
    except Exception:
        pass

    # 2. real execution smoke test
    try:
        t = torch.ones((1, 1), device="cuda")
        _ = (t @ t).item()
        torch.cuda.synchronize()
        return True
    except Exception:
        return False


def mps_is_usable() -> bool:
    """True only if the Apple Metal backend exists and accepts a real op."""
    try:
        mps = getattr(torch.backends, "mps", None)
        if not (mps and mps.is_available()):
            return False
        t = torch.ones((1, 1), device="mps")
        _ = (t @ t).item()
        return True
    except Exception:
        return False


def detect_device(prefer: str | None = None) -> str:
    """
    Return the best *actually usable* device: 'cuda', 'mps', or 'cpu'.

    Usability is verified, not assumed -- a visible-but-incompatible GPU is
    treated as no GPU. Failures collapse to 'cpu' so a broken accelerator never
    blocks a run, and the same logic applies unchanged inside containers.
    """
    forced = (prefer or os.environ.get("OCR_DEVICE") or "").strip().lower()
    if forced:
        if forced == "cpu":
            return "cpu"
        if forced == "cuda" and cuda_is_usable():
            return "cuda"
        if forced == "mps" and mps_is_usable():
            return "mps"
        # An explicit but unavailable request falls through to auto-detection
        # rather than hard-failing, which keeps containers portable.

    if cuda_is_usable():
        return "cuda"
    if mps_is_usable():
        return "mps"
    return "cpu"


def get_vram_gb() -> float:
    """GPU VRAM in GB, or 0.0 when no CUDA device is usable."""
    try:
        if torch.cuda.is_available():
            return torch.cuda.get_device_properties(0).total_memory / 1e9
    except Exception:
        pass
    return 0.0


def gpu_available(device: str) -> bool:
    return device in ("cuda", "mps")


def thread_count() -> int:
    """
    Torch thread count for the detected device.

    Left to torch's own default on accelerators (where CPU threads are not the
    bottleneck and over-subscribing actively hurts). On CPU, capped so a large
    machine does not thrash, and floored at 1.
    """
    try:
        n = os.cpu_count() or 1
    except Exception:
        n = 1
    return max(1, min(n, 8))


@dataclass(frozen=True)
class HardwareProfile:
    """What this machine can actually do, independent of what it 'is'."""

    device: str
    vram_gb: float
    threads: int
    engines: list[str] = field(default_factory=list)

    @property
    def has_gpu(self) -> bool:
        return self.device in ("cuda", "mps")

    @property
    def summary(self) -> str:
        gpu = f"{self.vram_gb:.1f} GB VRAM" if self.vram_gb > 0 else "CPU only"
        return f"{self.device} / {gpu} / {self.threads} threads"


def profile_hardware(prefer: str | None = None) -> HardwareProfile:
    device = detect_device(prefer)
    return HardwareProfile(
        device=device,
        vram_gb=get_vram_gb() if device == "cuda" else 0.0,
        threads=thread_count() if device == "cpu" else 4,
        engines=ready_engines(),
    )


# ---------------------------------------------------------------------------
# Engine selection
# ---------------------------------------------------------------------------

def select_engine(
    requested: str = "auto",
    hw: HardwareProfile | None = None,
) -> str:
    """
    Resolve the requested engine to a concrete one that is actually usable.

    requested:
      'auto'        -> best installed engine for this hardware
      '<name>'      -> that engine, or the best installed one if it is absent

    Never raises for an unavailable engine; callers that need to hard-fail on
    a specific engine should check `engine_installed` first and surface a
    useful install hint.
    """
    hw = hw or profile_hardware()
    available = [e for e in ready_engines() if e in ENGINES]
    if not available:
        # Nothing importable: docling's default converter is the last resort.
        return "default"

    if requested != "auto" and requested in available:
        return requested

    if requested != "auto" and requested not in ENGINES:
        return available[0]

    # 'auto', or the requested engine is missing -> pick by capability.
    #
    # Paddle/Surya lead because they are the accurate Devanagari options the
    # caller asked for; EasyOCR is the broadly-available baseline. The only
    # hardware signal used is "is there a usable accelerator" -- a real matmul
    # check, not a device-name or VRAM-tier table, so a new or unfamiliar GPU
    # is handled the same as a known one.
    if hw.has_gpu:
        for candidate in ("paddleocr", "suryaocr", "vlm", "easyocr"):
            if candidate in available:
                return candidate
    else:
        for candidate in ("paddleocr", "suryaocr", "easyocr", "vlm"):
            if candidate in available:
                return candidate
    return available[0]


def suggest_model(hw: HardwareProfile | None = None) -> str:
    """
    Pick a VLM preset for the 'vlm' engine, smallest viable first.

    Uses a VRAM floor as a *safety guard* so a large model is not selected for
    a small device -- it is a capacity check, not a list of specific GPUs.
    """
    hw = hw or profile_hardware()
    if not hw.has_gpu:
        return DEFAULT_VLM_MODEL

    # Minimum comfortable VRAM per tier, in GB. Anything not listed needs 8+.
    vram_floor: dict[str, float] = {
        "smoldocling": 0.0,
        "got-ocr": 1.0,
        "granite": 2.0,
        "granite-vision": 4.0,
        "dots-ocr": 4.0,
        "qwen": 6.0,
        "phi4": 8.0,
        "deepseek": 8.0,
    }
    for tier in VLM_TIERS:
        if hw.vram_gb >= vram_floor.get(tier, 8.0):
            return tier
    return DEFAULT_VLM_MODEL
