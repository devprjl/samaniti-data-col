# OCR Robust

Multilingual OCR and document understanding for **Nepali (नेपाली)**, **Hindi (हिन्दी)** and **English**, built on [Docling](https://github.com/DS4SD/docling).

The OCR engine is **selected at runtime** from what is actually installed and usable on the machine, so the same code runs unchanged on a workstation, a laptop, a CPU-only server, or inside a container.

---

## Requirements

**Python 3.10 – 3.13. Python 3.13 is recommended.**

| Python | Status |
| :--- | :--- |
| 3.13 | ✅ **Recommended** — newest version where every engine installs |
| 3.12, 3.11, 3.10 | ✅ Supported |
| 3.14+ | ⚠️ EasyOCR only — PaddlePaddle has no cp314 wheel, and SuryaOCR needs `Pillow<11` (newest is 10.4.0, cp313 max) |

### Setting up with mise

`mise.toml` in the repo root pins Python 3.13, so:

```bash
mise install          # installs the pinned 3.13
python -m venv services/ocr/.venv
pip install -r services/ocr/requirements.txt
```

Or explicitly:

```bash
mise use python@3.13
python -m venv services/ocr/.venv
pip install -r services/ocr/requirements.txt
```

That is the whole setup. The `npm run ocr:*` scripts expect the environment at
`services/ocr/.venv`. Then:

```bash
python services/ocr/main.py document.pdf
```

### Without mise

Any Python 3.13 install works the same way — the `python3.13` binary, pyenv, the
py launcher, or your OS package manager are all fine.

---

## Optional engines

Both are auto-detected. If one cannot run here, the tool says why on startup and
continues with the rest — it never crashes on a missing engine.

```bash
pip install paddlepaddle paddleocr   # PaddleOCR
pip install surya-ocr                # SuryaOCR
```

Neither is a plain `pip install` and finish. Each has a runtime prerequisite:

| Engine | Extra requirement |
| :--- | :--- |
| `paddleocr` | **AVX-512 CPU.** PaddlePaddle's oneDNN kernels fail on the first inference on AVX2-only processors, so the engine is reported unavailable there. |
| `suryaocr` | **An inference backend.** Current releases delegate to vLLM (Docker + NVIDIA runtime) or llama.cpp. On CPU: install `llama-server` and `export SURYA_INFERENCE_BACKEND=llamacpp`. On GPU: vLLM via Docker. |

---

## Install

From the repository root, with mise:

```bash
mise install
python -m venv services/ocr/.venv
pip install -r services/ocr/requirements.txt
```

Or with any other Python 3.13:

```bash
python3.13 -m venv services/ocr/.venv
pip install -r services/ocr/requirements.txt
```

Optional engines can also be installed via extras:

```bash
pip install -e "services/ocr[paddle]"
pip install -e "services/ocr[surya]"
```

The development tools — ruff, mypy, pytest — come from `requirements-dev.txt`:

```bash
pip install -r services/ocr/requirements-dev.txt
ruff check services/ocr
```

---

## Usage

```bash
python main.py <source> [options]
```

`<source>` is a local PDF or image (`.png`, `.jpg`, `.tiff`, `.webp`) or a URL.

```bash
# Let the tool pick the best available engine
python main.py document.pdf

# Force a specific engine
python main.py document.pdf --engine paddleocr
python main.py document.pdf --engine suryaocr
python main.py document.pdf --engine easyocr
python main.py document.pdf --engine vlm --model smoldocling

# Test-drive the first few pages
python main.py document.pdf --max-pages 5
```

Output is written to `output/`. Set `OCR_OUTPUT_DIR` to change the location.

---

## As a service

The CLI above is for one document at a time. In this repository the OCR runs
unattended instead, as a queue, because a conversion takes minutes and nobody is
going to sit and type a command for three thousand documents.

The scraper pushes a job onto a Redis list; a worker pops it, converts the document,
and writes the Markdown into `documents.ocr_data`. Nothing calls the Flask API in
that path — it exists for health checks and for manual backfills.

```bash
# The API, with a worker running inside it
python server.py --with-worker

# Or the worker on its own, which is what you want to scale out
python worker.py --engine easyocr

# Inspect the queue
curl localhost:5050/health
curl localhost:5050/queue

# Queue one document by hand
curl -X POST localhost:5050/jobs \
  -H 'Content-Type: application/json' \
  -d '{"document_id":"...","source_url":"https://.../notice.pdf"}'

# Queue a batch of everything still waiting
curl -X POST localhost:5050/jobs/enqueue-pending -d '{"limit":100}' \
  -H 'Content-Type: application/json'
```

Both entry points read `DATABASE_URL` and `REDIS_URL` from the repository's `.env`, or
from the environment in a container. See `.env.example`.

### Triage

Most of the backlog is unprocessable, because it points at municipal websites that no
longer answer. `sweep.py` finds those and, on request, marks them skipped so the real
backlog is visible:

```bash
python sweep.py stats                  # current status breakdown
python sweep.py unreachable --limit 500          # report only
python sweep.py unreachable --limit 500 --mark   # write "skipped"
```

---

## Engines

| Engine | Accuracy on Devanagari | Tables | Requires |
| :--- | :--- | :--- | :--- |
| `paddleocr` | High | Yes | `paddlepaddle` + `paddleocr`, **AVX-512 CPU** |
| `suryaocr` | High | Yes | `surya-ocr` + vLLM (Docker/NVIDIA) or `llama-server` |
| `easyocr` | Good | Yes (TableFormer) | included by default |
| `vlm` | Highest, slowest | Yes | `docling` + model download |

`--engine auto` (the default) picks the best engine that is actually **runnable**
on this machine — not merely installed. Anything unusable is listed with the
specific reason at startup. Requesting an unavailable engine falls back
automatically rather than failing.

### Tables and images

- **Tables** are reconstructed by Docling's TableFormer, not by the OCR engine.
  Only *text recognition* is delegated, so switching engines changes the words,
  never the table markup — the table renders identically either way.
- **Images** are not extracted. A picture becomes a `<!-- image -->` placeholder
  tag, so no image bytes are written and memory use stays flat on small machines.

---

## Hardware

There is no hardware table, because behaviour is decided by capability rather
than by device name:

- **GPU use is verified, not assumed.** A GPU is only used if it can actually
  execute a kernel. A visible-but-incompatible card (for example an older
  Pascal GPU against a newer PyTorch build) reports itself available and then
  fails on first use; the tool detects that and falls back to CPU instead of
  crashing mid-document.
- **Anything unusable degrades to CPU**, including a forced `--device cuda` on a
  machine without a working one.
- **No VRAM table.** When a VLM engine is used, the preset is chosen from a
  capacity floor so an oversized model is never selected for a small device.

Any of these are equivalent and need no special setup:

```bash
python main.py doc.pdf                              # auto-detect
python main.py doc.pdf --device cpu                 # force CPU
OCR_DEVICE=cpu python main.py doc.pdf               # via environment
```

Useful environment variables:

| Variable | Purpose |
| :--- | :--- |
| `OCR_DEVICE` | `cpu` / `cuda` / `mps`; falls back if unavailable |
| `OCR_OUTPUT_DIR` | Output directory |
| `HF_HOME` | Model cache location |
| `DOCLING_CACHE` | Docling model cache |

---

## Container

The build context is the **repository root**, not this directory: `Dockerfile.ocr`
lives one level up and copies `services/ocr/` into the image.

```bash
# From the repository root.
# Baseline (EasyOCR, CPU) — smallest and most portable
docker build -f Dockerfile.ocr -t samaniti-ocr .

# With PaddleOCR
docker build -f Dockerfile.ocr -t samaniti-ocr --build-arg WITH_PADDLE=1 .

# With SuryaOCR
docker build -f Dockerfile.ocr -t samaniti-ocr --build-arg WITH_SURYA=1 .
```

`docker-compose.yml` at the repository root builds this image and runs it beside
Postgres and Redis. See the root README for the short version.

The image runs the service, not a one-off conversion:

```bash
docker compose up -d
curl -s localhost:5050/health
```

Model weights are cached on the `/models` volume, so the first run is paid for once
and later rebuilds do not re-download them. The image defaults to Python 3.13, the
newest interpreter with wheels for torch, paddlepaddle and surya-ocr alike.

To run one document through the image directly, override the command:

```bash
docker run --rm samaniti-ocr python main.py /data/document.pdf
```

GPU hosts use the same image with the GPU passed at run time:

```bash
docker run --rm --gpus all -v "$PWD:/data:ro" samaniti-ocr \
  python main.py /data/document.pdf
```

---

## Notes

- PaddleOCR and SuryaOCR have been verified to install and initialise on Python
  3.13, and both are exercised through the full pipeline. Their *accuracy
  figures* are not published here because neither could complete inference on
  the test machine (AVX2-only CPU for Paddle; no inference backend for Surya).
- Preeti and Kantipur legacy fonts have no usable Unicode mapping. If a PDF
  embeds those fonts, the text layer is unreadable before OCR even starts —
  such documents need to be rasterized first, and are handled as images.
- Recognition thresholds are set low deliberately: Devanagari confidence runs
  lower than Latin, and a strict cutoff silently drops valid text. Docling's
  layout model filters noise afterwards.
