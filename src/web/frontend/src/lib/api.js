const API_BASE_URL = (import.meta.env.VITE_API_URL || "http://localhost:5001").replace(/\/$/, "");

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

export { API_BASE_URL };
