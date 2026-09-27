# Project Structure & Architecture Guide

This document provides a detailed overview of the directory hierarchy, core components, and module responsibilities across the Samaniti Data Collection & ETL Monorepo.

---

## Directory Hierarchy

```tree
samaniti-data-col/
├── docs/                      # Architectural and operational guides
│   ├── project-structure.md   # Codebase layout and module organization
│   └── etl-pipeline-guide.md  # Step-by-step ETL lifecycle walkthrough
├── prisma/
│   ├── migrations/            # SQL migration history
│   └── schema.prisma          # PostgreSQL schema (Prisma ORM)
├── src/
│   ├── core/                  # Shared framework, utilities, and database layer
│   │   ├── constants/         # MIME types and route constants
│   │   │   ├── file.ts        # Allowed file extensions and MIME maps
│   │   │   └── transformers.ts# Route classification constants
│   │   ├── contracts/         # Scraper interfaces and route contracts
│   │   │   └── scraper.interface.ts # IMunicipalityScraper, RouteConfig, ScrapedPage
│   │   ├── db/                # Database loader and telemetry management
│   │   │   └── loader.ts      # Prisma upsert queries and run lifecycle loggers
│   │   ├── scraper/           # Web crawling engine
│   │   │   └── crawler.ts     # Generic Crawlee CheerioCrawler implementation
│   │   ├── types/             # Domain TypeScript interfaces
│   │   │   └── domain.ts      # PolicyEntityData, DocumentData, MunicipalityData
│   │   └── utils/             # Helper utilities
│   │       ├── html.ts        # DOM scoping, date extraction, full-res image un-styling
│   │       ├── document.ts    # DocumentData builder
│   │       ├── file.ts        # File download, local storage, and retry logic
│   │       ├── nepali.ts      # Nepali date conversion and fiscal year parsers
│   │       ├── pagination.ts  # Drupal pagination URL resolution
│   │       ├── metadata.ts    # Key-value table and metadata parsers
│   │       └── url.ts         # URL cleaning and normalization helpers
│   ├── scrapers/              # Scraper implementations organized by province
│   │   └── lumbini/           # Lumbini Province scrapers
│   │       ├── banganga-mun/  # Banganga Municipality
│   │       ├── bardaghat-mun/ # Bardaghat Municipality
│   │       ├── kanchan-mun/   # Kanchan Rural Municipality
│   │       ├── sainamaina-mun/# Sainamaina Municipality
│   │       ├── sarawal-mun/   # Sarawal Rural Municipality
│   │       └── shuddhodhan-mun/# Shuddhodhan Rural Municipality
│   └── web/                   # Companion inspection web application
│       ├── backend/           # Express.js REST API for data inspection and downloads
│       │   ├── index.js       # API routes (/api/municipalities, /api/documents, etc.)
│       │   └── package.json   # Backend workspace configuration
│       └── frontend/          # React + Vite dashboard
│           ├── src/           # UI components, tables, filters, and modals
│           ├── vite.config.js # Vite configuration
│           └── package.json   # Frontend workspace configuration
├── runner.ts                  # Dynamic CLI scraper orchestrator
├── storage/                   # Local storage directory for downloaded attachments
├── tsconfig.json              # TypeScript compilation configuration
└── package.json               # Root monorepo configuration and scripts
```

---

## Core Framework Modules (`src/core/`)

### 1. Scraper Engine (`src/core/scraper/`)

- **`crawler.ts`**: Built on Crawlee's `CheerioCrawler`. Sequentially processes defined routes, manages per-route request queues to prevent inter-route page bleeding, respects polite delays (throttling to prevent rate limits on government portals), and handles both tabular listing pages and multi-hop detail pages.

### 2. Contracts (`src/core/contracts/`)

- **`scraper.interface.ts`**:
    - `RouteConfig`: Specifies endpoint URL, pagination flag, content selector, detail selector, and route type.
    - `ScrapedPage`: Carries raw scoped HTML, original URL, route type, and optional category.
    - `IMunicipalityScraper`: Standard interface implemented by municipality scrapers (`extract`, `transform`, `load`, `run`).

