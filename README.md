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

You do not need a database host of your own for the website — the live site uses a
managed one.

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

---

## Environment variables

| Variable             | Where                | What it does                                                                         |
| :------------------- | :------------------- | :----------------------------------------------------------------------------------- |
| `DATABASE_URL`       | everywhere, required | Where the database is.                                                               |
| `NODE_ENV`           | deployment only      | Set it to `production`. This is what stops the site from being able to run scrapers. |
| `SCRAPER_PAGINATION` | optional             | `true` to follow "next page" links as well. Off by default.                          |

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

---

## License

MIT — see [LICENSE](LICENSE).
