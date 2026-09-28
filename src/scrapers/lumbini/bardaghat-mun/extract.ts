import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

export const BASE_URL = "https://bardaghatmun.gov.np";

export const ROUTES: RouteConfig[] = [
    {
        type: "project",
        live: `${BASE_URL}/budget-program`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailSelector: "h2 a",
        detailContentSelector: ".introduction .container",
        detailType: "projectDetail",
    },
    {
        type: "project",
        live: `${BASE_URL}/plan-project`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailSelector: "h2 a",
        detailContentSelector: ".introduction .container",
        detailType: "projectDetail",
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
        type: "report",
        live: `${BASE_URL}/publications`,
        baseUrl: BASE_URL,
        contentSelector: ".container .row .region-content",
        detailType: "report",
    },
    // TABULAR FORMAT
    {
        type: "notice",
        live: `${BASE_URL}/news-notices`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "notice",
    },
    // LISTING FORMAT
    {
        type: "notice",
        live: `${BASE_URL}/public-procurement-tender-notices`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .region-content",
        detailSelector: "h2 a",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    // THIS PAGE DOESNOT EXIST, not scraped: /act-law-directives
    {
        type: "notice",
        live: `${BASE_URL}/tax-and-fees`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container",
        detailSelector: "span a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/municipal-council-decision`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .region-content",
        detailSelector: "h2 a",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/municipal-board-decision`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container",
        detailSelector: "h2 a",
        detailContentSelector: ".introduction .container",
        detailType: "noticeDetail",
    },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    {
        type: "notice",
        live: `${BASE_URL}/municipal-decision`,
        baseUrl: BASE_URL,
        contentSelector: ".container .row .region-content",
        detailType: "notice",
    },
    {
        type: "notice",
        live: `${BASE_URL}/act`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "notice",
    },
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
