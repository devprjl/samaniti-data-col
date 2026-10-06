# OCR Pipeline Guide

How a stored document becomes readable text, end to end.

The scraper collects documents; this guide is about reading them. It is a separate
process with its own queue, deliberately decoupled from the crawl — see
[Why the queue exists](#why-the-queue-exists).

For how the documents get collected in the first place, see
[the scraper pipeline guide](scraper-pipeline-guide.md).

---

## The shape of it

```text
  scraper ──LPUSH──►  Redis list ──BRPOP──►  worker ──►  documents.ocr_data
                                                     │
  browser ──POST──►  API ──claim + LPUSH─────────────┘
```

Nothing waits on anything else. The scraper never blocks on a conversion, and a
conversion never fails a scrape.

There are three processes:

| Process | File                     | Role                                                                        |
| :------ | :----------------------- | :-------------------------------------------------------------------------- |
| Worker  | `services/ocr/worker.py` | Pops jobs, converts, writes to the database                                 |
| API     | `services/ocr/server.py` | Health checks and manual backfills. **Nothing calls it in the normal path** |
| Triage  | `services/ocr/sweep.py`  | Marks documents whose host is gone                                          |

And one document-level tool:

```bash
npm run ocr:pages -- --limit 5000   # backfill page counts onto an old backlog
```

---

## Running it

```bash
npm run ocr:enqueue -- --limit 100     # fill the queue, once
npm run ocr:enqueue -- --all           # everything still waiting
npm run ocr:enqueue -- --municipality POKHARA1

npm run ocr:worker                     # convert, until you stop it
npm run dev                            # web app and worker together

npm run ocr:sweep -- stats             # what is in the backlog
npm run ocr:sweep -- unreachable --limit 500 --mark
```

`npm run ocr:server` is not needed. The scraper and the browser page both write to
Redis and Postgres directly; the container runs the API through its own entrypoint.

---

## The three conversion steps

Everything happens in `ocr/pipeline.py`, in three steps:

```text
  1. PDF  ──►  one image per page      (pypdfium2)
  2. image ──►  the words on it        (EasyOCR)
  3. words ──►  Markdown with headings
                and real tables         (Docling)
```

Then `worker.py` writes the Markdown into the database.

### Why a PDF is turned into images first

The government documents here embed fonts such as Preeti and Kantipur, which have
no usable Unicode equivalent. Reading the text layer of such a PDF produces garbage
before OCR even starts. Drawing each page as a picture throws that broken text away
and EasyOCR reads the picture — the same thing a person would do.

This has a consequence worth being explicit about: **OCR is the only source of
text.** There is no fallback to the embedded layer, so whatever the recognizer emits
is what a reader sees.

### Why Docling is still involved

EasyOCR only reads words off a picture. It knows nothing about which words are a
heading, which are body text, or which sit in a table. Docling works out the page
layout, puts everything in reading order, rebuilds tables with its TableFormer
model, and writes the Markdown.

So the two do not overlap: **EasyOCR reads the words, Docling arranges them.**
Tables in particular come from Docling, not from the OCR engine.

### Which languages

Nepali, Hindi and English, from `LANGUAGES` in `ocr/config.py`. The models download
on first run and are cached after that.

### Known weakness

EasyOCR makes mistakes on Devanagari vowel signs — it will sometimes read `भएको`
as `भएकोे`. That is the engine, not a bug in the pipeline. Raising image sharpness
(`--scale 3.0`) helps more than anything else.

---

## Reading the code

| File              | What to look at                            |
| :---------------- | :----------------------------------------- |
| `ocr/pipeline.py` | The three steps. Start here.               |
| `ocr/config.py`   | Languages, and whether a GPU is usable     |
| `worker.py`       | The queue loop and the job lifecycle       |
| `db.py`           | The status vocabulary and the atomic claim |
| `server.py`       | Five routes, all thin                      |

The single best exercise: breakpoint `worker.py` where it calls
`convert_document`, step into `ocr/pipeline.py`, follow one document all the way to
Postgres.

---

## Why the queue exists

Running one document at a time by hand does not scale to thousands of documents,
so work is queued and a worker drains it.

The claim is one atomic statement that moves documents from `pending` to `queued`
and returns only the rows _that call_ took. `FOR UPDATE SKIP LOCKED` lets concurrent
claimers skip rows another claimer is holding instead of blocking. Without it,
clicking "enqueue" twice queued the same backlog twice.

It also reclaims stranded work: `queued` older than 60 minutes, `processing` older
than 360. That is what stops one `SIGKILL` from stranding documents forever.

### The status lifecycle

```text
pending ──► queued ──► processing ──► completed
   │           │            │
   │           └────────────┴──► failed
   └──────────────────────────────► skipped
```

The producers own `queued`. The worker owns the other three.

---

## Shortest documents are converted first

A conversion costs about a minute per page, and the cost of a document is known
before it is queued. So the queue takes the shortest documents first: a one-page
notice is not made to wait behind a two-hundred-page gazette.

Measured on a sample of this collection: **median 6 pages, 90th percentile 36,
longest 140**, with 60% at ten pages or fewer. Under arrival order, most documents
sit behind a tail that takes weeks to clear.

The page count lives in `documents.metadata.pageCount` and is read without
downloading the file — see
[the scraper guide](scraper-pipeline-guide.md#document-metadata-and-page-counts)
for how.

### The page count is guaranteed, not hoped for

Three layers, each able to establish it:

1. **The scraper probes at extraction.** A ranged read of the PDF's page tree, so
   no download.
2. **Enqueue resolves anything missing.** `enqueuePendingDocuments` probes any
   eligible document with a null `metadata` _before_ it claims anything. So a
   document cannot be ordered by a number nobody measured. Verified: 12 unprobed
   documents in, 0 out, and all 5 claimed documents carried a real count.
3. **The worker measures it exactly.** After downloading, `count_pages` reads the
   page tree of the whole file and writes it back. This is authoritative, and it
   converges — any PDF whose page tree sat outside the readable windows arrives at
   the worker uncounted and leaves counted.

### Two things the ordering deliberately does not do

**An unreadable count sorts last, not first.** If the host is gone, sorting it to
the front would waste the queue on documents that can never convert. The claim
reads `metadata.reachable` for exactly this.

**Anything queued longer than a week is promoted to the front**, regardless of
length, so the long gazettes and policies — the most valuable thing here — cannot be
starved by a stream of one-page notices.

A week is longer than it looks. At roughly a minute a page, working through this
backlog takes on the order of a fortnight, so a shorter window would fire for the
whole queue at once and silently turn the ordering back into arrival order.

---

## Throughput

One worker converts one document at a time. Run more to convert more at once —
Redis hands each job to exactly one worker, so N workers means N documents with no
duplicate work.

It is limited by CPU, not by code. A single conversion already claims every core,
so a second worker on the same cores does not double throughput. Measured on a
4-core laptop: 154s for two pages with one worker, 111s with two. About 1.4x.

**On Kubernetes**, this is one Deployment with `replicas: N`, one worker per pod,
`requests.cpu == limits.cpu`, and no CPU limit on the web side.

---

## Most of the backlog cannot be read

Around four documents in five point at a municipal website that no longer answers.
The worker's download fails, the document is marked `failed`, and it sits there —
which looks like a backlog of work while being neither processable nor interesting.

`sweep.py` separates _"we have not gotten to this yet"_ (`pending`) from _"this can
never be processed"_ (`skipped`). It reports first and only writes with `--mark`,
and only to rows still `pending`, so it can never overwrite a result a worker is
holding.

`failed` is deliberately left alone. A failure is evidence about one attempt; a host
being down now says nothing about whether it was reachable when the portal was
alive.

---

## Troubleshooting

| Symptom                                              | Look at                                                                          |
| :--------------------------------------------------- | :------------------------------------------------------------------------------- |
| Nothing happens, queue drains, documents go `failed` | `npm run ocr:sweep -- unreachable` — the hosts are gone                          |
| Text is garbled or empty                             | Image resolution. Try `--scale 3.0` before blaming the engine                    |
| One page reads as `भएकोे`                            | Known EasyOCR weakness on Devanagari vowel signs                                 |
| Worker exits at startup                              | `REDIS_URL` unset in `.env`. Compose injects it into the container, not the host |
| Documents stuck `queued`                             | No worker running. Reclaimed after 60 minutes automatically                      |
