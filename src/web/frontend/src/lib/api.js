/**
 * Base URL of the API.
 *
 * A full-stack deployment serves the portal and the API from one origin, so the
 * current origin is the right default and needs no configuration. Local development
 * points at the backend dev server via src/web/frontend/.env.development.
 */
const API_BASE_URL = (
    import.meta.env.VITE_API_URL || (typeof window === "undefined" ? "" : window.location.origin)
).replace(/\/$/, "");

/**
 * Error code the backend returns when the workspace is refused, which it is in
 * production. Lets the workspace page explain itself instead of reporting a
 * failure, since nothing has actually gone wrong.
 */
export const SCRAPER_WORKSPACE_DISABLED = "scraper_workspace_disabled";

/**
 * Turns an API failure into something readable.
 *
 * The `error` field is not always a string. A host that rejects the request itself
 * answers with a structured body — Vercel returns `{ error: { code, message } }` for
 * a crashed function or an oversized payload — and passing that object straight to
 * `new Error` coerces it to the literal text "[object Object]", which throws away
 * the only clue about what went wrong.
 */
function describeError(payload, response, path) {
    const error = payload?.error;
    const where = ` (${path})`;

    if (typeof error === "string" && error) return `${error}${where}`;

    if (error && typeof error === "object") {
        const parts = [error.code, error.message].filter(Boolean);
        if (parts.length > 0) return `${parts.join(": ")}${where}`;
    }

    // A non-JSON body means something in front of the API answered, such as a
    // proxy or an error page, so say so rather than reporting a bare status.
    if (payload === null) {
        return `The server returned a non-JSON response (status ${response.status})${where}.`;
    }

    return `Request failed with status ${response.status}${where}`;
}

export async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE_URL}${path}`, {
        ...options,
        headers: {
            Accept: "application/json",
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...options.headers,
        },
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
        const failure = new Error(describeError(payload, response, path));
        // Carried alongside the message so callers can branch on why a request
        // failed without matching on the wording of the error.
        failure.status = response.status;
        failure.code = typeof payload?.error === "object" ? (payload.error.code ?? null) : null;
        throw failure;
    }

    return payload;
}

export function getPortalData() {
    return Promise.all([
        apiRequest("/api/municipalities"),
        apiRequest("/api/policies"),
        apiRequest("/api/scraper-runs"),
    ]).then(([municipalities, policies, scraperRuns]) => ({
        municipalities: Array.isArray(municipalities) ? municipalities : [],
        policies: Array.isArray(policies) ? policies : [],
        scraperRuns: Array.isArray(scraperRuns) ? scraperRuns : [],
    }));
}

export function getDocumentDownloadUrl(documentId) {
    return `${API_BASE_URL}/api/documents/${encodeURIComponent(documentId)}/download`;
}

/**
 * One complete record.
 *
 * The list endpoint omits record bodies so a full collection stays under the
 * 4.5 MB a serverless response allows, so the detail page fetches its own.
 */
export function getPolicy(policyId) {
    return apiRequest(`/api/policies/${encodeURIComponent(policyId)}`);
}

/** Route configurations, scraper targets and execution settings for the scraper workspace. */
export function getScraperWorkspace() {
    return apiRequest("/api/workspace/routes");
}

/** Starts a scraper run for a `<province>:<municipality>[:<route>]` key. */
export function startScraperRun(key, pagination) {
    return apiRequest("/api/workspace/runs", {
        method: "POST",
        body: JSON.stringify({ key, pagination }),
    });
}

/** Progress and logs of a run started from the UI. */
export function getScraperRun(runId) {
    return apiRequest(`/api/workspace/runs/${encodeURIComponent(runId)}`);
}

/** OCR backlog by status, per-municipality pending counts and the Redis queue depth. */
export function getOcrWorkspace() {
    return apiRequest("/api/workspace/ocr/status");
}

/**
 * The documents the next enqueue would take, in queue order.
 *
 * A preview, not a reservation: it claims nothing, so another producer can move
 * the list between this call and the enqueue that follows it.
 */
export function getOcrDocuments({ limit = 50, municipalityCode = null } = {}) {
    const query = new URLSearchParams({ limit: String(limit) });
    if (municipalityCode) query.set("municipalityCode", municipalityCode);
    return apiRequest(`/api/workspace/ocr/documents?${query}`);
}

/**
 * Pushes documents onto the Redis OCR job queue.
 *
 * `all` sweeps the entire eligible backlog in one request; otherwise `limit`
 * caps the batch. `municipalityCode` narrows the scope on top of either.
 */
export function enqueueOcrJobs({ all = false, limit = 50, municipalityCode = null } = {}) {
    return apiRequest("/api/workspace/ocr/enqueue", {
        method: "POST",
        body: JSON.stringify({
            all,
            limit,
            municipalityCode: municipalityCode || undefined,
        }),
    });
}

export { API_BASE_URL };
