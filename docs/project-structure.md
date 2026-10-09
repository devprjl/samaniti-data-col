# Project Structure & Architecture Guide

How this repository is laid out, what each module is responsible for, and which technologies and versions it depends on.

---

## Technologies & Versions

### Runtime and toolchain

| Tool         | Declared / installed | Node requirement               | Role                                                      |
| :----------- | :------------------- | :----------------------------- | :-------------------------------------------------------- |
| Node.js      | `24.x` (verified)    | `>=22.19.0`                    | Runtime. The floor comes from `undici@8`                  |
| npm          | `10+`                | —                              | Workspaces and `concurrently`                             |
| TypeScript   | `^5.3.3` / `5.9.3`   | —                              | Types, ESM build, strict mode, `NodeNext` resolution      |
| tsx          | `^4.23.13`           | `>=18`                         | Runs `.ts` directly for the CLI and the API               |
| Prisma       | `^7.10.0`            | `^20.19 \|\| ^22.12 \|\| >=24` | ORM, migrations, typed client                             |
| ESLint       | `^10.10.0`           | —                              | Linting for the TypeScript sources (`@typescript-eslint`) |
| oxlint       | `^1.81.0`            | —                              | Fast linting for the frontend workspace                   |
| Prettier     | `^3.9.7`             | —                              | Formatting (`tabWidth: 4`, `printWidth: 100`)             |
| husky        | `^9.1.7`             | —                              | Git hooks                                                 |
| lint-staged  | `^17.5.1`            | —                              | Pre-commit formatting/linting                             |
| concurrently | `^10.0.5`            | —                              | `npm start` runs the API and UI together                  |

> **Why `>=22.19`:** `undici@8.10.2` declares `engines.node >= 22.19.0`, which is stricter than Vite (`^20.19 || >=22.12`) and Prisma (`^20.19 || ^22.12 || >=24`). Node 20 will install with a warning and can fail at runtime during document downloads.

### Scraping and data processing

| Package               | Declared / installed | Node requirement | Role                                                              |
| :-------------------- | :------------------- | :--------------- | :---------------------------------------------------------------- |
| crawlee               | `^3.8.2` / `3.18.1`  | `>=16`           | `CheerioCrawler`, `RequestQueue`, polite crawling, retry handling |
| cheerio               | `1.0.0-rc.12`        | `>=6`            | DOM scoping and parsing in extract/transform stages               |
| undici                | `^8.10.2`            | `>=22.19.0`      | Attachment downloads with MIME verification                       |
| nepali-date-converter | `^3.4.0`             | —                | Bikram Sambat ↔ Gregorian conversion and fiscal-year parsing      |
| playwright            | `^1.63.0`            | `>=20`           | Headless browser, available for portals that need rendering       |

### Cloud storage

| Package                | Declared / installed | Role                                                          |
| :--------------------- | :------------------- | :------------------------------------------------------------ |
| `@aws-sdk/client-s3`   | `^3.x`               | `PutObjectCommand`, `HeadObjectCommand` for S3 uploads        |
| `@aws-sdk/lib-storage` | `^3.x`               | Multipart-upload helper (`Upload`) used for large attachments |

### Persistence

| Package              | Declared / installed | Role                                                                      |
| :------------------- | :------------------- | :------------------------------------------------------------------------ |
| `@prisma/client`     | `^7.10.0`            | Generated, typed database client (schema models)                          |
| `prisma`             | `^7.10.0`            | CLI for `generate`, `push`, migrations; configured via `prisma.config.ts` |
| `@prisma/adapter-pg` | `^7.10.0`            | Driver adapter wiring the client to `pg`                                  |
| `pg`                 | `^8.23.0`            | PostgreSQL wire protocol driver used by the adapter                       |

### API

| Package | Declared / installed | Role                                           |
| :------ | :------------------- | :--------------------------------------------- |
| express | `^4.18.2` / `4.22.3` | REST API for the dashboard (`src/web/backend`) |
| cors    | `^2.8.5`             | Cross-origin access for the Vite dev server    |

### Frontend

