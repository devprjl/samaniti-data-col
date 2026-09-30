# Samaniti

Collects public records from local government websites in Nepal — budgets, notices,
tenders, decisions and progress reports — into one database, and shows them on a
public website.

Most of these websites are built on the same software and publish the same kinds of
page, but every municipality arranges them differently. This project reads all of
them, pulls out the same information, and stores it in a single shape so it can be
searched and compared across municipalities.

---

## Prerequisites

|            |                                              |
| :--------- | :------------------------------------------- |
| Node.js    | 22.19 or newer                               |
| npm        | 10 or newer                                  |
| PostgreSQL | 14 or newer, running somewhere you can reach |
| Redis      | 5 or newer, only for the OCR queue           |
| Python     | 3.13, only for the OCR service               |

You do not need a database host of your own for the website — the live site uses a
managed one.

[`mise.toml`](mise.toml) pins the Node and Python versions. Run `mise install` and
you have the right ones.

Only the OCR service needs Python, Redis and the two together. If you are collecting
records and reading them on the website, you can ignore the rest of this page.

---

## Installation and local setup

```bash
git clone https://github.com/itzzsauravp/samaniti-data-col.git
cd samaniti-data-col
npm install
```

Now tell it where your database is, by copying the example file and editing it:

```bash
cp .env.example .env
```

```env
DATABASE_URL='postgresql://user:password@localhost:5432/samanitidb?schema=public'
```

Create the tables:

```bash
npm run db:push
```

Start everything:

```bash
npm start
```

- Website: http://localhost:5173
- API: http://localhost:5001

That runs the API and the website together. You can also run just one of them with
`npm run web:backend:dev` or `npm run web:frontend:dev`.

---

## Deployment

The live site is at **https://samaniti.sauravparajulee.com.np**

It is a single Vercel project that serves both the website and the API from the same
address, and it only reads the database. Scraping is switched off in production, so
nobody can start a crawl from the public site.

To deploy, push to `master`. Vercel builds it. The only two settings the project
needs are `DATABASE_URL` and `NODE_ENV=production`.

### The OCR service is deployed separately

Vercel is the wrong place for OCR. Converting a PDF is measured in minutes per page and
holds the document in memory, and a serverless function is killed on a timer.

So the OCR service runs as a container on an ordinary machine, with the queue in Redis
between it and the scraper:

```bash
cp .env.example .env      # set POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
docker compose up -d      # postgres, redis, and the OCR service
```

That brings up three containers. The OCR service answers on http://localhost:5050, and
`GET /health` reports whether it can actually reach Redis and the database rather than
just whether the process is alive.

The scraper is not part of that stack on purpose. It is a batch job, so it gets its own
image — Chromium and all — which you start when you want to crawl:

```bash
docker compose --profile scraper run --rm app npm run scraper lumbini:banganga
```

A CPU machine is enough. One page takes about a minute on eight cores, so the whole
reachable backlog is a day of compute rather than something that needs a GPU.

---

## Environment variables

| Variable             | Where                | What it does                                                                         |
| :------------------- | :------------------- | :----------------------------------------------------------------------------------- |
| `DATABASE_URL`       | everywhere, required | Where the database is.                                                               |
| `NODE_ENV`           | deployment only      | Set it to `production`. This is what stops the site from being able to run scrapers. |
| `SCRAPER_PAGINATION` | optional             | `true` to follow "next page" links as well. Off by default.                          |
| `ENABLE_AUTO_OCR`    | optional             | `true` to queue every document the scraper writes. Off by default; see OCR below.    |
| `REDIS_URL`          | OCR only             | Where the job queue is. Must match what the OCR service reads.                       |
| `OCR_QUEUE_NAME`     | OCR only             | The Redis list jobs travel on. Defaults to `ocr:jobs`.                               |
| `POSTGRES_USER`      | compose only         | Required by `docker-compose.yml`. Has no default, on purpose.                        |
| `POSTGRES_PASSWORD`  | compose only         | Required by `docker-compose.yml`. Has no default, on purpose.                        |
| `POSTGRES_DB`        | compose only         | Required by `docker-compose.yml`. Has no default, on purpose.                        |

`.env.example` lists all of them with comments. The three `POSTGRES_*` variables have
no fallback value because a compose file that invents a database password will start a
database that nobody, including you, can reach.

On the live site you need two, and nothing else:

```env
DATABASE_URL='postgresql://...'
NODE_ENV='production'
```

For Neon, use the pooled connection address and add `?pgbouncer=true&connection_limit=1`
to the end of the URL.

---

## Running a scraper

From the command line, on your machine:

```bash
npm run scraper                    # every municipality in both provinces
npm run scraper madhesh            # every municipality in one province
npm run scraper lumbini:banganga   # one municipality
```

The scraper prints what it finds as it goes, and a summary at the end. Every run is
also recorded in the database, which is where the site's "Collection activity" page
gets its data.

Records land in your database straight away — run a scraper and refresh the website
to see them.

---

## Reading scanned documents with OCR

Most of these portals publish notices as scans of signed paperwork. The database has
the file; it does not have the words in it. OCR fills that in.

The scraper does not do this itself. It writes a document to the database and puts a
job on a Redis list. A Python service takes the job off, converts the file to Markdown,
and writes the text back into `documents.ocr_data`. Neither side talks to the other
directly, so the scraper never waits on a conversion and the conversion never fails a
scrape.

To try it, first send a backlog of documents to the queue:

```bash
npm run ocr:enqueue -- --limit 100
```

Then run the worker, which converts them one at a time:

```bash
npm run ocr:worker
```

Each document takes minutes, so leave it running. To use a different engine than the
one it picks for itself, `--engine easyocr`, `--engine paddleocr` or `--engine suryaocr`.

### Most of the backlog cannot be read

This is worth knowing before you queue anything. Around four documents in five point
at a municipal website that no longer answers — these are small portals, and some were
decommissioned and never came back. No amount of computing reads a file from a server
that is not there.

There is a tool for finding them:

```bash
npm run ocr:sweep:stats              # what is in the backlog
npm run ocr:sweep -- --limit 500     # report what cannot be fetched
npm run ocr:sweep -- --limit 500 --mark   # and mark those documents skipped
```

It reports first and only writes with `--mark`, and the reason is recorded on each
document. It never touches a document that already has OCR text, and it never overwrites
a document a worker is holding.

---

## Using the website

The website is read-only. It has a few pages:

- **Overview** — totals and recent activity
- **Local governments** — every municipality covered, with counts
- **Collection activity** — every scraper run, with what it added
- **Scraper workspace** — visible, but refuses to run anything on the deployed site
  (see `NODE_ENV` above). It works on your own machine.
- **Data guide** — how the data is collected and what the fields mean

---

## Further reading

- [Project structure and architecture](docs/project-structure.md) — what each folder
  is for and how the pieces fit together
- [ETL pipeline guide](docs/etl-pipeline-guide.md) — how a page on a government
  website becomes a row in the database, step by step
- [OCR service](services/ocr/README.md) — the engines it can use, and how the queue
  works

---

## License

MIT — see [LICENSE](LICENSE).
