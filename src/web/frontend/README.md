# Samaniti Policy Portal

The frontend is a React + Vite read-only portal for policy records collected from local government websites in Madhesh and Lumbini provinces.

## Run locally

From the repository root:

```bash
npm run web:backend:dev
npm run web:frontend:dev
```

The frontend runs at `http://localhost:5173` and the API runs at `http://localhost:5001`.

The portal loads these backend resources in parallel:

- `GET /api/municipalities`
- `GET /api/policies`
- `GET /api/scraper-runs`

Set `VITE_API_URL` when the API is hosted somewhere other than `http://localhost:5001`.
