import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

export const BASE_URL = "https://durgabhagawatimun.gov.np";

export const ROUTES: RouteConfig[] = [
    {
        type: "project",
        live: `${BASE_URL}/budget-program`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "projectDetail",
    },
    {
        type: "project",
        live: `${BASE_URL}/plan-project`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "projectDetail",
    },
    // Portal page with no data, not scraped: /income-expenditure
    // THE ONLY REPORT DATA THAT THIS MUNICIPALITY HAS IS FOR PUBLICATIONS, not scraped: /annual-progress-report
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
        contentSelector: ".introduction .container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "reportDetail",
    },
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
        live: `${BASE_URL}/rojgar-notices`,
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
    {
        type: "notice",
        live: `${BASE_URL}/tax-and-fees`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .region-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/municipal-council-decision`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .region-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    // Portal page with no data, not scraped: /municipal-board-decision
    // Portal page with no data, not scraped: /municipal-decision
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