| Package              | Declared / installed | Role                                                |
| :------------------- | :------------------- | :-------------------------------------------------- |
| react / react-dom    | `^19.2.8` / `19.3.0` | UI; rendering is driven by the built-in client APIs |
| vite                 | `^8.3.0` / `8.3.0`   | Dev server (port `5173`) and production bundling    |
| @vitejs/plugin-react | `^6.1.1`             | React fast-refresh transform                        |

### Build and module layout

The repository is an **npm workspaces** monorepo with three packages:

```text
root (samaniti-data-col)         → scrapers, core framework, CLI runner
├── src/web/backend              → Express API
└── src/web/frontend             → React UI
```

Both the root and the API execute TypeScript through `tsx` at runtime; `tsc` is used for type-checking and emitting to `dist/`. Imports use ESM with the `NodeNext` resolver, which is why every relative import carries a `.js` extension even though the files are `.ts`.

---

## Directory Hierarchy

```tree
samaniti-data-col/
├── docs/
│   ├── project-structure.md        # This guide
│   ├── scraper-pipeline-guide.md   # How the scraper works, end to end
│   └── ocr-pipeline-guide.md       # How a document becomes readable text, end to end
├── prisma/
│   ├── schema.prisma               # Municipality, Profile, PolicyEntity, Document, ScraperRun
│   └── migrations/                 # SQL migration history
├── scripts/
│   ├── enqueue-ocr.ts              # Queue pending documents onto Redis
│   ├── reset-db.ts                 # Destructive local database reset
│   ├── deploy-probe.mjs            # Boots the API in a child process and checks it answers
│   └── verify-deployment.mjs       # Rehearses the Vercel build before shipping
├── services/
│   └── ocr/                        # Python OCR service: Flask API, queue worker, docling pipeline
│       ├── main.py                 # CLI: convert one document
│       ├── server.py               # Flask API, optionally hosting a worker thread
│       ├── worker.py               # Redis consumer; downloads, converts, writes to Postgres
│       ├── sweep.py                # Backlog triage: finds and marks unfetchable documents
│       ├── settings.py             # .env discovery and required-variable lookup
│       ├── db.py                   # psycopg access and the atomic "claim" documents
│       └── ocr/                    # The conversion package
│           ├── config.py           # Languages, and which device to run on
│           ├── pipeline.py         # The three conversion steps: PDF to image, EasyOCR, docling
│           └── utils.py            # Filename sanitization for downloaded files
├── src/
│   ├── core/
│   │   ├── constants/
│   │   │   ├── file.ts             # Allowed extensions and MIME maps
│   │   │   └── transformers.ts     # executeTransform(): dispatch pages to per-type handlers
│   │   ├── contracts/
│   │   │   └── scraper.interface.ts# RouteConfig, ScraperConfig, ScrapedPage, IMunicipalityScraper
│   │   ├── db/
│   │   │   └── loader.ts           # Prisma client, upserts, ScraperRun telemetry
│   │   ├── queue/
│   │   │   ├── redis.ts            # Shared ioredis client for the OCR queue
│   │   │   ├── ocr-producer.ts     # Claims pending documents and pushes them onto Redis
│   │   │   └── types.ts            # OcrStatus and the worker job payload
│   │   ├── scraper/
│   │   │   ├── crawler.ts          # Crawlee CheerioCrawler, route selection, pagination
│   │   │   ├── pipeline.ts         # The single extract → transform → load execution path
│   │   │   ├── registry.ts         # Target discovery, key resolution, scraper instantiation
│   │   │   ├── route-selection.ts  # Route naming and lenient route matching
│   │   │   └── settings.ts         # Environment-driven execution settings
│   │   ├── storage/
│   │   │   ├── sync.ts             # syncDocumentsToStorage(): S3 upload with 3-layer deduplication
│   │   │   └── index.ts            # Barrel re-export
│   │   ├── types/
│   │   │   └── domain.ts           # PolicyEntityData, DocumentData, MunicipalityData, EtlPayload
│   │   └── utils/
│   │       ├── document.ts         # DocumentData factory
│   │       ├── file.ts             # Filename → extension, MIME type, and S3 upload helper
│   │       ├── html.ts             # DOM scoping, dates, Drupal image un-styling
│   │       ├── index.ts            # Barrel re-export
│   │       ├── metadata.ts         # Scrape metadata and page-count helpers
│   │       ├── nepali.ts           # Nepali date and fiscal-year helpers
│   │       ├── pagination.ts       # Listing page URL discovery
│   │       └── url.ts              # URL cleanup, slug extraction
│   ├── scrapers/
│   │   ├── lumbini/                # 6 municipalities
│   │   │   ├── banganga-mun/       #   extract.ts, transform.ts, load.ts, index.ts
│   │   │   ├── bardaghat-mun/
│   │   │   ├── kanchan-mun/
│   │   │   ├── sainamaina-mun/
│   │   │   ├── sarawal-mun/
│   │   │   └── suddhodhan-mun/
│   │   └── madhesh/                # 7 municipalities
│   │       ├── dhankaul-mun/
│   │       ├── durgabhagwati-mun/
│   │       ├── ekdara-mun/
│   │       ├── hariwon-mun/
│   │       ├── kshireshwarnath-mun/
│   │       ├── lakshminiya-mun/
│   │       └── manarashiswa-mun/
│   └── web/
│       ├── backend/                # Express API (port 5001, run via tsx)
│       │   ├── index.js            # Data, policy, run and document endpoints
│       │   ├── selects.js          # Shared Prisma select shapes
│       │   ├── package.json
│       │   └── workspace/          # Route configuration + run execution
│       │       ├── router.js       # /api/workspace routes
│       │       ├── job-store.js    # In-memory run registry and log buffer
│       │       └── console-capture.js # Scoped console tee for the live log
│       └── frontend/               # React + Vite dashboard (port 5173)
│           ├── src/
│           │   ├── components/     # AppShell, tables, primitives, workspace components
│           │   ├── lib/            # api client, formatters, router, workspace helpers
│           │   ├── pages/          # One module per route of the dashboard
│           │   ├── App.jsx         # Route parsing and data loading
│           │   └── App.css         # Design tokens and layout
│           ├── vite.config.js
│           └── package.json
├── api/[...path].js                # Vercel function that fronts the bundled API
├── runner.ts                       # CLI scraper orchestrator
├── mise.toml                       # Pins Node and Python for the repository
├── Dockerfile                      # Scraper + web workspace image (needs Chromium)
├── Dockerfile.ocr                  # Python OCR service image
├── docker-compose.yml              # Postgres, Redis, OCR service, optional scraper
├── storage/                        # Crawlee request queues (gitignored, runtime state)
├── tsconfig.json
└── package.json                    # Workspaces, scripts, dependencies
```

