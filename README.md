# Samaniti Data Collection & ETL Monorepo

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-22.19%2B-5fa04e.svg)](https://nodejs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748.svg)](https://www.prisma.io/)
[![Crawlee](https://img.shields.io/badge/Crawlee-3.x-ee6420.svg)](https://crawlee.dev/)
[![React](https://img.shields.io/badge/React-19.x-61dafb.svg)](https://react.dev/)

A TypeScript web scraping and ETL (Extract, Transform, Load) pipeline that harvests, normalizes and stores public policy, governance, project, report and notice data from local government portals (municipalities and rural municipalities) in Nepal — together with a web application for inspecting that data and verifying individual scraper routes.

---

## Table of Contents

- [Overview & Objectives](#overview--objectives)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Data Model & Schema](#data-model--schema)
- [Supported Municipalities](#supported-municipalities)
- [Project Architecture](#project-architecture)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Deployment](#deployment)
- [npm Scripts](#npm-scripts)
- [Running Scrapers](#running-scrapers)
- [Pagination](#pagination)
- [Web Dashboard](#web-dashboard)
- [Route Verification Workspace](#route-verification-workspace)
- [Workspace Plan & Scope](#workspace-plan--scope)
- [Documentation & Guides](#documentation--guides)
- [License](#license)

---

## Overview & Objectives

Local government websites across Nepal (mostly Drupal) publish budgets, notices, tenders, executive decisions and periodic progress reports, frequently as PDF attachments, image notices and flipbooks.

This repository provides:

1. **Systematic crawling** — sequential, polite traversal of municipal listings, pagination and detail pages.
2. **A unified data model** — disparate portal structures normalized into one `PolicyEntity` model.
3. **Full-resolution media recovery** — Drupal derivative URLs (`/files/styles/thumbnail/…`) resolved back to original assets.
4. **Local persistence & telemetry** — Prisma/PostgreSQL upserts plus a `ScraperRun` audit record per execution.
5. **An inspection and verification web app** — browse collected records, and run or re-run a single route without leaving the browser.

---

## Key Features

- **Automated discovery & crawling** — [Crawlee](https://crawlee.dev/) `CheerioCrawler`, sequential request handling, polite throttling, DOM scoping.
- **Unified policy architecture** — notices, projects, reports, budgets and tenders in one searchable schema with province/municipality relations.
- **Full-resolution image & document resolution** — un-styling, `?itok=` stripping, human-readable filename decoding, embedded DFlip flipbook extraction.
- **Telemetry & batch lineage** — every execution writes a `ScraperRun` with duration, items added/updated and errors.
- **One execution path** — the CLI runner and the web workspace both call each scraper's `run()`, so a route verified in the browser behaves exactly like the same route run from a terminal.
- **Route-level targeting** — run a single route with the key `<province>:<municipality>:<route>`, or a whole municipality, from either the CLI or the web UI.
- **Configuration inspector** — route configurations are read directly out of each `extract.ts` and displayed in the UI; nothing is duplicated into the database.
- **Live run output** — the scraper's own console output is mirrored into the browser while a run is in progress.
- **Environment-driven pagination** — listing pagination is one variable (`SCRAPER_PAGINATION`) instead of a per-route flag, overridable per run.

---

## Technology Stack

| Layer            | Technology                            | Version        |
| :--------------- | :------------------------------------ | :------------- |
| Runtime          | Node.js                               | `>=22.19`      |
| Language         | TypeScript                            | `5.x`          |
| Module execution | tsx                                   | `4.x`          |
| Crawling         | Crawlee (`CheerioCrawler`)            | `3.x`          |
| HTML parsing     | Cheerio                               | `1.0.0-rc.12`  |
| HTTP client      | undici                                | `8.x`          |
| ORM / database   | Prisma ORM + PostgreSQL (`pg` driver) | `7.x`          |
| API              | Express + cors                        | `4.x`          |
| UI               | React + Vite                          | `19.x` / `8.x` |
| Frontend lint    | oxlint                                | `1.x`          |
| Formatting       | Prettier                              | `3.x`          |

Node `>=22.19` is required because `undici@8` declares `engines.node >= 22.19.0`. See [docs/project-structure.md](docs/project-structure.md) for the full breakdown, including every package's declared version and its role.

---

## Data Model & Schema

The data layer is PostgreSQL via [Prisma](https://www.prisma.io/):

- **`Municipality`** — `code` (unique), `nameNe`, `nameEn`, `province`, `district`.
- **`MunicipalityProfile`** — established (B.S.), wards, population, area, contact details.
- **`PolicyEntity`** — the unified collection of public items:
    - `category`: `"notice"`, `"project"`, `"report"`, …
    - `titleNe` / `titleEn`, `contentNe` / `contentEn`
    - `fiscalYear`, `budgetAmount`, `status`, `wardNo`, `publishedDate`
    - `sourceUrl` (unique — the deduplication key)
    - `metadata` (JSON) for portal-specific attributes
- **`Document`** — `fileName`, `fileType`, `originalUrl` (unique), `storagePath`, `downloadStatus` (`pending` / `ok` / `failed` / `skipped`), `downloadError`, `ocrData`.
- **`ScraperRun`** — per-execution telemetry: status, duration, items added/updated, error.

A route's records are identified by `PolicyEntity.type`, which holds the route's slug — the same string used in the structured run key. That is what lets a single key address both a run and its records.

---

## Supported Municipalities

13 scrapers across two provinces, 156 route configurations (155 distinct route names). Scrapers are discovered from disk, so the counts below reflect the `ROUTES` arrays in the code.

### Lumbini Province

| Municipality                      | Folder            | Code         | District    | Routes | Portal                                   |
| :-------------------------------- | :---------------- | :----------- | :---------- | -----: | :--------------------------------------- |
| **Banganga Municipality**         | `banganga-mun`    | `BANGANGA`   | Kapilvastu  |      6 | `https://bangangamun.gov.np`             |
| **Bardaghat Municipality**        | `bardaghat-mun`   | `BARDAGHAT`  | Nawalparasi |     13 | `https://bardaghatmun.gov.np`            |
| **Kanchan Rural Municipality**    | `kanchan-mun`     | `KANCHAN`    | Rupandehi   |     14 | `https://kanchanmun.gov.np`              |
| **Sainamaina Municipality**       | `sainamaina-mun`  | `SAINAMAINA` | Rupandehi   |     17 | `https://sainamainamun.gov.np`           |
| **Sarawal Rural Municipality**    | `sarawal-mun`     | `SARAWAL`    | Nawalparasi |     18 | `https://sarawalmun.gov.np`              |
| **Suddhodhan Rural Municipality** | `shuddhodhan-mun` | `SUDDHODHAN` | Rupandehi   |     13 | `https://shuddhodhanmunrupandehi.gov.np` |

### Madhesh Province

| Municipality                         | Folder                | Code               | District  | Routes | Portal                              |
| :----------------------------------- | :-------------------- | :----------------- | :-------- | -----: | :---------------------------------- |
| **Durgabhagwati Rural Municipality** | `durgabhagwati-mun`   | `DURGABHAGWATI`    | Rautahat  |     11 | `https://durgabhagawatimun.gov.np`  |
| **Dhankaul Rural Municipality**      | `dhankaul-mun`        | `DHANKAUL`         | Sarlahi   |     11 | `https://dhankaulmun.gov.np`        |
| **Ekdara Rural Municipality**        | `ekdara-mun`          | `EKDARA`           | Mahottari |     11 | `https://ekdaramun.gov.np`          |
| **Hariwon Municipality**             | `harion-mun`          | `HARIWON`          | Sarlahi   |      9 | `https://harionmun.gov.np`          |
| **Kshireshwarnath Municipality**     | `kshireshwarnath-mun` | `KSHIRESHWARANATH` | Dhanusha  |     11 | `https://kshireshwornathmun.gov.np` |
| **Lakshminiya Rural Municipality**   | `laxminiya-mun`       | `LAKSHMINIYA`      | Dhanusha  |      9 | `https://laxminiyamun.gov.np`       |
| **Manara Shiswa Municipality**       | `manarashiswa-mun`    | `MANARASHISWA`     | Mahottari |     13 | `https://manarashiswamun.gov.np`    |

Notes for anyone adding a scraper:

- The folder name does **not** have to match the database code — `harion-mun` holds `HARIWON`, `laxminiya-mun` holds `LAKSHMINIYA`, `shuddhodhan-mun` holds `SUDDHODHAN`. The workspace resolves scraper → database row through `MUNICIPALITY_CODE` in `transform.ts`, never through the folder name.
- A route may legitimately be declared more than once in one `extract.ts` — Dhankaul's `publications` currently is, with a second configuration for the same listing. The workspace groups every configuration under one route name and runs all of them together.

---

## Project Architecture

```tree
samaniti-data-col/
├── docs/
│   ├── project-structure.md   # Layout, module responsibilities, technology versions
│   └── etl-pipeline-guide.md  # Step-by-step ETL lifecycle
├── prisma/
│   ├── schema.prisma          # Municipality, Profile, PolicyEntity, Document, ScraperRun
│   └── migrations/            # SQL migration history
├── scripts/
│   └── reset-db.ts            # Destructive local database reset helper
├── src/
│   ├── core/                  # Shared framework
│   │   ├── constants/         # MIME maps, transformer constants
│   │   ├── contracts/         # RouteConfig, ScraperConfig, IMunicipalityScraper
│   │   ├── db/                # Prisma loader + ScraperRun telemetry
│   │   ├── scraper/           # crawler, pipeline, registry, route-selection, settings
│   │   ├── types/             # Domain interfaces
│   │   └── utils/             # HTML, documents, files, Nepali dates, URLs, pagination
│   ├── scrapers/
│   │   ├── lumbini/           # 6 municipality scrapers
│   │   └── madesh/            # 7 municipality scrapers
│   └── web/                   # Inspection + verification application
│       ├── backend/           # Express API (data, downloads)
│       │   └── workspace/     # Route config API, one-click route execution, run log
│       └── frontend/          # React + Vite dashboard
├── runner.ts                  # CLI scraper orchestrator
└── storage/                   # Downloaded attachments + Crawlee run state (gitignored)
```

---

## Prerequisites

- **Node.js `>=22.19.0`** — required by `undici@8`; Vite 8 and Prisma 7 also need `^20.19` or newer.
- **npm `>=10`** — the repository uses npm workspaces.
- **PostgreSQL** — a reachable instance with a database for `DATABASE_URL`.

---

## Installation & Setup

1. **Clone and install**:

    ```bash
    git clone https://github.com/itzzsauravp/samaniti-data-col.git
    cd samaniti-data-col
    npm install
    ```

    `npm install` covers the root and both `src/web/*` workspaces.

2. **Configure the environment**:

    ```bash
    cp .env.example .env
    ```

    ```env
    DATABASE_URL='postgresql://user:password@localhost:5432/samaniti_db?schema=public'
    SCRAPER_PAGINATION=false     # true to walk past the first listing page
    ```

3. **Generate the Prisma client** (always required):

    ```bash
    npm run db:generate
    ```

4. **Provide the data**:

    - **Existing database** (dump supplied to you): restore it, set `DATABASE_URL`, and skip the next step.
    - **Empty database**: create the schema with `npm run db:push`.

    > `npm run db:reset` **drops and recreates** the database. Never run it against a database you intend to keep.

5. **Start the application**:

    ```bash
    npm start
    ```

    The API listens on `http://localhost:5001` and the UI on `http://localhost:5173`.

---

## Deployment

The portal and the API deploy as one read-only Vercel project. `vercel.json` runs
`npm ci`, then `npm run vercel-build` (which bundles the backend to
`dist/backend.mjs` and builds the Vite frontend into `src/web/frontend/dist`, the
`outputDirectory`). `api/[...path].js` hands the Express app to the runtime, and
every `/api/*` path except unknown ones falls through to the SPA shell.

### Environment variables

Two, on the project:

| Variable       | Required | Notes                                                                        |
| :------------- | :------- | :--------------------------------------------------------------------------- |
| `DATABASE_URL` | Yes      | A pooled Postgres URL. Must be reachable from the function, not `localhost`. |
| `NODE_ENV`     | Yes      | Set it to `production`. This is the only switch that disables scraping.      |

Nothing else. `SCRAPER_PAGINATION` is a per-machine setting for the CLI and is
absent by default, which already means first page only.

### Why `NODE_ENV`

Scraping is a write operation against live government portals from the host's IP
address, so the API refuses it in production and serves the collected records
only. `NODE_ENV=production` is what turns that on. It is deliberately not a
build-time switch: it does not change how the portal is built, and there is no
separate production bundle. The portal is identical in every build, the workspace
is in the navigation in every build, and the refusal happens at request time —
so the two halves cannot disagree about whether scraping is available.

The backend also refuses on any host it detects as serverless (`VERCEL=1`, AWS
Lambda), which needs no configuration. That backstop exists because Vercel does
not set `NODE_ENV` for the function runtime: a deployment that set nothing at all
would otherwise read as development and expose a crawler.

With the workspace refused, `GET` and `POST` on `/api/workspace/*` both answer
`403` with the code `scraper_workspace_disabled`, and the workspace page explains
itself instead of looking broken. A scraper request never reaches crawler code
because the router is not mounted at all.

### If every route returns 500

`FUNCTION_INVOCATION_FAILED` on `/api/health` means the function failed before
Express ran, so it is never a database problem. `GET /api/health` is the
diagnostic: it answers `{"status":"ok"}` with no database involved, so if it
fails, read the function's runtime log in the Vercel dashboard rather than
debugging the connection string. A failure to load the bundle now answers
`backend_bundle_unavailable` with the cause in the message, so a packaging
problem no longer looks like a data problem.

### Neon

Both the direct and the pooled endpoints work; the pooled one (`-pooler.<region>`)
is what you want on a serverless host. Append `?pgbouncer=true&connection_limit=1`
to it. The pooler runs in transaction mode, so one server connection is handed to
different clients in turn and a named prepared statement left behind by the
previous client is already there for the next one; `pgbouncer=true` is what tells
Prisma not to use them.

---

## npm Scripts

| Script                       | Purpose                                                |
| :--------------------------- | :----------------------------------------------------- |
| `npm start`                  | Backend + frontend together (`concurrently`)           |
| `npm run build`              | `tsc` type-check/emit + production frontend build      |
| `npm run scraper`            | Interactive CLI scraper runner                         |
| `npm run web:backend:dev`    | API only, with watch mode (runs through `tsx`)         |
| `npm run web:frontend:dev`   | Vite dev server only                                   |
| `npm run web:frontend:build` | Production frontend build into `src/web/frontend/dist` |
| `npm run db:generate`        | Regenerate the Prisma client                           |
| `npm run db:push`            | Apply `schema.prisma` to the database                  |
| `npm run db:reset`           | **Destructive** reset for local development            |
| `npm run lint` / `lint:fix`  | ESLint over the TypeScript sources                     |
| `npm run format`             | Prettier write                                         |
| `npm run format:check`       | Prettier verification                                  |

The frontend has its own `oxlint` run (`npm run lint --workspace=src/web/frontend`).

---

## Running Scrapers

The CLI runner discovers scrapers from disk and offers an interactive menu:

```bash
npm run scraper
```

Targets can also be passed directly:

```bash
npx tsx runner.ts                      # all provinces, in parallel
npx tsx runner.ts lumbini              # one province, in parallel
npx tsx runner.ts lumbini:banganga     # one municipality
npx tsx runner.ts all                  # everything
```

Municipality names are matched case-insensitively and with or without the `-mun` suffix.

`runner.ts` delegates discovery to `src/core/scraper/registry.ts`, the same module the web API uses, so the CLI and the UI can never disagree about which scrapers exist.

### Single routes

A single route is addressed by its structured key:

```text
<province>:<municipality>:<route-name>      e.g. lumbini:sainamaina:budget-program
```

The route name is the slug of the route's listing URL (`/ne/budget-program` → `budget-program`) and is matched leniently: `budget-program`, `budget_program` and the full listing URL all resolve to the same route. Running a route executes **every** configuration declared for that name.

Route-level runs are started from the [workspace](#route-verification-workspace) in the web UI; the CLI covers whole provinces and municipalities.

---

## Pagination

Pagination is not a per-route setting. It is resolved for each run, in order:

1. `ScraperConfig.pagination` — an explicit per-run override (the workspace sets this).
2. `SCRAPER_PAGINATION` — the environment variable (`true` / `false`).
3. Default: `false` — only the first listing page is collected.

For portals that do not paginate, the first page is already the complete content, so the default is safe everywhere. Set `SCRAPER_PAGINATION=true` for a full sweep, or override it per run from the workspace without changing `.env`.

---

## Web Dashboard

```bash
npm start                      # both
npm run web:backend:dev        # API only  → http://localhost:5001
npm run web:frontend:dev       # UI only   → http://localhost:5173
```

Public-facing pages:

- **Overview** — collection coverage by province, category mix, document totals.
- **Local governments** — directory, per-municipality profiles, policy tables, collection history.
- **Policy records** — filters by category and fiscal year, document attachments and source links.
- **Collection activity** — `ScraperRun` telemetry and audit trail.
- **Data guide** — schema and methodology reference.

The dashboard is read-only. The workspace below is the only part that can start work.

---

## Route Verification Workspace

`http://localhost:5173/workspace` is a self-contained area for checking one route end to end, entirely from the browser.

**What it does**

| Capability              | Behaviour                                                                                                                                                                                                                                                                                   |
| :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Configuration inspector | Lists every route of a municipality exactly as declared in its `extract.ts` — listing URL, entity type, detail type, and the `contentSelector` / `detailSelector` / `detailContentSelector` values. Each value is individually copyable, and the whole configuration can be copied as JSON. |
| One-click execution     | Starts a run for the selected route — or for every route of the municipality — in the API process, through the same `run()` entry point the CLI uses.                                                                                                                                       |
| Live run output         | The scraper's console output is mirrored into the page while the run progresses, with pages processed, records added/updated, and total duration.                                                                                                                                           |
| Record verification     | Lists the records that belong to the selected route, each linking to the live portal page for comparison.                                                                                                                                                                                   |
| Pagination control      | Choose per run whether to stay on the first listing page or walk all of them, without editing `.env`.                                                                                                                                                                                       |
| Status indicators       | A per-route dot reflects the outcome of the most recent run for that route.                                                                                                                                                                                                                 |

**How a route maps to its records**

A record belongs to a route when either condition holds:

- its `type` equals the route's slug (the normal case), or
- its `sourceUrl` sits under the route's listing URL — needed because some portals label records with the linked document's title instead of the route.

**Data flow**

```text
browser ──POST /api/workspace/runs──▶ registry resolves the key
                                        │  import index.ts → scraper class
                                        ▼
                                   runScraperPipeline
                                        │  console.log mirrored into the in-memory job
                                        ▼
browser ◀──GET /api/workspace/runs/:id── polled every 1.5 s until the run ends
```

Runs execute in-process; a run started from the browser is visible in the server's terminal at the same time. One run uses the pipeline at a time, because the output capture is process-wide.

**API**

| Method | Path                      | Purpose                                                                             |
| :----- | :------------------------ | :---------------------------------------------------------------------------------- |
| `GET`  | `/api/workspace/routes`   | Targets, route configurations, pagination setting, recent runs, any run in progress |
| `POST` | `/api/workspace/runs`     | Start a run for `<province>:<municipality>[:<route>]`                               |
| `GET`  | `/api/workspace/runs`     | Recent runs from this server session                                                |
| `GET`  | `/api/workspace/runs/:id` | One run with its full log                                                           |

Route configurations are re-read from the repository on every request, so the workspace always reflects the current `extract.ts` files without a server restart.

---

## Workspace Plan & Scope

The workspace was built around an explicit set of boundaries.

### Deliberately out of scope

- **No selector management in the database.** CSS/XPath selectors live in `extract.ts` and are read from disk at request time. There is no table, no cache table and no API to edit them.
- **No report tables in the database.** Verification findings are recorded outside the service (team spreadsheet). The only writes are the existing `ScraperRun` telemetry rows.

Both decisions keep the working copy of the scrapers in one place — the repository — and mean a supplied database dump stays valid with no migrations.

### Delivered

| Item                                                           | Status   |
| :------------------------------------------------------------- | :------- |
| Route targeting via `<province>:<municipality>:<route>`        | Complete |
| In-process execution from the UI, sharing the CLI code path    | Complete |
| Configuration inspector sourced from `extract.ts`              | Complete |
| Per-route record listing with live-portal links                | Complete |
| Live run output in the browser                                 | Complete |
| `SCRAPER_PAGINATION` with per-run override                     | Complete |
| `paginated` removed from `RouteConfig` and all 13 `extract.ts` | Complete |
| Single-execution guard with a clear message                    | Complete |
| Re-attachment to a run after a page reload                     | Complete |

### Known limitations

- **Polling, not streaming.** Run output refreshes every 1.5 s rather than instantly. Moving to Server-Sent Events would touch only `workspace/router.js` and one `useEffect` in `WorkspacePage.jsx`.
- **Run history is in memory.** `job-store.js` keeps the 25 most recent runs of the current server process; durable history is the `scraper_runs` table.
- **One run at a time.** Enforced because the console capture used for the live log is process-wide.
- **Only routes are targetable.** Province-wide and all-municipality runs remain CLI-only, so a stray click cannot start a multi-hour sweep.
- **No scheduling.** Runs are manual; there is no queue, retry policy or cron entry point.
- **Attachments are not downloaded.** A run records each attachment's `originalUrl`, `fileName` and `fileType` with `downloadStatus: "skipped"`. Nothing fetches the file, so no PDF is stored and the download endpoint redirects to the portal's own copy.

### Possible next steps

1. Server-Sent Events for live run output.
2. A diff view comparing a route's records against the previous collection, to make regressions obvious.
3. Exporting a route's collected records for external review.

---

## Documentation & Guides

- [Project Structure & Architecture Guide](docs/project-structure.md) — directory layout, module responsibilities, and the technologies and versions in use.
- [Comprehensive ETL Pipeline Guide](docs/etl-pipeline-guide.md) — the extract → transform → load lifecycle, route selection, and pagination behaviour.

---

## License

This project is licensed under the MIT License.
