import * as cheerio from "cheerio";
import { ScrapedPage } from "../contracts/scraper.interface.js";

export type ScraperMode = "live";
export type FetchStatus = "success" | "failed" | "skipped";

export interface ScrapeMetadata {
    source: {
        website_id: string;
        base_url: string;
        portal_section: string;
        listing_url: string;
        detail_url?: string | null;
    };
    pagination: {
        page_number: number | null;
        total_pages: number | null;
        row_index: number | null;
        has_next_page: boolean;
    };
    extraction: {
        scraped_at: string;
        scraper_name: string;
        scraper_version: string;
        mode: ScraperMode;
        execution_time_ms: number;
        status: FetchStatus;
    };
    verification: {
        content_hash: string;
        raw_html_hash?: string | null;
        raw_html_snippet?: string | null;
    };
    media: {
        documents_count: number;
        has_pdf: boolean;
        attachment_urls: string[];
    };
}

export function extractTotalPagesFromHtml(html: string, baseUrl: string): number | null {
    const $ = cheerio.load(html);
    let maxPage = 0;
    let foundPager = false;

    $("ul.pager li.pager-item a, ul.pager li.pager-last a, ul.pager li a").each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        try {
            const urlObj = new URL(href, baseUrl);
            const pageParam = urlObj.searchParams.get("page");
            if (pageParam !== null) {
                const pageNum = parseInt(pageParam, 10);
                if (!isNaN(pageNum)) {
                    foundPager = true;
                    if (pageNum > maxPage) maxPage = pageNum;
                }
            }
        } catch {}
    });

    return foundPager ? maxPage + 1 : null;
}

export function generateScrapeMetadata(params: {
    page: ScrapedPage;
    baseUrl: string;
    websiteId: string;
    portalSection: string;
    /**
     * Pass true when the page is a detail page (affects listing_url / detail_url).
     * Derived externally since ScrapedPage no longer carries a `type` field.
     */
    isDetail?: boolean;
    rowIndex?: number | null;
    documentsCount?: number;
    hasPdf?: boolean;
    attachmentUrls?: string[];
    rawHtmlSnippet?: string | null;
    executionTimeMs?: number;
    status?: FetchStatus;
}): ScrapeMetadata {
    const {
        page,
        baseUrl,
        websiteId,
        portalSection,
        isDetail = false,
        rowIndex = null,
        documentsCount = 0,
        hasPdf = false,
        attachmentUrls = [],
        rawHtmlSnippet = null,
        executionTimeMs = 0,
        status = "success",
    } = params;

    let pageNumber: number | null = null;
    try {
        const urlObj = new URL(page.url);
        const pageParam = urlObj.searchParams.get("page");
        pageNumber = pageParam !== null ? parseInt(pageParam, 10) + 1 : 1;
    } catch {}

    const totalPages = extractTotalPagesFromHtml(page.html, baseUrl);

    return {
        source: {
            website_id: websiteId,
            base_url: baseUrl,
            portal_section: portalSection,
            listing_url: isDetail ? `${baseUrl}/en/${portalSection}` : page.url,
            detail_url: isDetail ? page.url : null,
        },
        pagination: {
            page_number: pageNumber,
            total_pages: totalPages,
            row_index: rowIndex,
            has_next_page: totalPages !== null && (pageNumber ?? 0) < totalPages,
        },
        extraction: {
            scraped_at: new Date().toISOString(),
            scraper_name: "sainamaina-scraper",
            scraper_version: "1.0.0",
            mode: "live",
            execution_time_ms: executionTimeMs,
            status: status,
        },
        verification: {
            content_hash: "placeholder-hash",
            raw_html_snippet: rawHtmlSnippet,
        },
        media: {
            documents_count: documentsCount,
            has_pdf: hasPdf,
            attachment_urls: attachmentUrls,
        },
    };
}
