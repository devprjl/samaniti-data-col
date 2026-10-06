# SPDX-License-Identifier: MIT
"""
ocr/config.py - The few settings this OCR service needs.

Read this file first. It holds nothing clever: a few constants, and one function
that works out whether we can use a GPU.

The whole OCR pipeline is:

    PDF  ->  image  ->  EasyOCR reads the text  ->  Docling rebuilds the layout
                                                          |
                                                          v
                                                     Markdown  ->  database

Everything that decides *how* that happens is set here or in ocr/pipeline.py.
"""

import os

# The name of the OCR engine. There is only one. It is written to the database
# alongside each result so you always know what produced a document's text.
ENGINE_NAME = "easyocr"

# Which languages EasyOCR should be able to read.
#
# "ne" is Nepali, "hi" is Hindi and "en" is English. Nepali and Hindi are both
# written in the same script (Devanagari), so "ne" already covers most of what
# Hindi needs, but both are listed so mixed documents are handled well.
#
# Every one of these models is downloaded the first time you run the service and
# then reused from the cache. The first run is slow because of this, not because
# of OCR.
LANGUAGES = ["ne", "en", "hi"]


def detect_device():
    """
    Work out where to run the OCR: "cuda", "mps" or "cpu".

    Order of preference:
      cuda - an NVIDIA graphics card
      mps   - an Apple Silicon graphics card
      cpu   - no usable graphics card

    If you want to force one, set the OCR_DEVICE environment variable to
    "cpu", "cuda" or "mps". Asking for a device that is not available is not an
    error; it quietly falls back, so the same image and environment file work on
    a laptop and on a server.
    """
    wanted = os.environ.get("OCR_DEVICE", "").strip().lower()

    try:
        # docling installs torch. If torch is missing there is no GPU to use,
        # so go straight to the CPU.
        import torch
    except ImportError:
        return "cpu"

    # A GPU is only used if it can really run something. A card can be visible
    # and still be too old for the installed torch, in which case it reports
    # itself available and then crashes on first use. Asking it to do a tiny
    # matrix multiplication is the honest test.
    def _gpu_works(device):
        try:
            number = torch.ones((1, 1), device=device)
            (number @ number).item()
            return True
        except Exception:
            return False

    if wanted in ("cuda", "mps"):
        if _gpu_works(wanted):
            return wanted
        print(f"[config] {wanted} was requested but is not usable; using the CPU instead.")
        return "cpu"

    if _gpu_works("cuda"):
        return "cuda"
    if _gpu_works("mps"):
        return "mps"
    return "cpu"


def describe_device() -> str:
    """A short human-readable line for the startup log, e.g. "cpu, 4 threads"."""
    device = detect_device()
    try:
        cores = os.cpu_count() or 1
    except Exception:
        cores = 1
    # On the CPU, do not grab every core. Docling already uses several threads
    # per step, and taking all of them makes the machine unresponsive.
    if device == "cpu":
        cores = min(cores, 8)
        return f"{device}, {cores} threads"
    return f"{device} (graphics card)"