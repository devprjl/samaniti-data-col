import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

export const BASE_URL = "https://ekdaramun.gov.np";

export const ROUTES: RouteConfig[] = [
    {
        type: "project",
        live: `${BASE_URL}/budget-program`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "projectDetail",
    },
    {
        type: "project",
        live: `${BASE_URL}/plan-project`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "projectDetail",
    },
    {
        type: "project",
        live: `${BASE_URL}/income-expenditure`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "projectDetail",
    },
    {
        type: "report",
        live: `${BASE_URL}/annual-progress-report`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "reportDetail",
    },
    // Portal page with no data, not scraped: /monthly-progress-report
    // Portal page with no data, not scraped: /trimester-progress-report
    {
        type: "report",
        live: `${BASE_URL}/audit-report`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "reportDetail",
    },
    // Portal page with no data, not scraped: /monitoring-report
    {
        type: "report",
        live: `${BASE_URL}/public-hearing`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "reportDetail",
    },
    // Portal page with no data, not scraped: /public-audit
    // Portal page with no data, not scraped: /social-audit
    // Portal page with no data, not scraped: /publications
    {
        type: "notice",
        live: `${BASE_URL}/news-notices`,
        baseUrl: BASE_URL,
        contentSelector: "#content",
        detailSelector: "h2 a",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/public-procurement-tender-notices`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/act-law-directives`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    // THIS PAGE HAS NOT DATA SO SKIP THIS, not scraped: /tax-and-fees
    {
        type: "notice",
        live: `${BASE_URL}/municipal-council-decision`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/municipal-board-decision`,
        baseUrl: BASE_URL,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    // Portal page with no data, not scraped: /municipal-decision
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
