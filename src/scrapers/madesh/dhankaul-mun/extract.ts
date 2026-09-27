import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

export const BASE_URL = "https://dhankaulmun.gov.np";

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
        paginated: false,
        contentSelector: ".introduction .container .view-content",
        detailType: "project",
    },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "project",
    //     live: `${BASE_URL}/plan-project`,
    //     baseUrl: BASE_URL,
    //     paginated: false,
    //     contentSelector: ".introduction .container .view-content",
    //     detailType: "project",
    // },
    {
        type: "project",
        live: `${BASE_URL}/income-expenditure`,
        baseUrl: BASE_URL,
        paginated: false,
        contentSelector: ".introduction .container .view-content",
        detailType: "project",
    },
    {
        type: "report",
        live: `${BASE_URL}/annual-progress-report`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .row .region-content",
        detailType: "report",
    },
    {
        type: "report",
        live: `${BASE_URL}/trimester-progress-report`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .row .region-content",
        detailType: "report",
    },
    {
        type: "report",
        live: `${BASE_URL}/audit-report`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .row .region-content",
        detailType: "report",
    },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/monitoring-report`,
    //     baseUrl: BASE_URL,
    //     paginated: false,
    //     contentSelector: ".container .row .region-content",
    //     detailType: "report",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/public-hearing`,
    //     baseUrl: BASE_URL,
    //     paginated: false,
    //     contentSelector: ".container .row .region-content",
    //     detailType: "report",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/public-audit`,
    //     baseUrl: BASE_URL,
    //     paginated: false,
    //     contentSelector: ".container .row .region-content",
    //     detailType: "report",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/social-audit`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: ".container .row .region-content",
    //     detailType: "report",
    // },
    {
        type: "report",
        live: `${BASE_URL}/publications`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".container .row .region-content",
        detailType: "report",
    },
    {
        type: "notice",
        live: `${BASE_URL}/news-notices`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".introduction .container .view-content",
        detailSelector: "h2 a",
        detailContentSelector: ".introduction .container",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/public-procurement-tender-notices`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".introduction .container .region-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/act-law-directives`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".introduction .container .region-content",
        detailSelector: "table tbody tr a[href*='/content']",
        detailContentSelector: ".introduction .container .row",
        detailType: "noticeDetail",
    },
    // // THIS PAGE DOESNOT HAVE ANY DATA SO SKIP
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/tax-and-fees`,
    //     baseUrl: BASE_URL,
    //     paginated: false,
    //     contentSelector: ".introduction .container",
    //     detailSelector: "span a[href*='/content']",
    //     detailContentSelector: ".introduction .container .row",
    //     detailType: "noticeDetail",
    // },
    {
        type: "notice",
        live: `${BASE_URL}/municipal-council-decision`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".introduction .container",
        detailType: "notice",
    },
    // // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/municipal-board-decision`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: ".introduction .container",
    //     detailSelector: "h2 a",
    //     detailContentSelector: ".introduction .container",
    //     detailType: "noticeDetail",
    // },
    // // THIS PAGE HAS NO DATA SO SKIP THIS
    {
        type: "unstructuredNotice",
        live: `${BASE_URL}/publications`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".introduction .container",
        detailType: "unstructuredNotice",
    },
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
