import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

export const BASE_URL = "https://manarashiswamun.gov.np";

/**
 * Route definitions for Sainamaina Municipality portal.
 *
 * - type: entity group used to dispatch the correct transformer ("report", "project", "notice")
 * - contentSelector: CSS selector for listing pages (e.g. ".view-content")
 * - detailSelector: CSS selector for item links on listing page (e.g. ".views-field-title a").
 *     When provided, crawler enqueues and visits each detail link.
 * - detailContentSelector: CSS selector to scope the HTML on the detail page (e.g. ".node-article, .node-full").
 * - detailType: custom routeType passed to ScrapedPage for transformer dispatch ("projectDetail").
 * - paginated: true enables discovering and crawling all listing pages (Page 1 -> Page N)
 */
export const ROUTES: RouteConfig[] = [
    {
        type: "project",
        live: `${BASE_URL}/budget-program`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".introduction .container",
        detailSelector: "h2 a",
        detailContentSelector: ".content",
        detailType: "projectDetail",
    },
    {
        type: "project",
        live: `${BASE_URL}/plan-project`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".introduction .container",
        detailSelector: "h2 a",
        detailContentSelector: ".content",
        detailType: "projectDetail",
    },
    {
        type: "project",
        live: `${BASE_URL}/income-expenditure`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "projectDetail",
    },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/monthly-progress-report`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: ".container .view-content",
    //     detailSelector: "table tbody tr a[href*='/content']",
    //     detailContentSelector: "#content .section",
    //     detailType: "reportDetail",
    // },
    {
        type: "report",
        live: `${BASE_URL}/trimester-progress-report`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "reportDetail",
    },
    {
        type: "report",
        live: `${BASE_URL}/annual-progress-report`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "reportDetail",
    },
    {
        type: "report",
        live: `${BASE_URL}/audit-report`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "reportDetail",
    },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/monitoring-report`,
    //     baseUrl: BASE_URL,
    //     paginated: false,
    //     contentSelector: ".container .view-content",
    //     detailSelector: "table tbody tr a[href*='/content']",
    //     detailContentSelector: "#content .section",
    //     detailType: "reportDetail",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/public-hearing`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: ".container .view-content",
    //     detailSelector: "table tbody tr a[href*='/content']",
    //     detailContentSelector: "#content .section",
    //     detailType: "reportDetail",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/public-audit`,
    //     baseUrl: BASE_URL,
    //     paginated: false,
    //     contentSelector: ".container .view-content",
    //     detailSelector: "table tbody tr a[href*='/content']",
    //     detailContentSelector: "#content .section",
    //     detailType: "reportDetail",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/social-audit`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: ".container .view-content",
    //     detailSelector: "table tbody tr a[href*='/content']",
    //     detailContentSelector: "#content .section",
    //     detailType: "reportDetail",
    // },
    {
        type: "report",
        live: `${BASE_URL}/publications`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "reportDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/news-notices`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".introduction .container",
        detailSelector: "h2 a",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/public-procurement-tender-notices`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/act-law-directives`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/tax-and-fees`,
        baseUrl: BASE_URL,
        paginated: false,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/municipal-council-decision`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/municipal-board-decision`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .view-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: "#content .section",
        detailType: "noticeDetail",
    },
    // // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/municipal-decision`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: ".introduction .container .region-content",
    //     detailSelector: "table tbody tr a[href*='/content']",
    //     detailContentSelector: ".introduction .container .row",
    //     detailType: "noticeDetail",
    // },
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
