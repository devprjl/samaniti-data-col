import { RequestQueue } from "crawlee";
import { RouteConfig, ScrapedPage } from "../../contracts/scraper.interface.js";
import {
    extractPaginationUrls,
    extractSlugFromUrl,
    scopeHtml,
    extractLinksFromHtml,
} from "../../utils/index.js";
import { CrawlerRequestData } from "./types.js";

export interface ListingHandlerParams {
    url: string;
    fullHtml: string;
    bodyHtml: string;
    route: RouteConfig;
    pageNum: number;
    base: string;
    paginationEnabled: boolean;
    queue: RequestQueue;
    pages: ScrapedPage[];
}

/**
 * Handles a listing page during crawling:
 * 1. Discovers and enqueues paginated pages (from page 1 only).
 * 2. If `detailSelector` is set: extracts and enqueues detail links.
 * 3. If `detailSelector` is NOT set: the listing page itself is the content.
 */
export async function handleListingPage({
    url,
    fullHtml,
    bodyHtml,
    route,
    pageNum,
    base,
    paginationEnabled,
    queue,
    pages,
}: ListingHandlerParams): Promise<void> {
    // 1. Discover and enqueue paginated pages (only from Page 1)
    if (paginationEnabled && pageNum === 1) {
        const paginatedUrls = extractPaginationUrls(fullHtml, base, url);
        console.log(
            `[Crawler] Route "${route.type}" (${route.live}): discovered ${paginatedUrls.length} additional page(s).`,
        );
        let nextPageNum = 2;
        for (const pageUrl of paginatedUrls) {
            await queue.addRequest({
                url: pageUrl,
                userData: {
                    route,
                    isListingPage: true,
                    pageNum: nextPageNum++,
                } satisfies CrawlerRequestData,
            });
        }
    }

    // 2a. If detailSelector is defined: enqueue detail links and skip listing page
    if (route.detailSelector) {
        const listingScope = route.contentSelector
            ? scopeHtml(fullHtml, route.contentSelector)
            : fullHtml;
        const detailLinks = extractLinksFromHtml(listingScope, route.detailSelector, base);
        console.log(
            `[Crawler] Route "${route.type}" page ${pageNum}: found ${detailLinks.length} detail link(s).`,
        );
        for (const detailUrl of detailLinks) {
            await queue.addRequest({
                url: detailUrl,
                userData: {
                    route,
                    isListingPage: false,
                    pageNum: 0,
                } satisfies CrawlerRequestData,
            });
        }
        return;
    }

    // 2b. No detailSelector: listing page itself is the content page
    const scopedHtml = route.contentSelector
        ? scopeHtml(fullHtml, route.contentSelector)
        : bodyHtml;

    console.log(`[Crawler] Route "${route.type}" page ${pageNum}: pushing listing page (${url}).`);
    pages.push({
        url,
        html: scopedHtml,
        routeType: route.type,
        category: extractSlugFromUrl(route.live),
    });
}
