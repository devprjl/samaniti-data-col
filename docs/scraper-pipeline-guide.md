# Scraper Pipeline Guide

How the scraper works, end to end — from HTTP requests and DOM extraction, through
document normalization and high-resolution media recovery, to database persistence
and telemetry.

This guide covers the scraper only. OCR reads the documents the scraper collects
and is a separate process with its own queue; that is
[the OCR pipeline guide](ocr-pipeline-guide.md).

---

## Running it

From the command line, on your machine:

```bash
npm run scraper                    # every municipality in both provinces
npm run scraper madhesh            # every municipality in one province
npm run scraper lumbini:banganga   # one municipality
```

The scraper prints what it finds as it goes, and a summary at the end. Every run is
also recorded in the database, which is where the site's "Collection activity" page
gets its data.

Records land in the database straight away — run a scraper and refresh the website
to see them.

In a container, the scraper is a batch job and gets its own image with Chromium in
it, which you start when you want to crawl:

```bash
docker compose --profile scraper run --rm app npm run scraper lumbini:banganga
```

Scraping is disabled on the live site: `NODE_ENV=production` turns the workspace
router off, so nobody can start a crawl from the public site.

---

## The ETL Lifecycle

A scraper execution is five stages, all implemented in one place — `runScraperPipeline` in `src/core/scraper/pipeline.ts`:

```text
┌───────────────────────────────────────────────────────────────┐
│ 1. Resolution — which routes run, and with what pagination    │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌───────────────────────────────────────────────────────────────┐
│ 2. Extraction — Crawlee CheerioCrawler                        │
│    - Listing pages (DOM scoping)                              │
│    - Pagination discovery (when enabled)                      │
│    - Detail pages (link discovery, scoping)                   │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌───────────────────────────────────────────────────────────────┐
│ 3. Transformation — one page at a time                        │
│    - Transformer dispatch by route type                       │
│    - Title, content, date and fiscal-year normalization       │
│    - Category tagging ('notice', 'project', 'report', …)      │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌───────────────────────────────────────────────────────────────┐
│ 4. Documents & media                                          │
│    - Drupal thumbnail un-styling to full resolution           │
│    - Embedded DFlip flipbook PDF extraction                   │
│    - Optional download to storage/                            │
└──────────────────────────────┬────────────────────────────────┘
                               ▼
┌───────────────────────────────────────────────────────────────┐
│ 5. Loading — Prisma upserts on unique sourceUrl               │
│    - Documents connectOrCreate on unique originalUrl          │
│    - ScraperRun row written in a finally block                │
└───────────────────────────────────────────────────────────────┘
```

Two properties matter for everything that follows:

- **The whole sequence is single-sourced.** The CLI runner and the web workspace both reach a scraper through `scraper.run()`, so there is exactly one definition of what an execution does.
- **Telemetry is written last, always.** The `scraper_runs` row is created in a `finally` block, so a failed run is recorded with the same shape as a successful one.

---

## Starting a Run

There are three ways in, and all three converge on the same code path.

| Entry point                | Command / action                             | Scope                                       |
| :------------------------- | :------------------------------------------- | :------------------------------------------ |
| CLI runner                 | `npm run scraper`, `npx tsx runner.ts …`     | All, a province, or one municipality        |
| Scraper workspace (web UI) | Click **Run this route** on `/workspace`     | One route, or every route of a municipality |
| Direct execution           | `npx tsx src/scrapers/<prov>/<mun>/index.ts` | That municipality                           |

`index.ts` only auto-executes when it is the process entrypoint, which is what lets the API import the class and drive it itself.

---

## 1. Resolution — Route Selection and Pagination

Before any network request, the pipeline decides what to collect.

### Route selection

`selectRoutes(routes, config.routeNames)` in `src/core/scraper/route-selection.ts` narrows the scraper's `ROUTES` array. A run without `routeNames` keeps every route, which is why a full municipality run behaves exactly as it always has.

Route names are the slug of the route's `live` URL, and matching is deliberately forgiving — `budget-program`, `budget_program` and the full listing URL all resolve to the same route. A route declared more than once in one `extract.ts` is selected in full: running `budget-program` executes every configuration declared under that name.

### Pagination

Pagination is resolved per run, in this order:

1. `ScraperConfig.pagination` — an explicit override.
2. `SCRAPER_PAGINATION` — the environment variable.
3. Default: `false`.

`resolvePaginationSetting` also reports which source was used, and the crawler logs it:

```text
[Runner] Pagination: First listing page only (default).
[Runner] Pagination: All listing pages (config).
```

The default stops at the first listing page. For portals that do not paginate that is already the complete content, so the default is safe everywhere; paginated portals need either `SCRAPER_PAGINATION=true` or a per-run override from the workspace.

---

## 2. Extraction (`src/core/scraper/crawler.ts`)

