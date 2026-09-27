# Comprehensive ETL Pipeline Guide

This guide provides a detailed walkthrough of how data moves through the Samaniti ETL pipeline—from HTTP requests and DOM extraction to document normalization, high-resolution media recovery, database persistence, and telemetry tracking.

---

## The ETL Lifecycle Architecture

Each municipality scraper executes through five sequential stages:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Telemetry Initialization (Register ScraperRun)            │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Extraction (Crawlee Sequential Crawler)                  │
│    - Listing Pages (Scoping & Pagination Discovery)         │
│    - Detail Pages (Scoping & Enqueuing)                     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Transformation & Data Normalization                      │
│    - Title & Published Date Normalization                   │
│    - Nepali Fiscal Year Parsing (२०८०/८१ -> 2080/81)        │
│    - Policy Category Tagging ('notice', 'project', etc.)    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Document & High-Resolution Media Processing              │
│    - Drupal Thumbnail Un-styling to Full-Resolution Assets  │
│    - Embedded DFlip Flipbook Extraction                     │
│    - URL Path Filename Decoding                             │
│    - Document Metadata Normalization                        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Loading, Persistence & Finalization                      │
│    - Prisma Upsert on unique sourceUrl                      │
│    - Document connectOrCreate on unique originalUrl         │
│    - Telemetry Audit Finalization (duration, counts, status)│
└─────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Pipeline Mechanics

### 1. Telemetry Initialization

Before any web requests are dispatched:

1. The municipality's `index.ts` invokes `startScraperRun(municipalityCode, scraperName)`.
2. A new record is inserted into the `scraper_runs` table with status `"running"` and the initial timestamp `startedAt`.
3. An execution timer begins tracking total duration.

---

### 2. Extraction (`src/core/scraper/crawler.ts`)

The extraction engine is powered by Crawlee's `CheerioCrawler`:

- **Independent Queues**: Each route creates an isolated `RequestQueue` (`queue-${route.type}-${timestamp}`) to prevent page pollution between different categories.
- **Polite Crawling**: To prevent triggering rate limits on municipal web servers (typically Nginx/Apache configurations in Nepal), inter-route delays and per-request timeouts (120s) are enforced.
- **Listing & Detail Traversal**:
    - Listing pages are scoped using `contentSelector` (e.g. `.view-content`).
    - If `detailSelector` is configured (e.g. `.views-row h2 a`), detail links are discovered, validated, and enqueued.
    - If `paginated: true`, pagination links (`?page=1`, `?page=2`, etc.) are detected and crawled sequentially.
- **Output**: Returns an array of `ScrapedPage` objects containing the page URL, scoped HTML fragment, and route type.

---

### 3. Transformation (`src/scrapers/<province>/<municipality>/transform.ts`)

The transformer converts raw HTML fragments into strongly typed domain models:

- **Unified Policy Model**: Rather than dispersing data across disconnected tables, data is mapped to the unified `PolicyEntityData` model:
    - `category`: Normalizes the entity into `"notice"`, `"project"`, `"report"`, etc.
    - `titleNe`: Cleaned Nepali title (stripping extraneous whitespace and newline characters).
    - `publishedDate`: Normalized from `<meta property="dc:date">`, `<time datetime="...">`, or `.meta.submitted`.
    - `fiscalYear`: Parsed using `parseNepaliFiscalYear` from titles or metadata (e.g. converting `२०८०/०८१` to `2080/81`).
    - `budgetAmount`: Parsed numerical value when available.
    - `sourceUrl`: Normalized canonical URL serving as the unique deduplication key.

---

### 4. Document & High-Resolution Media Processing (`src/core/utils/html.ts`)

Extracting attachments from municipal portals presents unique challenges: notices and reports are often published as scanned images, photos of physical notices, or interactive flipbooks.

#### Capturing Full-Resolution Original Media

In Drupal, image fields are rendered as downscaled image styles:

- **Thumbnail URL**: `https://.../files/styles/thumbnail/public/field/image/Notice.png?itok=NZZ6oq5X` (~10–20 KB, heavily downsampled).
- **Original Source**: `https://.../files/field/image/Notice.png` (~500 KB – 5 MB, uncompressed original upload).

Capturing only the thumbnail URL results in heavily compressed, pixelated images that lose readable details.

The pipeline solves this via **`normalizeOriginalImageUrl`**:

1. Detects and strips Drupal style segments: `/\/styles\/[^/]+\/(public|private)\//` -> `/`.
2. Strips derivative tokens (`?itok=...`).
3. If an image is wrapped in an anchor (`<a href="..."><img .../></a>`) pointing to a media file, the anchor's full-resolution target is selected.
4. The decoded filename from the URL path (e.g. `Notice.png`) is preserved.

#### Embedded Flipbook & PDF Detection

For portals using DFlip (interactive PDF flipbooks), the PDF source is frequently embedded within inline JavaScript rather than standard anchor tags. The pipeline extracts these via regex matching:

```regex
/var\s+pdf\s*=\s*['"]([^'"]+\.pdf[^'"]*)['"]/gi
```

All extracted documents are mapped into `DocumentData`:

- `fileName`: Human-readable decoded name.
- `originalUrl`: Canonical, un-styled full-resolution URL.
- `fileType`: File extension (`pdf`, `png`, `jpg`, `docx`).
- `downloadStatus`: `"pending"` or `"skipped"`.

---

### 5. Loading & Persistence (`src/core/db/loader.ts`)

The loader writes transformed payloads to PostgreSQL using Prisma:

1. **Municipality Verification**: Confirms the municipality exists by `code` (e.g., `bardaghat-mun`).
2. **Policy Upsert**:
    - Matches records on the unique `sourceUrl`.
    - Updates existing records with new metadata if modified.
    - Inserts new records with timestamps.
3. **Document Deduplication & Linking**:
    - Attachments are linked using `connectOrCreate` on the unique `originalUrl`.
    - Deduplicates attachments within the payload to prevent transaction conflicts.

---

### 6. Finalization & Telemetry Auditing

Upon completion:

1. Total added items (`itemsAdded`) and updated items (`itemsUpdated`) are tallied.
2. `finishScraperRun` updates the `scraper_runs` record:
    - Sets status to `"success"` (or `"failed"` with error message and stack trace if unhandled exceptions occurred).
    - Records `durationMs` and completion timestamp `endedAt`.
3. Prisma disconnects cleanly, preventing database connection pool leaks.
