# OCR

Converts Nepali, Hindi and English **PDFs and images** into clean Markdown.

This file describes the service itself, file by file, for anyone working inside it.
For how the work is queued, ordered and operated, see
[the OCR pipeline guide](../../docs/ocr-pipeline-guide.md).

## How it works

Everything happens in three steps:

```
  1. PDF  ──►  one image per page      (pypdfium2)
  2. image ──►  the words on it        (EasyOCR)
  3. words ──►  Markdown with headings
                and real tables         (Docling)
```

Then `worker.py` writes the Markdown into the database. That is the whole
service.

**Why step 1 happens.** The government documents we handle embed fonts such as
Preeti, which have no usable Unicode equivalent. Reading the text layer of such a
PDF gives garbage before OCR even starts. Drawing each page as a picture throws
that broken text away, and EasyOCR reads the picture — the same thing a person
would do.

**Why step 3 is still needed.** EasyOCR only reads words off a picture. It knows
nothing about which words are a heading, which are body text, or which sit in a
table. Docling works out the page layout, puts everything in reading order,
rebuilds tables with its TableFormer model, and writes the Markdown.

So the two do not overlap: **EasyOCR reads the words, Docling arranges them.**

## Layout

| File | What it does |
| :--- | :--- |
| `ocr/pipeline.py` | **Start here.** The three steps above, as plain functions. |
| `ocr/config.py` | The few settings: which languages, which device. |
| `ocr/utils.py` | Cleans up a downloaded file's name so we can name the output. |
| `main.py` | Try it on one document from the command line. |
| `worker.py` | The real job: reads a queue, converts, saves to the database. |
| `server.py` | A small HTTP API for health checks and manual backfills. |
| `db.py` | The database queries. |
| `settings.py` | Loads `.env`. |
| `sweep.py` | Finds documents whose source website no longer exists. |

Start with `ocr/pipeline.py` — it is the only file that matters if you are trying
to understand the OCR itself.

## Setup

**Python 3.13 is recommended.** `mise.toml` in the repository root pins it.

```bash
mise install                                     # install the pinned Python 3.13
python -m venv services/ocr/.venv
services/ocr/.venv/bin/pip install -r services/ocr/requirements.txt
```

That is the whole setup — one dependency, `docling[easyocr]`, which brings in
EasyOCR and everything else.

The first run downloads the language models and takes a few minutes. Every run
after that reuses them from the cache.

## Try it on one document

```bash
cd services/ocr
.venv/bin/python main.py document.pdf
```

Options:

```bash
.venv/bin/python main.py document.pdf --max-pages 5     # just the first 5 pages
.venv/bin/python main.py document.pdf --scale 3.0       # for small or faded print
.venv/bin/python main.py scan.jpg                       # images work too
```

The Markdown is written to `output/`, or wherever `OCR_OUTPUT_DIR` points. The
first 1200 characters are printed to the terminal so you can see it worked.

Nothing here touches the database. That is `worker.py`'s job.

### If the text comes out wrong

Almost always the image resolution, not the engine. `--scale 2.0` is about 150
DPI. Try `--scale 3.0` first; it costs time and memory but fixes most faded or
small-print documents.

## As a service

Running `main.py` by hand does not scale to thousands of documents, so the real
path is a queue:

1. The scraper pushes a job onto a Redis list.
2. `npm run ocr:worker` pops the job, downloads the document, runs the three steps above.
3. The Markdown is written to `documents.ocr_data`, and the status updated.

```bash
# Fill the queue (one-shot), from the repository root
npm run ocr:enqueue -- --limit 100
npm run ocr:enqueue -- --all

# Convert, until you stop it
npm run ocr:worker

# Or run the web app and the worker together, in one terminal
npm run dev
```

The worker reads `DATABASE_URL` and `REDIS_URL` from the repository's `.env`. See
`.env.example`.

### Sweeping the backlog

Much of the backlog cannot be processed at all, because it points at municipal
websites that no longer answer. `sweep.py` finds those:

```bash
npm run ocr:sweep -- stats                         # status breakdown
npm run ocr:sweep -- unreachable --limit 500       # report only
npm run ocr:sweep -- unreachable --limit 500 --mark   # mark them skipped
```

From inside this directory it is the same thing:

```bash
.venv/bin/python sweep.py stats
.venv/bin/python sweep.py unreachable --limit 500
.venv/bin/python sweep.py unreachable --limit 500 --mark
```

## Configuration

| Variable | Purpose |
| :--- | :--- |
| `OCR_DEVICE` | `cpu` / `cuda` / `mps`. Falls back if the device is unusable. |
| `OCR_OUTPUT_DIR` | Where `main.py` writes `.md` files. |
| `HF_HOME` | Where model weights are cached. |
| `DOCLING_CACHE` | Where Docling caches its models. |

A GPU is used automatically if one works, and the CPU is used otherwise. This is
checked for real rather than assumed: a graphics card can be visible and still be
too old for the installed PyTorch, reporting itself available and then failing on
first use. We ask it to do a tiny matrix multiplication instead of trusting it.

### GPU hosts

Same image, GPU passed at run time:

```bash
docker run --rm --gpus all -v "$PWD:/data:ro" samaniti-ocr \
  python main.py /data/document.pdf
```

## Container

The build context is the **repository root**, not this directory: `Dockerfile.ocr`
lives one level up and copies `services/ocr/` into the image.

```bash
# From the repository root.
docker build -f Dockerfile.ocr -t samaniti-ocr .
docker compose up -d
curl -s localhost:5050/health
```

The image runs the service, not a one-off conversion. To run a single document
through it, override the command:

```bash
docker run --rm -v "$PWD:/data:ro" samaniti-ocr python main.py /data/document.pdf
```

Model weights live on the `/models` volume, so the first run is paid for once and
later rebuilds do not re-download them.

On Kubernetes, give the worker replicas a **CPU request equal to their limit** and
one worker per pod. Two workers sharing two cores are slower than one, not faster,
and docling already uses several threads per step.

## Notes

- **Only EasyOCR.** It is the single text-recognition engine, and it is included
  by default — there is nothing extra to install and nothing to choose at
  startup. It handles Nepali (`ne`), English (`en`) and Hindi (`hi`).
- **Tables come from Docling, not from the OCR engine.** Only the words are
  delegated, so the table markup is Docling's regardless of which words came back.
- **Images are not extracted.** A photo or logo becomes a small placeholder tag
  in the Markdown, so no image bytes are stored and memory stays flat on long
  documents.
- **Recognition thresholds are deliberately low** (0.1). Devanagari scores lower
  confidence than Latin even when it is right, and a stricter cutoff silently
  drops valid Nepali words.
- EasyOCR still makes mistakes on Devanagari vowel signs — it will sometimes read
  `भएको` as `भएकोे`. That is a known weak point of the engine, not a bug in the
  pipeline. Raising `--scale` helps more than anything else.