---

## Core Framework (`src/core/`)

### Scraper engine (`src/core/scraper/`)

- **`crawler.ts`** — `crawlRoutes(routes, config)`, the Crawlee `CheerioCrawler` implementation. It narrows `routes` through `selectRoutes()` (honouring `config.routeNames`), resolves the pagination mode, then for each route crawls the listing page, optionally discovers further pages, enqueues detail links, and emits scoped HTML as `ScrapedPage` objects. One `RequestQueue` per route prevents cross-route bleeding.
- **`pipeline.ts`** — `runScraperPipeline(pipeline, config)`, the only place the ETL sequence is implemented. It logs the route selection and pagination mode, runs `extract`, then transforms and loads one page at a time so a single malformed page cannot discard the rest, and always writes a `ScraperRun` row in a `finally` block. Returns a `ScraperRunSummary` and throws `ScraperRunError` (carrying that summary) on failure. Both the CLI and the web API reach a scraper through here.
- **`registry.ts`** — the discovery layer. `getProjectRoot()` locates the repository by walking up until it finds `src/scrapers`; `getAvailableScrapers()` turns the folder tree into `ScraperTarget`s (a folder qualifies when it contains `extract.ts`); `splitTargetKey()` / `matchTargets()` resolve `all`, `<province>`, `<province>:<municipality>` and `<province>:<municipality>:<route>`; `getRouteDescriptors()` imports an `extract.ts` and maps its `ROUTES` array to serializable descriptors; `getTargetIdentity()` reads `MUNICIPALITY_CODE` from a `transform.ts`; `loadScraper()` imports an `index.ts` and instantiates its scraper class; `runScraperTarget()` runs it.
- **`route-selection.ts`** — single definition of a route's name (the slug of its `live` URL) and the lenient matching used by the crawler, the registry and the API, so `budget-program`, `budget_program` and a pasted listing URL all resolve alike.
- **`settings.ts`** — execution settings that come from the environment rather than from route definitions. `resolvePaginationSetting()` implements the `ScraperConfig.pagination` → `SCRAPER_PAGINATION` → `false` precedence and reports which source was used.

