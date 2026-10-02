# SPDX-License-Identifier: MIT
"""
ocr/pipeline.py - Turns a document into Markdown.

This is the heart of the service. Everything happens in three steps:

    STEP 1   PDF          -> one image per page
    STEP 2   image + text -> EasyOCR reads the words off the image
    STEP 3   words        -> Docling works out the layout and writes Markdown

Each step is a function below. Read them in order: pdf_to_images(), then the
docling setup, then convert_document() which calls both.

Why a PDF is turned into images first
-------------------------------------
The government documents we handle embed fonts such as Preeti, which have no
usable Unicode equivalent. Reading the text layer of such a PDF produces garbage
before OCR even starts. Rendering each page to a picture throws that broken text
away, and EasyOCR reads the picture instead, which is what a human would do.

Why Docling is still involved
-----------------------------
Docling does everything *except* reading the words. It finds the page layout,
puts the text blocks in reading order, and rebuilds tables with its TableFormer
model. It then produces clean Markdown with real headings and real tables.

So the split is: EasyOCR reads the words, Docling arranges them. Both are needed,
and neither duplicates the other.
"""

import os
import tempfile
from pathlib import Path

import pypdfium2 as pdfium
from docling.datamodel.accelerator_options import AcceleratorOptions
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import (
    EasyOcrOptions,
    OcrMode,
    PdfPipelineOptions,
    TableStructureOptions,
)
from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption

from ocr.config import LANGUAGES, detect_device

# We accept PDFs and plain images.
ALLOWED_FORMATS = [InputFormat.PDF, InputFormat.IMAGE]

# How much to sharpen the page images before reading them.
#
#   1.0 = about 72 DPI  (too blurry for OCR)
#   2.0 = about 150 DPI (the default; good for a normal scan)
#   3.0 = about 216 DPI (better for small or faded print, but slower)
#
# Low resolution is the single most common cause of bad OCR, so raise this to 3.0
# before blaming the engine. Raise it only as far as you need to: bigger images
# mean more memory and more time.
DEFAULT_IMAGE_SCALE = 2.0


# ---------------------------------------------------------------------------
# STEP 1: PDF -> images
# ---------------------------------------------------------------------------

def count_pages(pdf_path):
    """
    How many pages a PDF has, read without rendering anything.

    This is exact, and it costs milliseconds: the page tree is read straight out of
    the file. We use it on the downloaded file, which is the one place a page count
    can be trusted completely.

    Returns None if the file is not a readable PDF, rather than guessing.
    """
    try:
        with pdfium.PdfDocument(str(pdf_path)) as pdf:
            return len(pdf)
    except Exception:
        return None


def pdf_to_images(pdf_path, max_pages=None, scale=DEFAULT_IMAGE_SCALE):
    """
    Turn each page of a PDF into a PNG image on disk.

    pypdfium2 draws the page exactly as it looks, which is what we want: we need
    the picture, not the text underneath it.

    pdf_path:     path to the PDF file
    max_pages:    stop after this many pages, or None for all of them
    scale:        see DEFAULT_IMAGE_SCALE above

    Returns a list of image paths. The caller is responsible for deleting them;
    pdf_to_images() will not clean up after itself, because it does not know when
    you are finished.
    """
    pdf = pdfium.PdfDocument(str(pdf_path))
    try:
        total_pages = len(pdf)
        how_many = total_pages
        if max_pages:
            how_many = min(total_pages, int(max_pages))

        image_paths = []
        for page_number in range(how_many):
            page = pdf[page_number]
            picture = page.render(scale=scale).to_pil()

            # Save to a temporary PNG file. Docling reads from a file path, so we
            # need one. `delete=False` because we clean it up ourselves later
            # instead of letting Python delete it on close.
            temp_file = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
            temp_path = Path(temp_file.name)
            temp_file.close()

            picture.save(temp_path)
            image_paths.append(temp_path)
        return image_paths
    finally:
        pdf.close()


def delete_images(image_paths):
    """Delete the temporary page images. Safe to call even if one is already gone."""
    for path in image_paths:
        try:
            Path(path).unlink(missing_ok=True)
        except OSError:
            pass


