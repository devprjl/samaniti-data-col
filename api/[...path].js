/**
 * Serves the API as a Vercel function.
 *
 * The backend is a plain Express app, and Vercel hands a Node function the same
 * request and response objects, so the app is the handler. Every path under /api
 * arrives here with its original URL, which is what the app's own routes expect.
 *
 * This runs the read-only half of the API. `dist/backend.mjs` is the bundle built
 * by `npm run web:backend:bundle`, and it has already refused to mount the scraper
 * workspace because production is a hard off switch.
 */

/**
 * Reported when the bundle cannot be loaded at all.
 *
 * A module that throws while being imported takes the whole function with it, and
 * Vercel answers that with a bare `FUNCTION_INVOCATION_FAILED` text page. That
 * names neither the file that was missing nor the module that could not be
 * resolved, so the only way to find out is the function's runtime log. Swallowing
 * the error here and answering in the same JSON shape every other route uses
 * turns the same failure into something readable in the browser and in the API
 * consumer, and keeps the original stack on the log for the full account of it.
 */
const importFailure = (error) => (request, response) => {
    console.error("[api] Failed to load dist/backend.mjs", error);

    response.status(500).json({
        error: {
            code: "backend_bundle_unavailable",
            message:
                "The API bundle could not be loaded. This is a build or packaging " +
                `problem, not a data problem. Cause: ${error?.message ?? String(error)}`,
        },
    });
};

let app;

try {
    ({ default: app } = await import("../dist/backend.mjs"));
} catch (error) {
    app = importFailure(error);
}

export default app;