`crawlRoutes` is built on Crawlee's `CheerioCrawler`:

- **Isolated queues** — one `RequestQueue` per route (`queue-<type>-<timestamp>`), dropped afterwards, so pages cannot bleed between routes or accumulate between runs.
- **Polite crawling** — an inter-route delay and a `preNavigationHooks` delay before every request, because municipal servers (typically Nginx) rate-limit aggressively. Navigation and handler timeouts are 120 s, with 2 retries.
- **Listing traversal** — the listing page is scoped with `contentSelector`. When pagination is enabled, further pages are discovered from the pager and enqueued from page 1 only.
- **Detail traversal** — when `detailSelector` is set, links are extracted from the scoped listing HTML and enqueued; each detail page is scoped with `detailContentSelector` (falling back to `contentSelector`).
- **Listing-as-content** — when no `detailSelector` is set, the listing page itself is the content and is pushed directly.
- **Error pages** — responses with a status of 400 or above are skipped, so a 404 or 429 cannot be parsed as a valid record.
- **Output** — an array of `ScrapedPage` objects: URL, scoped HTML, `routeType` for transformer dispatch, and `category` (the route slug) which becomes the record's `type`.

---

## 3. Transformation (`src/scrapers/<province>/<municipality>/transform.ts`)

The pipeline transforms and loads **one page at a time** rather than in one batch, so a single malformed page cannot discard the records already collected in the same run. Failures are counted in `pagesFailed` and logged; the run continues.

`executeTransform` (`src/core/constants/transformers.ts`) dispatches each page by `routeType` to the right transformer — listing rows versus detail pages, per entity type.

Every transformer maps into the unified `PolicyEntityData` model:

- `category` — normalized to `notice`, `project`, `report`, …
- `type` — the route slug, which is how a record stays attributable to its route
- `titleNe` / `titleEn`, `contentNe` / `contentEn`
- `publishedDate` — from `<time datetime>`, `dc:date` metadata, or a submitted wrapper
- `fiscalYear` — via `parseNepaliFiscalYear` (`२०८०/०८१` → `2080/81`)
- `budgetAmount`, `status`, `wardNo`
- `sourceUrl` — the canonical URL and the deduplication key

---

## 4. Documents and High-Resolution Media (`src/core/utils/html.ts`)

Attachments on municipal portals are frequently scanned images, photographs of physical notices, or interactive flipbooks.

### Recovering original media

Drupal renders image fields as downscaled derivatives:

- **As published in the DOM**: `…/files/styles/thumbnail/public/field/image/Notice.png?itok=NZZ6oq5X` — small and often illegible.
- **Original upload**: `…/files/field/image/Notice.png` — full resolution.

`normalizeOriginalImageUrl`:

1. Strips style segments — `/\/styles/[^/]+/(public|private)\//` → `/`.
2. Strips the derivative token (`?itok=…`).
3. Prefers the anchor's target when an image is wrapped in one pointing at a media file.
4. Preserves the decoded filename from the URL path.

### Embedded flipbooks

DFlip PDFs are frequently embedded in inline JavaScript rather than linked:

```regex
/var\s+pdf\s*=\s*['"]([^'"]+\.pdf[^'"]*)['"]/gi
```

Each attachment becomes a `DocumentData` with a decoded `fileName`, the canonical un-styled `originalUrl`, a `fileType`, and a `downloadStatus` of `skipped`. Nothing fetches the file itself, so a run is cheap and the portal serves the portal's own copy.

---

## 5. Loading and Persistence (`src/core/db/loader.ts`)

Writes go through Prisma against PostgreSQL:

1. **Municipality upsert** — by unique `code` (e.g. `BARDAGHAT`). Note this is the code from `transform.ts`, which does not always match the folder name (`harion-mun` is `HARIWON`).
2. **Policy upsert** — matched on the unique `sourceUrl`; the loader first checks existence so it can report added versus updated.
3. **Document linking** — `connectOrCreate` on the unique `originalUrl`, with in-payload deduplication to avoid unique-constraint clashes.
4. **Document metadata** — the page-count probe's result, when there is one. See below.

---

## Document metadata and page counts

