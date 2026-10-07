import { RouteConfig, ScrapedPage } from "../../contracts/scraper.interface.js";
import { extractSlugFromUrl, scopeHtml } from "../../utils/index.js";

export interface DetailHandlerParams {
    url: string;
    fullHtml: string;
    bodyHtml: string;
    route: RouteConfig;
    pages: ScrapedPage[];
}

/**
 * Handles an extracted detail page: scopes the HTML using the configured selector
 * and pushes it to the collected pages array.
 */
export function handleDetailPage({
    url,
    fullHtml,
    bodyHtml,
    route,
    pages,
}: DetailHandlerParams): void {
    const detailRouteType = route.detailType ?? route.type;
    const targetSelector = route.detailContentSelector ?? route.contentSelector;
    const scopedHtml = targetSelector ? scopeHtml(fullHtml, targetSelector) : bodyHtml;

    console.log(`[Crawler] Route "${route.type}" detail page: pushing (${url}).`);
    pages.push({
        url,
        html: scopedHtml,
        routeType: detailRouteType,
        category: extractSlugFromUrl(route.live),
    });
}