### Contracts (`src/core/contracts/scraper.interface.ts`)

- `RouteConfig` — one route: `type`, `live`, `baseUrl`, and the three CSS selectors plus `detailType`. Pagination is deliberately **not** part of a route.
- `ScraperConfig` — per-run options: `pagination` (override the environment) and `routeNames` (restrict the run to specific routes).
- `ScrapedPage` — scoped HTML plus its URL, route type and category slug.
- `IMunicipalityScraper` — the contract each municipality implements (`extract`, `transform`, `load`, `run`).

### Domain types (`src/core/types/domain.ts`)

`PolicyEntityData`, `DocumentData`, `MunicipalityData`, `MunicipalityProfileData` and the `EtlPayload` batch container.

### Cloud storage (`src/core/storage/`)

`syncDocumentsToStorage(documents, destinationFolder?)` is the single entry point all municipality scrapers use to upload collected documents to AWS S3. It is a fire-and-forget call at the end of each `transform` pass.

Three deduplication layers prevent re-uploading the same file:

1. **In-memory check** — documents that already carry an `https://…` `storagePath` are skipped immediately; no network call is needed.
2. **PostgreSQL batch check** — a single `findMany` query on `documents.originalUrl` recovers `storagePath` values written by earlier scraper runs. Matching documents get their `storagePath` restored without touching S3.
3. **S3 `HeadObject` check** (in `utils/file.ts`) — before streaming a file, `HeadObjectCommand` probes the destination key; if the object already exists, the upload is skipped.

Uploads land under the `samaniti-poc/` S3 prefix by default (configurable per call). The `storagePath` written to `DocumentData` (and later persisted by the loader) is the public HTTPS URL of the uploaded object.

> **Current serving behaviour:** the `/api/documents/:id/download` endpoint redirects to `originalUrl` (the live government-portal URL) for now. The `storagePath` is recorded in the database but not yet used as the redire

### Utilities (`src/core/utils/`)

- `html.ts` — DOM scoping, title/date extraction, and `normalizeOriginalImageUrl`, which turns Drupal derivative paths (`styles/thumbnail/public/…`) back into full-resolution originals and strips `?itok=` tokens. `extractDocumentLinks` also pulls PDFs out of embedded DFlip flipbook scripts. Browser-based CDN link extraction (`extractCdnLinksViaNetwork`) is wrapped in a `try/catch` so a missing Playwright binary does not crash the scraper.
- `file.ts` — filename and MIME-type resolution for a record's attachment metadata, plus `uploadDocumentsToS3` and `streamUrlToS3` which stream remote files directly into S3 using the AWS SDK.
- `nepali.ts` — Bikram Sambat parsing, Gregorian conversion and fiscal-year extraction (e.g. `२०८०/०८१` → `2080/81`).
- `pagination.ts` — `extractPaginationUrls`, reading further listing pages from the DOM's pager.
- `url.ts` — `extractSlugFromUrl` (the origin of every route name) plus URL cleanup helpers.
- `metadata.ts`, `document.ts` — portal metadata parsing and the `DocumentData` factory.

### Database layer (`src/core/db/loader.ts`)

Creates the Prisma client through `@prisma/adapter-pg`, exposes `upsertMunicipality`, `upsertMunicipalityProfile` and `upsertPolicyEntity` (deduplicating documents by `originalUrl`), `loadEtlData` for a batch, and `recordScraperRun` for telemetry.

### OCR queue (`src/core/queue/`)

