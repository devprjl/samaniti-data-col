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
 * Whether the scraper workspace is offered in this build.
 *
 * Running a scrape is a write operation against live government portals, so a
 * deployed build hides it. The backend refuses those routes regardless; this only
 * keeps the navigation honest.
 */
export const SCRAPER_WORKSPACE_ENABLED = import.meta.env.VITE_SCRAPER_WORKSPACE !== "false";

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
        throw new Error(payload?.error || `Request failed with status ${response.status}`);
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

export { API_BASE_URL };
