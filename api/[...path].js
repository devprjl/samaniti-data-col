import app from "../dist/backend.mjs";

/**
 * Serves the API as a Vercel function.
 *
 * The backend is a plain Express app, and Vercel hands a Node function the same
 * request and response objects, so the app is the handler. Every path under /api
 * arrives here with its original URL, which is what the app's own routes expect.
 *
 * This runs the read-only half of the API. `dist/backend.mjs` is the bundle built
 * by `npm run build:backend`, and it has already refused to mount the scraper
 * workspace because production is a hard off switch.
 */
export default app;
