import * as cheerio from "cheerio";

/**
 * Extracts all paginated listing page URLs directly from the page DOM links.
 * Handles both 0-indexed (?page=1 for 2nd page) and 1-indexed (?page=2 for 2nd page) sites.
 *
 * @param html - HTML content of the listing page
 * @param baseUrl - Base URL of the site (e.g. "https://banganga.gov.np")
 * @param currentUrl - Current URL of the scraped page
 * @returns Array of unique absolute URLs for additional pages
 */
export function extractPaginationUrls(
    html: string,
    baseUrl: string,
    currentUrl?: string,
): string[] {
    const $ = cheerio.load(html);

    // 1. Try legacy/Drupal primary pager first
    let $pager = $(".introduction .container ul.pager, .region-content ul.pager, ul.pager").first();

    // 2. Fall back to custom pagination component if Drupal pager is absent
    if (!$pager.length) {
        $pager = $(".pagination").first();
    }

    if (!$pager.length) return [];

    const contextUrl = currentUrl || baseUrl;
    const urls: string[] = [];
    const seen = new Set<string>();

    // Normalize current context URL to check against
    let currentNormalized = "";
    try {
        currentNormalized = new URL(contextUrl).href.split("#")[0];
    } catch {
        currentNormalized = contextUrl.split("#")[0];
    }

    // Direct extraction: query every single anchor tag inside the pagination element
    $pager.find("a").each((_, el) => {
        const href = $(el).attr("href");
        if (!href || href === "#" || href.startsWith("javascript:")) return;

        const trimmed = href.trim();
        if (!trimmed) return;

        let absolute: string;
        try {
            absolute = new URL(trimmed, contextUrl).href;
        } catch {
            const cleanBase = contextUrl.split("?")[0].replace(/\/$/, "");
            absolute = trimmed.startsWith("?")
                ? `${cleanBase}${trimmed}`
                : `${baseUrl}/${trimmed.replace(/^\//, "")}`;
        }

        const normalized = absolute.split("#")[0];

        // Exclude the current page URL and duplicate URLs
        if (normalized !== currentNormalized && !seen.has(normalized)) {
            seen.add(normalized);
            urls.push(normalized);
        }
    });

    return urls;
}