# ---------------------------------------------------------------------------
# STEP 2 + STEP 3: tell Docling to use EasyOCR
# ---------------------------------------------------------------------------

def build_converter(scale=DEFAULT_IMAGE_SCALE):
    """
    Build the Docling converter, with EasyOCR as its text reader.

    Call this once at startup and reuse the result. It loads the layout model,
    the table model and the OCR models, which takes a while.

    Returns a DocumentConverter, ready to be handed a file path.
    """
    options = PdfPipelineOptions()

    # Run OCR on every page. Without this, Docling would only read PDFs that
    # already contain text and would silently skip our scanned pages.
    options.do_ocr = True

    # Tell Docling to read the words with EasyOCR.
    #
    # We do not pass `use_gpu`. Left unset, Docling works it out from the
    # accelerator_options below, which is the supported way to do it.
    options.ocr_options = EasyOcrOptions(
        lang=list(LANGUAGES),
        mode=OcrMode.FULL_PAGE,
        # Accept almost any prediction. Devanagari text scores lower confidence
        # than English even when it is correct, and a stricter limit silently
        # throws away valid Nepali words.
        confidence_threshold=0.1,
        scale=max(1.0, scale),
    )

    # Rebuild tables. TableFormer works out which cells belong together, which
    # is what turns a grid of scattered words into a real Markdown table.
    options.do_table_structure = True
    options.table_structure_options = TableStructureOptions(do_cell_matching=True)

    # CPU threads and device. Docling defaults are reasonable, but asking for the
    # device we already detected keeps one source of truth. On the CPU we cap the
    # threads: Docling already uses several per step, and taking every core makes
    # the machine unresponsive.
    device = detect_device()
    options.accelerator_options = AcceleratorOptions(
        device=device if device in ("cuda", "mps") else "cpu",
        num_threads=min(os.cpu_count() or 1, 8) if device == "cpu" else 4,
    )

    options.images_scale = scale

    # Do not extract images or screenshots out of the document. A photo or logo
    # becomes a small placeholder tag in the Markdown instead. This keeps memory
    # use flat, which matters when a 200-page document arrives.
    options.generate_picture_images = False
    options.generate_table_images = False
    options.generate_page_images = False

    return DocumentConverter(
        allowed_formats=ALLOWED_FORMATS,
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=options),
            InputFormat.IMAGE: ImageFormatOption(pipeline_options=options),
        },
    )


# ---------------------------------------------------------------------------
# The whole job
# ---------------------------------------------------------------------------

def image_to_markdown(converter, image_path):
    """Run one page image through Docling and return its Markdown."""
    result = converter.convert(str(image_path))
    return result.document.export_to_markdown()


def convert_document(converter, source, max_pages=None, scale=DEFAULT_IMAGE_SCALE):
    """
    Convert a PDF or an image into Markdown. This is the function the worker calls.

    source:     path to a PDF, PNG, JPG, TIFF or WEBP
    max_pages:  stop after this many pages, or None for all of them
    scale:      see DEFAULT_IMAGE_SCALE above

    Returns the document as one Markdown string.
    """
    is_pdf = str(source).lower().endswith(".pdf")

    # An image is already what we want, so hand it straight to Docling.
    if not is_pdf:
        return image_to_markdown(converter, source)

    # A PDF needs rendering first.
    page_images = pdf_to_images(source, max_pages=max_pages, scale=scale)
    if not page_images:
        return ""

    # A comment marking where each page starts, so a reader of the Markdown can
    # tell the pages apart. A single-page document gets no marker.
    page_markers = len(page_images) > 1
    total = len(page_images)

    pages = []
    try:
        for index, image_path in enumerate(page_images, start=1):
            markdown = image_to_markdown(converter, image_path)
            if page_markers:
                markdown = f"<!-- Page {index} of {total} -->\n{markdown}"
            pages.append(markdown)
    finally:
        # Runs even if something above raised, so we never leave stray temp files.
        delete_images(page_images)

    return "\n\n".join(pages)