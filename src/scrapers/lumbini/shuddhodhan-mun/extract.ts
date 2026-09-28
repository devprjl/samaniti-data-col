import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

export const BASE_URL = "https://shuddhodhanmunrupandehi.gov.np";

export const ROUTES: RouteConfig[] = [
    {
        type: "project",
        live: `${BASE_URL}/budget-program`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "project",
    },
    {
        type: "project",
        live: `${BASE_URL}/plan-project`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "project",
    },
    {
        type: "project",
        live: `${BASE_URL}/income-expenditure`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "project",
    },
    // Portal page with no data, not scraped: /monthly-progress-report
    {
        type: "report",
        live: `${BASE_URL}/trimester-progress-report`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "report",
    },
    {
        type: "report",
        live: `${BASE_URL}/annual-progress-report`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "report",
    },
    {
        type: "report",
        live: `${BASE_URL}/audit-report`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container",
        detailType: "reportDetail",
    },
    // Portal page with no data, not scraped: /monitoring-report
    {
        type: "report",
        live: `${BASE_URL}/public-hearing`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "report",
    },
    // Portal page with no data, not scraped: /public-audit
    // Portal page with no data, not scraped: /social-audit
    {
        type: "report",
        live: `${BASE_URL}/publications`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container",
        detailType: "reportDetail",
    },
    // LISTING TYPE
    {
        type: "notice",
        live: `${BASE_URL}/news-notices`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailSelector: "h2 a",
        detailContentSelector: ".introduction .container .region.region-content",
        detailType: "noticeDetail",
    },
    // TABULAR TYPE
    {
        type: "notice",
        live: `${BASE_URL}/tax-and-fees`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container",
        detailType: "noticeDetail",
    },
    // PAGE NOT FOUND, not scraped: /house-building
    {
        type: "notice",
        live: `${BASE_URL}/decisions`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/tolbikas`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/act-law-directives`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container",
        detailType: "notice",
    },
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
