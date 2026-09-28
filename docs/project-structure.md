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
│   └── etl-pipeline-guide.md       # ETL lifecycle walkthrough
├── prisma/
│   ├── schema.prisma               # Municipality, Profile, PolicyEntity, Document, ScraperRun
│   └── migrations/                 # SQL migration history
├── scripts/
│   └── reset-db.ts                 # Destructive local database reset
├── src/
│   ├── core/
│   │   ├── constants/
│   │   │   ├── file.ts             # Allowed extensions and MIME maps
│   │   │   └── transformers.ts     # Route type constants
│   │   ├── contracts/
│   │   │   └── scraper.interface.ts# RouteConfig, ScraperConfig, ScrapedPage, IMunicipalityScraper
│   │   ├── db/
│   │   │   └── loader.ts           # Prisma client, upserts, ScraperRun telemetry
│   │   ├── scraper/
│   │   │   ├── crawler.ts          # Crawlee CheerioCrawler, route selection, pagination
│   │   │   ├── pipeline.ts         # The single extract → transform → load execution path
│   │   │   ├── registry.ts         # Target discovery, key resolution, scraper instantiation
│   │   │   ├── route-selection.ts  # Route naming and lenient route matching
│   │   │   └── settings.ts         # Environment-driven execution settings
│   │   ├── types/
│   │   │   └── domain.ts           # PolicyEntityData, DocumentData, MunicipalityData, EtlPayload
│   │   └── utils/
│   │       ├── document.ts         # DocumentData factory
│   │       ├── file.ts             # Attachment download, storage paths, retries
│   │       ├── html.ts             # DOM scoping, dates, Drupal image un-styling
│   │       ├── index.ts            # Barrel re-export
│   │       ├── metadata.ts         # Key-value and metadata parsers
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
│   │   │   └── shuddhodhan-mun/
│   │   └── madesh/                 # 7 municipalities
│   │       ├── dhankaul-mun/
│   │       ├── durgabhagwati-mun/
│   │       ├── ekdara-mun/
│   │       ├── harion-mun/
│   │       ├── kshireshwarnath-mun/
│   │       ├── laxminiya-mun/
│   │       └── manarashiswa-mun/
│   └── web/
│       ├── backend/                # Express API (port 5001, run via tsx)
│       │   ├── index.js            # Data, policy, run and document endpoints
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
├── runner.ts                       # CLI scraper orchestrator
├── storage/                        # Attachments + Crawlee state (gitignored)
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

### Utilities (`src/core/utils/`)

- `html.ts` — DOM scoping, title/date extraction, and `normalizeOriginalImageUrl`, which turns Drupal derivative paths (`styles/thumbnail/public/…`) back into full-resolution originals and strips `?itok=` tokens. `extractDocumentLinks` also pulls PDFs out of embedded DFlip flipbook scripts.
- `file.ts` — filename and MIME-type resolution for a record's attachment metadata.
- `nepali.ts` — Bikram Sambat parsing, Gregorian conversion and fiscal-year extraction (e.g. `२०८०/०८१` → `2080/81`).
- `pagination.ts` — `extractPaginationUrls`, reading further listing pages from the DOM's pager.
- `url.ts` — `extractSlugFromUrl` (the origin of every route name) plus URL cleanup helpers.
- `metadata.ts`, `document.ts` — portal metadata parsing and the `DocumentData` factory.

### Database layer (`src/core/db/loader.ts`)

Creates the Prisma client through `@prisma/adapter-pg`, exposes `upsertMunicipality`, `upsertMunicipalityProfile` and `upsertPolicyEntity` (deduplicating documents by `originalUrl`), `loadEtlData` for a batch, and `recordScraperRun` for telemetry.

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

Run state is deliberately not persisted: `scraper_runs` already holds the durable telemetry, and the buffer only needs to outlive a single run.

### Frontend (`src/web/frontend`)

React 19 with Vite on port `5173`. The dashboard keeps its own small router in `lib/router.js` and loads all portal data once in `App.jsx`.

Pages: `OverviewPage`, `DirectoryPage`, `MunicipalityPage`, `PolicyDetailPage`, `ActivityPage`, `RunDetailPage`, `MethodologyPage` and `WorkspacePage`.

Workspace-specific modules:

| Module                                | Responsibility                                                                          |
| :------------------------------------ | :-------------------------------------------------------------------------------------- |
| `pages/WorkspacePage.jsx`             | URL-driven state (`/workspace/<province>/<municipality>/<route>`), run polling, filters |
| `lib/workspace.js`                    | Route grouping, record-to-route matching, config snippet and clipboard helpers          |
| `components/RouteConfigInspector.jsx` | Renders a route's extraction configuration with copy controls                           |
| `components/RunLog.jsx`               | The live console panel, run metrics and status                                          |
| `components/CopyButton.jsx`           | Clipboard access with a fallback for browsers without the async clipboard API           |

`App.css` holds the design tokens (`:root` custom properties) and every component style, including the workspace layout, which collapses to a single column at narrower widths.

---

## Configuration

| Variable             | Purpose                                                                  |
| :------------------- | :----------------------------------------------------------------------- |
| `DATABASE_URL`       | PostgreSQL connection string. Required at import time by the loader      |
| `SCRAPER_PAGINATION` | `true` walks past the first listing page on every route; default `false` |
| `NODE_ENV`           | `production` refuses the scraper workspace; unset serves it on a machine |

Copy `.env.example` to `.env` and adjust. When starting the API, Crawlee's storage directory is pointed at the repository's `storage/` unless `CRAWLEE_STORAGE_DIR` is already set.
