import { CheerioCrawler, RequestQueue } from "crawlee";
import { RouteConfig, ScrapedPage, ScraperConfig } from "../contracts/scraper.interface.js";
import {
    extractPaginationUrls,
    extractSlugFromUrl,
    scopeHtml,
    extractLinksFromHtml,
} from "../utils/index.js";
import { getRouteName, selectRoutes } from "./route-selection.js";
import { resolvePaginationSetting } from "./settings.js";

/**
 * Generic sequential crawler built on Crawlee's CheerioCrawler.
 *
 * For each route:
 *   1. Fetches Page 1 (the root listing page).
 *   2. If `detailSelector` is set, the listing HTML is first scoped by
 *      `contentSelector` (if defined), then `detailSelector` extracts detail
 *      links from within that scope. The detail pages are then scoped + pushed.
 *   3. When pagination is enabled (SCRAPER_PAGINATION env var or
 *      `ScraperConfig.pagination`), all subsequent page URLs are discovered and
 *      processed through the same scoping/detail logic. When it is disabled the
 *      crawl stops at page 1, which still yields the full content for portals
 *      that are not paginated.
 *   4. If `detailSelector` is NOT set, the listing page itself is the content page
 *      and gets pushed directly to the results (scoped by `contentSelector`).
 */
export async function crawlRoutes(
    routes: RouteConfig[],
    config?: ScraperConfig,
): Promise<ScrapedPage[]> {
    const pages: ScrapedPage[] = [];
    const selectedRoutes = selectRoutes(routes, config?.routeNames);
    const pagination = resolvePaginationSetting(config);

    if (selectedRoutes.length !== routes.length) {
        console.log(
            `[Crawler] Running ${selectedRoutes.length} of ${routes.length} route(s): ${selectedRoutes
                .map((route) => getRouteName(route))
                .join(", ")}`,
        );
    }

    if (selectedRoutes.length === 0) {
        console.warn("[Crawler] No routes matched the requested selection.");
        return pages;
    }

    console.log(`[Crawler] Pagination: ${pagination.label} (${pagination.source}).`);

    for (const route of selectedRoutes) {
        const base = route.baseUrl ?? "https://sainamainamun.gov.np";

        // Per-route queue so pages do not bleed between routes
        const queue = await RequestQueue.open(`queue-${route.type}-${Date.now()}`);

        // Seed the queue with the root listing URL
        await queue.addRequest({
            url: route.live,
            userData: { route, isListingPage: true, pageNum: 1 },
        });

        // Inter-route polite delay to avoid triggering server rate limits
        await new Promise((resolve) => setTimeout(resolve, 600));

        const crawler = new CheerioCrawler({
            requestQueue: queue,
            maxConcurrency: 1,
            maxRequestsPerCrawl: 500,
            navigationTimeoutSecs: 120,
            requestHandlerTimeoutSecs: 120,
            maxRequestRetries: 2,
            preNavigationHooks: [
                async () => {
                    // Polite throttle to stay within server rate limits (e.g. Banganga nginx limit)
                    await new Promise((resolve) => setTimeout(resolve, 600));
                },
            ],

            async requestHandler({ request, response, $, body }) {
                const {
                    route: r,
                    isListingPage,
                    pageNum,
                } = request.userData as {
                    route: RouteConfig;
                    isListingPage: boolean;
                    pageNum: number;
                };

                // Guard against HTTP error pages (404, 429, 500 etc.) being processed as valid records
                if (response?.statusCode && response.statusCode >= 400) {
                    console.warn(
                        `[Crawler] Skipping error page (${response.statusCode}): ${request.url}`,
                    );
                    return;
                }

                const fullHtml = body.toString();

                // ── LISTING PAGE ──────────────────────────────────────────────────────
                if (isListingPage) {
                    // 1. Discover and enqueue paginated pages (only from Page 1)
                    if (pagination.enabled && pageNum === 1) {
                        const currentListingUrl = request.loadedUrl ?? request.url;
                        const paginatedUrls = extractPaginationUrls(
                            fullHtml,
                            base,
                            currentListingUrl,
                        );
                        console.log(
                            `[Crawler] Route "${r.type}" (${r.live}): discovered ${paginatedUrls.length} additional page(s).`,
                        );
                        let nextPageNum = 2;
                        for (const url of paginatedUrls) {
                            await queue.addRequest({
                                url,
                                userData: {
                                    route: r,
                                    isListingPage: true,
                                    pageNum: nextPageNum++,
                                },
                            });
                        }
                    }

                    // 2a. If detailSelector is defined → enqueue detail links, skip listing page.
                    //     Scope the HTML by contentSelector first (if defined) so that
                    //     detailSelector only needs to target elements *within* the container.
                    if (r.detailSelector) {
                        const listingScope = r.contentSelector
                            ? scopeHtml(fullHtml, r.contentSelector)
                            : fullHtml;
                        const detailLinks = extractLinksFromHtml(
                            listingScope,
                            r.detailSelector,
                            base,
                        );
                        console.log(
                            `[Crawler] Route "${r.type}" page ${pageNum}: found ${detailLinks.length} detail link(s).`,
                        );
                        for (const url of detailLinks) {
                            await queue.addRequest({
                                url,
                                userData: { route: r, isListingPage: false, pageNum: 0 },
                            });
                        }
                        return; // listing page done — don't push it to pages[]
                    }

                    // 2b. No detailSelector → listing page IS the content page
                    const scopedHtml = r.contentSelector
                        ? scopeHtml(fullHtml, r.contentSelector)
                        : ($("body").html() ?? fullHtml);

                    console.log(
                        `[Crawler] Route "${r.type}" page ${pageNum}: pushing listing page (${request.loadedUrl ?? request.url}).`,
                    );
                    pages.push({
                        url: request.loadedUrl ?? request.url,
                        html: scopedHtml,
                        routeType: r.type,
                        category: extractSlugFromUrl(r.live),
                    });
                    return;
                }

                // ── DETAIL PAGE ───────────────────────────────────────────────────────
                const detailRouteType = r.detailType ?? r.type;
                const targetSelector = r.detailContentSelector ?? r.contentSelector;
                const scopedHtml = targetSelector
                    ? scopeHtml(fullHtml, targetSelector)
                    : ($("body").html() ?? fullHtml);

                console.log(
                    `[Crawler] Route "${r.type}" detail page: pushing (${request.loadedUrl ?? request.url}).`,
                );
                pages.push({
                    url: request.loadedUrl ?? request.url,
                    html: scopedHtml,
                    routeType: detailRouteType,
                    category: extractSlugFromUrl(r.live),
                });
            },

            failedRequestHandler({ request }) {
                console.warn(
                    `[Crawler] Failed to fetch: ${request.url} (${request.errorMessages?.join(", ")})`,
                );
            },
        });

        await crawler.run();
        await queue.drop();
    }

    return pages;
}
