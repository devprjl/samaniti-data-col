import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

export const BASE_URL = "https://dhankaulmun.gov.np";

export const ROUTES: RouteConfig[] = [
    {
        type: "project",
        live: `${BASE_URL}/budget-program`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "project",
    },
    // Portal page with no data, not scraped: /plan-project
    {
        type: "project",
        live: `${BASE_URL}/income-expenditure`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "project",
    },
    {
        type: "report",
        live: `${BASE_URL}/annual-progress-report`,
        baseUrl: BASE_URL,
        contentSelector: ".container .row .region-content",
        detailType: "report",
    },
    {
        type: "report",
        live: `${BASE_URL}/trimester-progress-report`,
        baseUrl: BASE_URL,
        contentSelector: ".container .row .region-content",
        detailType: "report",
    },
    {
        type: "report",
        live: `${BASE_URL}/audit-report`,
        baseUrl: BASE_URL,
        contentSelector: ".container .row .region-content",
        detailType: "report",
    },
    // Portal page with no data, not scraped: /monitoring-report
    // Portal page with no data, not scraped: /public-hearing
    // Portal page with no data, not scraped: /public-audit
    // Portal page with no data, not scraped: /social-audit
    {
        type: "notice",
        live: `${BASE_URL}/news-notices`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailSelector: "h2 a",
        detailContentSelector: ".introduction .container",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/public-procurement-tender-notices`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .region-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/act-law-directives`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .region-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    // THIS PAGE DOESNOT HAVE ANY DATA SO SKIP, not scraped: /tax-and-fees
    {
        type: "notice",
        live: `${BASE_URL}/municipal-council-decision`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container",
        detailType: "notice",
    },
    // Portal page with no data, not scraped: /municipal-board-decision
    {
        type: "unstructuredNotice",
        live: `${BASE_URL}/publications`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container",
        detailType: "unstructuredNotice",
    },
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