### 3. Domain Types (`src/core/types/`)

- **`domain.ts`**: Core TypeScript contracts:
    - `PolicyEntityData`: Attributes for notices, projects, reports, budgets, and tenders.
    - `DocumentData`: Attachment metadata, canonical full-resolution URL, download status, and local storage path.
    - `MunicipalityData` & `MunicipalityProfileData`: Administrative and demographic metadata.
    - `EtlPayload`: Batch container holding municipality metadata and associated policy entities.

### 4. Utilities (`src/core/utils/`)

- **`html.ts`**: Cheerio-based parsing utilities:
    - `normalizeOriginalImageUrl`: Converts Drupal image style derivative paths (e.g. `styles/thumbnail/public/`, `styles/large/public/`) back to authentic full-resolution uploaded assets and strips temporary `?itok=` tokens.
    - `extractDocumentLinks`: Extracts attachments from anchor tags (`a[href]`), images (`img[src]`), and embedded DFlip flipbook scripts (`var pdf = '...'`). Prioritizes parent media anchors, decodes filenames from URL paths, and falls back gracefully to the document body when context is unspecified.
    - `extractTitle`: Multi-selector fallback extractor for Nepali portal titles.
    - `extractDate`: Normalizes published timestamps from `<time>`, DC meta tags, or submitted wrappers.
- **`file.ts`**: Handles downloading attachments via `undici`, verifying MIME types, and organizing files into structured disk directories (`storage/<province>/<municipality>/...`). Respects `SKIP_FILE_DOWNLOADS` configuration.
- **`nepali.ts`**: Parses Bikram Sambat (B.S.) calendar dates, converts B.S. dates to Gregorian, and extracts Nepali fiscal years (e.g., `२०८०/८१` -> `2080/81`).
- **`document.ts`**: Factory for initializing `DocumentData` objects.

### 5. Database Layer & Telemetry (`src/core/db/`)

- **`loader.ts`**:
    - Sets up the Prisma client and PostgreSQL connection.
    - Manages batch upserts of `PolicyEntity` records using `sourceUrl` as the unique constraint.
    - Links associated `Document` records via `connectOrCreate` on `originalUrl`.
    - Manages `ScraperRun` lifecycle: logs execution start, duration, added/updated item counts, and error states.

---

## Municipality Scrapers (`src/scrapers/`)

Scrapers are organized hierarchically by province and municipality code:
`src/scrapers/<province>/<municipality-code>/`

Each municipality scraper contains:

- **`index.ts`**: Executable entrypoint. Instantiates telemetry, calls `extract()`, feeds pages to `transform()`, persists records through `load()`, and logs results.
- **`extract.ts`**: Defines routes (`RouteConfig[]`) tailored to the municipality's portal structure (e.g., `/notices`, `/news`, `/projects`, `/reports`, `/budget`).
- **`transform.ts`**: Cheerio transformation logic mapping scraped pages into `EtlPayload` and `PolicyEntityData` objects.
- **`load.ts`**: Municipality-specific loader invoking core persistence methods.

---

## Scraper Runner CLI (`runner.ts`)

A dynamic, interactive CLI tool located at the repository root:

- Automatically discovers all available municipality scrapers under `src/scrapers/**/index.ts`.
- Offers an interactive terminal menu using `readline` to run:
    - All scrapers sequentially.
    - An entire province (e.g., `lumbini:*`).
    - Individual municipality targets.
- Captures child process execution, duration, exit codes, and provides a clear summary table.

---

## Web Dashboard (`src/web/`)

A monorepo workspace providing an inspection UI:

- **`src/web/backend`**: Express.js server on port `5001`. Provides endpoints to query municipalities, view policies by category, retrieve documents, and stream local files.
- **`src/web/frontend`**: React 18 application built with Vite on port `5173`. Features clean tables, filters, and real-time status monitoring for scraped entities.
