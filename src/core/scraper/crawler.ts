import { CheerioCrawler, RequestQueue } from "crawlee";
import { RouteConfig, ScrapedPage, ScraperConfig } from "../contracts/scraper.interface.js";
import { getRouteName, selectRoutes } from "./route-selection.js";
import { resolvePaginationSetting } from "./settings.js";
import { trackEventManagerListeners } from "./event-manager.js";
import { CrawlerRequestData, handleListingPage, handleDetailPage } from "./handlers/index.js";

/** Default delay between HTTP requests to respect municipal rate limits. */
const REQUEST_THROTTLE_MS = 600;

/**
 * Generic sequential crawler built on Crawlee's CheerioCrawler.
 *
 * For each route:
 *   1. Fetches Page 1 (root listing page).
 *   2. Delegates listing logic (pagination discovery & detail link extraction)
 *      to `handleListingPage`.
 *   3. Delegates detail page logic (DOM scoping & collection) to `handleDetailPage`.
 */
export async function crawlRoutes(
    routes: RouteConfig[],
    config: ScraperConfig = {},
): Promise<ScrapedPage[]> {
    const pages: ScrapedPage[] = [];
    const selectedRoutes = selectRoutes(routes, config.routeNames);
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

    const releaseListeners = trackEventManagerListeners();
    const queue = await RequestQueue.open(`crawl-${Date.now()}`);

    try {
        for (const route of selectedRoutes) {
            const base = route.baseUrl ?? "https://sainamainamun.gov.np";

            // Seed the queue with the root listing URL
            await queue.addRequest({
                url: route.live,
                userData: {
                    route,
                    isListingPage: true,
                    pageNum: 1,
                } satisfies CrawlerRequestData,
            });

            // Inter-route polite delay to avoid triggering server rate limits
            await new Promise((resolve) => setTimeout(resolve, REQUEST_THROTTLE_MS));

            const crawler = new CheerioCrawler({
                requestQueue: queue,
                maxConcurrency: 1,
                maxRequestsPerCrawl: 500,
                navigationTimeoutSecs: 120,
                requestHandlerTimeoutSecs: 120,
                maxRequestRetries: 2,
                preNavigationHooks: [
                    async () => {
                        // Polite throttle to stay within server rate limits
                        await new Promise((resolve) => setTimeout(resolve, REQUEST_THROTTLE_MS));
                    },
                ],

                async requestHandler({ request, response, $, body }) {
                    // Guard against HTTP error pages (404, 429, 500 etc.)
                    if (response?.statusCode && response.statusCode >= 400) {
                        console.warn(
                            `[Crawler] Skipping error page (${response.statusCode}): ${request.url}`,
                        );
                        return;
                    }

                    const {
                        route: r,
                        isListingPage,
                        pageNum,
                    } = request.userData as CrawlerRequestData;
                    const url = request.loadedUrl ?? request.url;
                    const fullHtml = body.toString();
                    const bodyHtml = $("body").html() ?? fullHtml;

                    if (isListingPage) {
                        await handleListingPage({
                            url,
                            fullHtml,
                            bodyHtml,
                            route: r,
                            pageNum,
                            base,
                            paginationEnabled: pagination.enabled,
                            queue,
                            pages,
                        });
                    } else {
                        handleDetailPage({
                            url,
                            fullHtml,
                            bodyHtml,
                            route: r,
                            pages,
                        });
                    }
                },

                failedRequestHandler({ request }) {
                    console.warn(
                        `[Crawler] Failed to fetch: ${request.url} (${request.errorMessages?.join(", ")})`,
                    );
                },
            });

            await crawler.run();
        }
    } finally {
        releaseListeners();
        await queue.drop();
    }

    return pages;
}
