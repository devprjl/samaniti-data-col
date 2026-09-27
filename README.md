# Samaniti Data Collection & ETL Monorepo

[![TypeScript](https://img.shields.io/badge/TypeScript-5.3+-blue.svg)](https://www.typescriptlang.org/)
[![Prisma](https://img.shields.io/badge/Prisma-7.x-2D3748.svg)](https://www.prisma.io/)
[![Crawlee](https://img.shields.io/badge/Crawlee-3.8+-orange.svg)](https://crawlee.dev/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)

An enterprise-grade TypeScript web scraping and ETL (Extract, Transform, Load) pipeline designed to systematically harvest, normalize, and store public policy, governance, project, report, and notice data across local government portals (municipalities and rural municipalities) in Nepal.

---

## Table of Contents

- [Overview & Objectives](#overview--objectives)
- [Key Features](#key-features)
- [Data Model & Schema](#data-model--schema)
- [Supported Municipalities](#supported-municipalities)
- [Project Architecture](#project-architecture)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Running Scrapers](#running-scrapers)
- [Web Dashboard](#web-dashboard)
- [Documentation & Guides](#documentation--guides)

---

## Overview & Objectives

Local government websites across Nepal (primarily built on Drupal) publish critical public information: annual budgets, municipal notices, infrastructure tenders, executive decisions, and periodic progress reports. Much of this information is shared via PDF attachments, image notices, and flipbooks.

**Samaniti Data Collection** achieves:

1. **Systematic Crawling**: Reliably traversing municipal listings, pagination, and detail pages.
2. **Unified Data Normalization**: Transforming disparate portal structures into a unified `PolicyEntity` domain model.
3. **High-Resolution Media Extraction**: Un-styling Drupal image thumbnails to extract raw, full-resolution original images and documents as published on the portals.
4. **Resilient Local Persistence & Telemetry**: Tracking lineage (`runId`), execution telemetry, duration, and status in PostgreSQL via Prisma.
5. **Data Inspection Dashboard**: Providing an integrated web dashboard to review scraped policies and attachments.

---

## Key Features

- **Automated Discovery & Crawling**: Built on [Crawlee](https://crawlee.dev/) with polite throttling, sequential request handling, and robust DOM scoping.
- **Unified Policy Architecture**: Consolidates notices, projects, reports, budgets, and tender data into a clean, searchable schema with province/municipality relationships.
- **Full-Resolution Image & Document Resolution**:
    - Automatically converts Drupal derivative URLs (e.g. `/files/styles/thumbnail/public/...`) back to uncompressed original source files.
    - Strips derivative tokens (`?itok=...`) and decodes human-readable file names from URL paths.
    - Extracts embedded DFlip flipbook PDFs and attached documents.
- **Telemetry & Batch Lineage**: Every scraper execution registers a `ScraperRun` record tracking duration, items added, items updated, and error stack traces.
- **Interactive Multi-Target CLI Runner**: Dynamic interactive menu (`npm run scraper`) allowing scraping by single municipality, entire province, or all targets concurrently.
- **Inspection Web Dashboard**: Full-stack application (`src/web/`) with Express REST API and React/Vite UI for real-time data browsing, filtering, and document downloads.

---

## Data Model & Schema

The data layer uses PostgreSQL managed via [Prisma](https://www.prisma.io/):

- **`Municipality`**: Primary administrative unit (`code`, `nameNe`, `nameEn`, `province`, `district`).
- **`MunicipalityProfile`**: Demographic and institutional metadata (established BS, wards, population, area, contact info).
- **`PolicyEntity`**: Unified collection of public municipal items:
    - `category`: `"notice"`, `"project"`, `"report"`, etc.
    - `titleNe` / `titleEn`, `contentNe` / `contentEn`
    - `fiscalYear`, `budgetAmount`, `status`, `wardNo`, `publishedDate`
    - `sourceUrl` (Unique constraint for deduplication)
    - `metadata`: Flexible JSON column for portal-specific attributes.
- **`Document`**: Media attachments and files associated with a `PolicyEntity`:
    - `fileName`, `fileType`, `originalUrl` (unique canonical URL).
    - `storagePath`, `downloadStatus` (`"pending"`, `"ok"`, `"failed"`, `"skipped"`).
    - `ocrData`: Text storage field on the document record.
- **`ScraperRun`**: Audit logs capturing execution metrics, status (`"success"`, `"failed"`), duration, and error logs.

---

## Supported Municipalities

Currently active scrapers in Lumbini Province (`src/scrapers/lumbini/`):

| Municipality                       | Code              | Type               | Portal Base URL                 |
| :--------------------------------- | :---------------- | :----------------- | :------------------------------ |
| **Banganga Municipality**          | `banganga-mun`    | Municipality       | `https://bangangamun.gov.np`    |
| **Bardaghat Municipality**         | `bardaghat-mun`   | Municipality       | `https://bardaghatmun.gov.np`   |
| **Kanchan Rural Municipality**     | `kanchan-mun`     | Rural Municipality | `https://kanchanmun.gov.np`     |
| **Sainamaina Municipality**        | `sainamaina-mun`  | Municipality       | `https://sainamainamun.gov.np`  |
| **Sarawal Rural Municipality**     | `sarawal-mun`     | Rural Municipality | `https://sarawalmun.gov.np`     |
| **Shuddhodhan Rural Municipality** | `shuddhodhan-mun` | Rural Municipality | `https://shuddhodhanmun.gov.np` |

---

## Project Architecture

```tree
samaniti-data-col/
├── docs/                      # Architecture & ETL guides
│   ├── project-structure.md   # Codebase module layout
│   └── etl-pipeline-guide.md  # Step-by-step ETL workflow
├── prisma/
│   ├── schema.prisma          # Database schema (Municipalities, Policies, Documents, Runs)
│   └── migrations/            # Migration history
├── src/
│   ├── core/                  # Core shared framework
│   │   ├── constants/         # MIME types and route constants
│   │   ├── contracts/         # Scraper interfaces and route contracts
│   │   ├── db/                # Database loader & ScraperRun telemetry
│   │   ├── scraper/           # Crawlee CheerioCrawler engine
│   │   ├── types/             # Domain TypeScript interfaces
│   │   └── utils/             # HTML parsing, Nepali date parsing, un-styling, downloads
│   ├── scrapers/              # Province-organized municipality scrapers
│   │   └── lumbini/           # Lumbini Province scrapers
│   └── web/                   # Integrated Inspection UI
│       ├── backend/           # Express REST API (serves data and downloads)
│       └── frontend/          # React + Vite dashboard
├── runner.ts                  # Dynamic interactive CLI scraper runner
└── storage/                   # Local storage for downloaded document attachments
```

---

## Prerequisites

- **Node.js**: `v18.x` or higher
- **PostgreSQL**: Running PostgreSQL database instance
- **npm**: `v9.x` or higher

---

## Installation & Setup

1. **Clone the repository**:

    ```bash
    git clone https://github.com/itzzsauravp/samaniti-data-col.git
    cd samaniti-data-col
    ```

2. **Install all dependencies** (monorepo root and web workspaces):

    ```bash
    npm install
    ```

3. **Configure Environment Variables**:
   Create a `.env` file in the project root:

    ```bash
    cp .env.example .env
    ```

    Ensure your `.env` contains:

    ```env
    DATABASE_URL="postgresql://user:password@localhost:5432/samaniti_db?schema=public"
    SKIP_FILE_DOWNLOADS=true  # Set to false to download attachments locally to storage/
    ```

4. **Initialize the Database**:
    ```bash
    npm run db:push
    npm run db:generate
    ```

---

## Running Scrapers

Launch the dynamic CLI runner:

```bash
npm run scraper
```

The runner provides an interactive menu:

- Run all scrapers sequentially.
- Run scrapers for an entire province (e.g. `lumbini`).
- Select specific municipalities (e.g. `bardaghat-mun`, `banganga-mun`).

### Command Line Flags:

```bash
# Run specific municipality directly
npx tsx runner.ts lumbini:bardaghat-mun

# Run all municipalities in Lumbini province
npx tsx runner.ts lumbini:*

# Run all available scrapers
npx tsx runner.ts all
```

---

## Web Dashboard

The repository includes a companion web application to inspect and verify scraped data:

```bash
# Start both backend and frontend concurrently:
npm start

# Or start individually:
npm run web:backend:dev    # API runs on http://localhost:5001
npm run web:frontend:dev   # Vite UI runs on http://localhost:5173
```

Features:

- Filter policy records by municipality, category (`notice`, `project`, `report`), and fiscal year.
- View document attachments, resolution status, and download links.
- Review scraper run telemetry and audit trails.

---

## Documentation & Guides

For deep dives into the pipeline mechanics and directory organization:

- [Project Structure & Architecture Guide](docs/project-structure.md)
- [Comprehensive ETL Pipeline Guide](docs/etl-pipeline-guide.md)

---

## License

This project is licensed under the MIT License.