Every document is a row in `documents`, and `documents.metadata` is a `JSONB`
column holding facts about the file itself. Today it carries the page count, which
the OCR queue sorts by — see
[the OCR pipeline guide](ocr-pipeline-guide.md#shortest-documents-are-converted-first)
for why that ordering exists.

The scraper is where the count is learned, because it is the only moment the
document is known to exist.

### One way to build a document

Documents are discovered in two ways, but they are constructed in exactly one place.

`extractDocumentLinks` in `utils/html.ts` scans a page's markup for links to files —
anchors, `<object>`, `<embed>`, `<img>`, and the JavaScript that configures a DFlip
flipbook. It applies the ignore-list (Adobe Reader downloaders, logos, icons),
recovers full-resolution image URLs, derives a readable filename from the link text,
and de-duplicates by URL. This is what routes use.

`buildDocument` in `utils/document.ts` covers the one case the scanner cannot: a page
that _is_ the document, such as a detail page served straight as a PDF. There is no
link on the page pointing at the page, so nothing to scan for.

Both call `createDocument`, which is the only function that builds a `DocumentData`.
That matters because the two used to be separate implementations that had drifted:
one wrote `fileType` as a MIME type and the other as a bare extension, and one wrote
`downloadStatus: "pending"` while the other wrote `"skipped"`. The same file scraped
by two municipalities produced two different rows. They now agree by construction.

### What makes a document the same document

**The source URL, and nothing else.** Not the filename, not the title.

That is enforced in four places, all keyed on the same normalised URL — absolute,
no query string, no fragment:

1. **Within one page**, `extractDocumentLinks` holds documents in a `Map` keyed by
   the document's own `originalUrl`. A link to the same file appearing in three
   places on a page is one document.
2. **Within one transform's payload**, the loader de-duplicates by `originalUrl`
   before writing, so a listing row and its detail page do not double up.
3. **In the database**, `documents.original_url` carries a `UNIQUE` constraint. This
   is the real guarantee; the two above are just cheaper than catching it here.
4. **Across runs**, the write is an upsert on that same column, so re-scraping a
   page updates its documents rather than adding more.

The filename is never a key, and cannot be. In this collection **22 filenames are
each shared by more than one distinct URL** — municipal portals publish
`5.pdf`, `6.pdf`, `notice.pdf` and similar repeatedly, often for entirely different
documents. Keying on the filename would have merged those into one.

Normalising the URL before using it as a key is what makes `?download=1` and the bare
URL the same document. It also means a portal that changes its link format does not
silently create a second row for a file already collected — and, correspondingly,
that the URL stored is not always byte-identical to the one in the markup.

### How a page count is read without downloading the file

`probePdfMetadata` in `src/core/utils/pdf-metadata.ts` reads a PDF's `/Count`
entry — the page tree's own statement of how many pages it has — out of two small
ranged requests rather than downloading the whole document. A few hundred
kilobytes instead of the tens of megabytes a full fetch would cost.

Three branches, in order of how cheap they are:

1. **An image is one page.** Checked from the URL's extension with no network call
   at all. About 8% of this collection is a bare `.jpg` or `.png`, and those
   documents are the cheapest in the backlog, so this is the highest-value branch
   and the only free one.
2. **The `HEAD` response says it is an image.** Needed because roughly a third of
   these files have no useful extension — many are named after their Nepali title —
   so an image among them is invisible until something says so. `HEAD` also yields
   the file size.
3. **Two ranged reads.** The first 256KB, then the last 256KB if that found
   nothing. The head is tried first because measured against these documents
   `/Count` is always in the opening window and never in the tail, so the common
   case costs one request.

### The field that matters more than the page count

`metadata.reachable` records whether the file answered **at all**, which is a
different question from whether its page tree could be parsed:

| Outcome                              | Meaning                                         | What happens to it                                                                                 |
| :----------------------------------- | :---------------------------------------------- | :------------------------------------------------------------------------------------------------- |
| `reachable: true`, `pageCount: 3`    | Measured                                        | Queued, sorted at its true cost                                                                    |
| `reachable: true`, `pageCount: null` | Answered, but `/Count` was outside both windows | Queued, sorted last; the OCR worker measures it exactly once it has the file                       |
| `reachable: false`                   | Host is gone, or the file is not there          | Never queued — the download would fail too. `npm run ocr:sweep -- unreachable` marks these skipped |

Without that field the two failure modes are indistinguishable, and a queue that
treats "unknown" as "reachable" spends its time re-failing downloads of documents
whose hosts died months ago.

A page count is **never guessed**. A wrong count is worse than no count, because
the queue would then be ordering on a number nobody can trust.

### Why the timeouts are long

These are small municipal portals on slow connections. Measured against live
documents from this collection, a single `HEAD` regularly takes 7–20 seconds. At an
8-second timeout the probe failed on twelve of twelve real documents; at 30 seconds
it read almost all of them. A timeout tuned to a data centre would report most of
the backlog as unmeasurable and silently disable the ordering it exists to provide.

### Where the measurement happens

Not in the document builders — both are synchronous and cheap, and a probe is
neither. It happens once, in the pipeline, on the way to the database:
`resolveDocumentMetadata` in `utils/pdf-metadata.ts`, called between `transform()`
and `load()` in `core/scraper/pipeline.ts`. Every document passes through that one
point, so a route added later is measured without anyone remembering to.

It costs a round trip per document to a municipal server that takes 7–20 seconds to
answer, so it is I/O wait rather than CPU, and it can be turned off with
`OCR_PROBE_DURING_SCRAPE=false` for crawls where that wait is unwelcome. Documents
written without a count are not lost either way: the OCR queue probes anything
unmeasured before it claims it.

### Writing it back on a re-scrape

This is the part that is easy to get wrong, and it was. Prisma's `connectOrCreate`
only runs its `create` branch on first insert and cannot update an existing row, so a
measurement would be written once and then frozen — a portal that replaced a long PDF
with a one-page notice would keep being costed as a long document forever. Since
these documents are re-scraped routinely, that mattered.

So `refreshDocumentMetadata` runs a second pass after the upsert, and only for
probes that actually measured something. A probe that found the host gone records
`reachable: false`, and that deliberately does **not** overwrite a page count an
earlier scrape established: portals go down, and a document would otherwise lose its
count because its server was unreachable today.

### Re-running the scraper

Nothing here is one-shot. Re-running a scraper re-probes every document it finds
and rewrites `metadata`, so a portal that has come back to life, or a PDF that has
been replaced with a shorter one, is picked up correctly.

For the backlog that predates this column:

```bash
npm run ocr:pages -- --limit 5000
```

It is safe to interrupt and safe to run repeatedly: counts are written as they are
learned, and a document that already has one is skipped. Add `--refresh` to
re-probe, `--municipality POKHARA1` to narrow the scope, `--dry-run` to report
without writing. Expect it to be slow — that is the portals, not the tool.

---

## 6. Telemetry

At the end of every execution, in a `finally` block, `recordScraperRun` creates a single `scraper_runs` row:

- `scraperName` — the municipality code, which is how the dashboard groups runs
- `status` — `success`, or `failed` with the error message
- `itemsAdded` / `itemsUpdated` — tallied from the load results
- `durationMs`, `startedAt`, `endedAt`
- `municipalityId` — resolved from the code, or `null` if the scraper has never run

Because the write happens in `finally`, a run that throws still leaves a record — which is what makes failures diagnosable after the fact.

---

## Route-Level Execution from the Workspace

A route run started in the browser follows the same five stages, with two additions specific to hosting the run inside the API.

```text
POST /api/workspace/runs
   │
   ├─ validate: one active run, key resolves, route exists
   ├─ createJob()                    → status "running"
   ├─ captureConsoleLogs(sink)       → console.log now writes to the job as well
   │
   └─ runScraperTarget()  (not awaited) ──▶ stages 1–5
                                             │
   ◀── 202 { job }                            │
                                             ▼
GET /api/workspace/runs/:id  (polled every 1.5 s) → log grows → status "success"
```

- **Output capture** — `console-capture.js` replaces `console.log/warn/error` for the duration of the run, so every line the crawler and Crawlee emit is appended to the job's log buffer _and_ still printed in the server's terminal. The patch is restored in a `finally` block.
- **One run at a time** — because the capture is process-wide, a second concurrent run would interleave logs. The job store enforces a single active run and the API answers `409`.
- **Buffer limits** — 400 log lines and 25 jobs per server process. Durable history is the `scraper_runs` table; the in-memory registry only needs to outlive one run, and it is intentionally lost on restart.

---

## Pagination Behaviour in Practice

The same route, run two ways:

| Mode                      | Command                                | Result observed                            |
| :------------------------ | :------------------------------------- | :----------------------------------------- |
| First page only (default) | `SCRAPER_PAGINATION=false` (or absent) | Listing page 1 plus its detail pages       |
| All listing pages         | `SCRAPER_PAGINATION=true`              | Additional pages discovered from the pager |
| Override for one run only | Workspace pagination dropdown          | Applies to that run; `.env` untouched      |

Pagination is discovered from the DOM pager, which handles both 0-indexed (`?page=1` is the second page) and 1-indexed portals, and falls back from Drupal's `ul.pager` to a custom `.pagination` component.

---

## Failure Modes and Where to Look

| Symptom                                 | Likely cause                                                             |
| :-------------------------------------- | :----------------------------------------------------------------------- |
| `Route 'x' is not configured for …`     | The route name does not exist; the error lists the available names       |
| `[Crawler] Skipping error page (404)`   | The listing URL is wrong, or the portal moved                            |
| `found 0 detail link(s)`                | `detailSelector` no longer matches, or the listing is scoped incorrectly |
| `pagesFailed > 0`                       | One page failed to transform; the run continued, the page is logged      |
| `itemsUpdated` far exceeds `itemsAdded` | Records already existed — usually means the run was a re-run             |
| Run status `failed` in the workspace    | Read the run console panel; the message is also stored on the run record |

For anything route-specific, the workspace console shows the exact URLs that were visited, which is the fastest way to tell a selector problem from a portal problem.