The producer half of the OCR pipeline. `ocr-producer.ts` claims documents and pushes
them onto a Redis list; `redis.ts` owns the shared ioredis client; `types.ts` holds the
`OcrStatus` vocabulary and the job payload the Python worker expects.

Queueing is **claim-based**, and that is the whole design. `claimPendingDocuments` runs
a single `UPDATE … RETURNING` that moves documents from `pending` to `queued` and
reports only the rows it actually took, with `FOR UPDATE SKIP LOCKED` so two producers
skip each other's rows instead of blocking.

Without the claim, the ETL — which loads one page at a time — re-queued the same
backlog once per page, filling Redis with duplicate work before the worker finished a
single job. Claiming also makes the two producers agree: the Node scraper and the
Python `POST /jobs/enqueue-pending` endpoint are the same operation, and both are
idempotent.

A document is handed back out if it sits in `queued` for over an hour or in
`processing` for over six, because those are exactly what a killed worker leaves
behind.

Two lifecycle rules the producers depend on:

- **`redis.ts` must be closed.** The connection holds the Node event loop open, so a
  process that queues work and never closes it prints its last line and hangs.
  `runScraperPipeline` closes it in its `finally`, which is the single exit point for
  both the CLI (one child process per scraper) and the workspace (background tasks).
- **Documents that are already `queued` or `processing` are never re-selected**, so
  `enqueuePendingDocuments` is safe to call from the load path.

A batch size of `null` drops the `LIMIT` clause entirely and claims the whole eligible
backlog — one atomic statement, so the unbounded form is no less safe than a bounded
one. It is what the OCR workspace's "enqueue all" control sends, which is why
`OCR_ENQUEUE_MAX` only guards the explicit-limit path.

The claim and the push are two steps, so a Redis outage between them would leave
documents marked `queued` that no job exists for. The producer reads the per-command
errors out of `pipeline.exec()` — which resolves with `[error, result]` pairs rather
than rejecting — and puts the claim back exactly as it was, per prior status, so a
batch reclaimed from a half-finished `processing` run is not downgraded to `pending`.
The stale-queued reclaim is the safety net; the rollback is the fix.

---

## OCR Service (`services/ocr/`)

