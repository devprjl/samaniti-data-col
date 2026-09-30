/**
 * Extracts a clean snake_case slug from a URL path to use for subfolders and categorization.
 * E.g.:
 * - "https://sainamainamun.gov.np/en/annual-progress-report" -> "annual_progress_report"
 * - "https://sainamainamun.gov.np/en/budget-program" -> "budget_program"
 * - "/en/tax-and-fees?page=2" -> "tax_and_fees"
 */
export function extractSlugFromUrl(rawUrl: string, fallback: string = "general"): string {
    try {
        const url = new URL(
            rawUrl.startsWith("http")
                ? rawUrl
                : `https://placeholder.local/${rawUrl.replace(/^\//, "")}`,
        );
        const segments = url.pathname.split("/").filter(Boolean);
        // Filter out common language prefixes like "en", "ne"
        const meaningful = segments.filter(
            (s) => s.toLowerCase() !== "en" && s.toLowerCase() !== "ne",
        );
        const last = meaningful.pop();
        if (!last) return fallback;

        const decoded = decodeURIComponent(last);
        const slug = decoded
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "");

        return slug || fallback;
    } catch {
        return fallback;
    }
}
