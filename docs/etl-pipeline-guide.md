# Comprehensive ETL Pipeline Guide

How data moves through the Samaniti ETL pipeline — from HTTP requests and DOM extraction, through document normalization and high-resolution media recovery, to database persistence and telemetry.

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

Each attachment becomes a `DocumentData` with a decoded `fileName`, the canonical un-styled `originalUrl`, a `fileType`, and a `downloadStatus` of `pending` (or `skipped` when `SKIP_FILE_DOWNLOADS=true`; `ok` or `failed` once a download has been attempted).

---

## 5. Loading and Persistence (`src/core/db/loader.ts`)

Writes go through Prisma against PostgreSQL:

1. **Municipality upsert** — by unique `code` (e.g. `BARDAGHAT`). Note this is the code from `transform.ts`, which does not always match the folder name (`harion-mun` is `HARIWON`).
2. **Policy upsert** — matched on the unique `sourceUrl`; the loader first checks existence so it can report added versus updated.
3. **Document linking** — `connectOrCreate` on the unique `originalUrl`, with in-payload deduplication to avoid unique-constraint clashes.

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