A Python package that converts documents to Markdown with [docling](https://github.com/DS4SD/docling)
and writes the text into `documents.ocr_data`. It is a separate runtime because it
needs Python 3.13 and several gigabytes of native ML dependencies.

| File              | Role                                                                                                             |
| :---------------- | :--------------------------------------------------------------------------------------------------------------- |
| `settings.py`     | Resolves `.env` relative to the file, not the working directory, and fails loudly on a missing required variable |
| `db.py`           | psycopg access, plus `claim_pending_documents()` — the same atomic claim as the Node producer                    |
| `server.py`       | Flask API: `/health`, `/queue`, `/jobs`, `/jobs/enqueue-pending`                                                 |
| `worker.py`       | `BRPOP` consumer; downloads, converts, writes the result                                                         |
| `main.py`         | CLI for converting a single document                                                                             |
| `sweep.py`        | Backlog triage: finds documents whose host no longer answers                                                     |
| `ocr/config.py`   | Languages to read, and whether to use a GPU or the CPU                                                           |
| `ocr/pipeline.py` | Builds the docling converter; renders PDF pages to images                                                        |

### Why pages are rendered before conversion

Nepali government PDFs embed legacy font encodings (Preeti, Kantipur) whose text layer
decodes to garbled ASCII, which then misleads docling's table cell matching. So
`convert_document` rasterises each page to a PNG with `pypdfium2` first and runs
recognition on the pixels. The embedded text layer is bypassed entirely.

### One OCR engine, two jobs

EasyOCR reads the words off each page image; docling does everything around that —
page layout, reading order, and table reconstruction through TableFormer. Neither
duplicates the other, which is why both are in the pipeline. There is no engine
selection at runtime: `docling[easyocr]` is the only dependency, so there is
nothing to choose and nothing that can be misconfigured.

### Backlog reality

Around four in five queued documents point at a municipal host that no longer
responds. `sweep.py` exists for that: it probes with short timeouts, reports by host
and reason, and only writes `skipped` with `--mark`. It guards on `ocr_status =
'pending'`, so it can never overwrite a result or stomp a document a worker is holding.

---

## Municipality Scrapers (`src/scrapers/`)

Scrapers are organised as `src/scrapers/<province>/<municipality-folder>/`, each containing four files:

- **`index.ts`** — exports the scraper class. `run()` delegates to `runScraperPipeline`, and the file only auto-executes when it is the process entrypoint (`process.argv[1] === fileURLToPath(import.meta.url)`), which is what allows the API to import the class and run a single route.
- **`extract.ts`** — the `ROUTES` array for the portal: `BASE_URL` plus one entry per listing/detail page pair. A route's name is the slug of its `live` URL, which is also the `type` written onto every record it produces. A route may be declared more than once.
- **`transform.ts`** — Cheerio logic mapping pages to `EtlPayload`, plus the scraper's `MUNICIPALITY_CODE` and `MUNICIPALITY_METADATA`, which are its identity in the database. The folder name does not have to match the code.
- **`load.ts`** — thin wrapper over `loadEtlData`.

The workspace displays only the extraction configuration. Transformer and crawler internals are never exposed through the API.

---

## Scraper Runner CLI (`runner.ts`)

An interactive orchestrator at the repository root:

- Resolves targets through the shared `registry.ts`, so it can never disagree with the API about which scrapers exist.
- Spawns one child process per scraper with `npx tsx <index.ts>`, running municipalities in parallel with a configurable worker count.
- Reports per-target duration, exit code, and a summary table.
- Covers all, a province, or a single municipality. Single-route runs are started from the web workspace, which executes them inside the API process.

---

## Web Application (`src/web/`)

### Backend (`src/web/backend`)

Express on port `5001`, started with `tsx` so it can import the TypeScript scraper modules directly. It loads the repository's `.env` explicitly and imports the workspace router afterwards, because that router pulls in the Prisma loader, which needs `DATABASE_URL` at import time.

Data endpoints: `/api/municipalities`, `/api/municipalities/:id`, `/api/policies`, `/api/scraper-runs`, `/api/documents/:id/download`, `/api/health`.

The `workspace/` sub-router is mounted at `/api/workspace` and provides:

| File                 | Responsibility                                                                                                                                       |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| `router.js`          | Validates and starts runs, serves route configurations, streams run state. Redirects Crawlee's storage to the repository `storage/` directory.       |
| `job-store.js`       | In-memory registry of runs: creation, log buffering (400 lines), status transitions, pruning to the 25 most recent, and the single-active-run guard. |
| `console-capture.js` | Temporarily replaces `console.log/warn/error` for the duration of a run so the same output reaches both the terminal and the job's log buffer.       |

Scraper routes: `GET /routes`, `POST /runs`, `GET /runs`, `GET /runs/:id`.

OCR routes: `GET /ocr/status` reports the counts per `ocr_status`, the same pending
counts broken down by municipality, and the depth of the Redis job list. `GET
/ocr/documents?limit=&municipalityCode=` lists the documents the next enqueue would
take, in claim order, with their source URLs — a preview that claims nothing, so the
files can be opened and judged before a batch is committed. It answers with `total`
alongside the rows so the UI can say "first 50 of 3,475" instead of implying the scope
is fifty documents long. `POST /ocr/enqueue` takes `{ limit, municipalityCode }` for a
fixed batch or `{ all: true }` to sweep the whole eligible backlog, and answers with a
fresh snapshot plus the exact documents it queued, read from the claim rather than
re-read afterwards. `limit` is clamped to `OCR_ENQUEUE_MAX` rather than trusted, and a
value that is not a number is a `400` instead of a `NaN` reaching the `LIMIT` clause.

Run state is deliberately not persisted: `scraper_runs` already holds the durable telemetry, and the buffer only needs to outlive a single run.

### Frontend (`src/web/frontend`)

React 19 with Vite on port `5173`. The dashboard keeps its own small router in `lib/router.js` and loads all portal data once in `App.jsx`.

Pages: `OverviewPage`, `DirectoryPage`, `MunicipalityPage`, `PolicyDetailPage`, `ActivityPage`, `RunDetailPage`, `MethodologyPage`, `WorkspacePage` and `OcrWorkspacePage`.

Workspace-specific modules:

| Module                                | Responsibility                                                                                                    |
| :------------------------------------ | :---------------------------------------------------------------------------------------------------------------- |
| `pages/WorkspacePage.jsx`             | URL-driven state (`/workspace/<province>/<municipality>/<route>`), run polling, filters                           |
| `pages/OcrWorkspacePage.jsx`          | OCR backlog, batch-size and enqueue-all controls, the preview of what a batch would take, and the enqueue history |
| `lib/workspace.js`                    | Route grouping, record-to-route matching, config snippet and clipboard helpers                                    |
| `components/RouteConfigInspector.jsx` | Renders a route's extraction configuration with copy controls                                                     |
| `components/RunLog.jsx`               | The live console panel, run metrics and status                                                                    |
| `components/CopyButton.jsx`           | Clipboard access with a fallback for browsers without the async clipboard API                                     |

`Primitives.jsx` holds the shared vocabulary both workspaces are built from, including
`ActionButton`, which turns into the spinner for the request it started so only the
control that is actually busy reports progress.

`App.css` holds the design tokens (`:root` custom properties) and every component style, including the workspace layout, which collapses to a single column at narrower widths.

---

## Configuration

| Variable                              | Purpose                                                                     |
| :------------------------------------ | :-------------------------------------------------------------------------- |
| `DATABASE_URL`                        | PostgreSQL connection string. Required at import time by the loader         |
| `SCRAPER_PAGINATION`                  | `true` walks past the first listing page on every route; default `false`    |
| `NODE_ENV`                            | `production` refuses the scraper workspace; unset serves it on a machine    |
| `ENABLE_AUTO_OCR`                     | `true` queues documents as the ETL writes them; default `false`             |
| `REDIS_URL`                           | Where the OCR job queue is. Must match the OCR service's view of it         |
| `OCR_QUEUE_NAME`                      | The Redis list jobs travel on; defaults to `ocr:jobs`                       |
| `OCR_EVENTS_CHANNEL`                  | Pub/sub channel the worker announces `job_started`/`completed`/`failed` on  |
| `POSTGRES_USER` / `_PASSWORD` / `_DB` | Required by `docker-compose.yml`, with no defaults                          |
| `FILE_DOWNLOAD`                       | `true` or `1` enables `syncDocumentsToStorage`; uploading is off by default |
| `AWS_ACCESS_KEY_ID`                   | AWS credentials for S3 uploads. Required when `FILE_DOWNLOAD=true`          |
| `AWS_SECRET_ACCESS_KEY`               | AWS credentials for S3 uploads. Required when `FILE_DOWNLOAD=true`          |
| `AWS_REGION`                          | AWS region for the S3 bucket (e.g. `ap-south-1`)                            |
| `AWS_S3_BUCKET`                       | Name of the S3 bucket documents are uploaded to                             |

Copy `.env.example` to `.env` and adjust. When starting the API, Crawlee's storage directory is pointed at the repository's `storage/` unless `CRAWLEE_STORAGE_DIR` is already set.

---

## Containers

Two images, because the two halves of the stack have nothing else in common.

**`Dockerfile.ocr`** — the OCR service. Python 3.13, CPU by default, running as an
unprivileged user with the model caches on a `/models` volume. Its `HEALTHCHECK`
calls `/health`, which checks Redis and Postgres for real rather than just reporting
that the process is alive.

**`Dockerfile`** — the scraper and web workspace. Includes `procps` (required for crawler
memory snapshots via `ps`), `python3`, and Chromium dependencies. Chromium is installed
during image build (`npx playwright install --with-deps chromium`).

`docker-compose.yml` runs Postgres, Redis, the OCR service, and the web/scraper app.
To enter the container for administrative tasks, manual scraping, or virtual environment setup:

```bash
docker compose exec app bash
```

Inside the container:

- Sync schema: `npm run db:push`
- Reinstall Playwright browser if needed: `npx playwright install --with-deps chromium`
- Setup Python venv for OCR scripts: `cd services/ocr && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt`

The published host ports are all overridable with fallback defaults.
