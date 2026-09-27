import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

export const BASE_URL = "https://shuddhodhanmunrupandehi.gov.np";

/**
 * Route definitions for Sainamaina Municipality portal.
 *
 * - type: entity group used to dispatch the correct transformer ("report", "project", "notice")
 * - contentSelector: CSS selector for listing pages (e.g. ".view-content")
 * - detailSelector: CSS selector for item links on listing page (e.g. ".views-field-title a").
 *     When provided, crawler enqueues and visits each detail link.
 * - detailContentSelector: CSS selector to scope the HTML on the detail page (e.g. ".node-article, .node-full").
 * - detailType: custom routeType passed to ScrapedPage for transformer dispatch ("projectDetail").
 */
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
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/monthly-progress-report`,
    //     baseUrl: BASE_URL,
    //     contentSelector: ".introduction .container .view-content",
    //     detailType: "project",
    // },
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
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/monitoring-report`,
    //     baseUrl: BASE_URL,
    //     contentSelector: ".introduction .container .view-content",
    //     detailType: "report",
    // },
    {
        type: "report",
        live: `${BASE_URL}/public-hearing`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "report",
    },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/public-audit`,
    //     baseUrl: BASE_URL,
    //     contentSelector: ".introduction .container .view-content",
    //     detailType: "report",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/social-audit`,
    //     baseUrl: BASE_URL,
    //     contentSelector: ".introduction .container .view-content",
    //     detailType: "report",
    // },
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
        contentSelector: ".introduction .container .view-content",
        detailType: "notice",
    },
    // PAGE NOT FOUND
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/house-building`,
    //     baseUrl: BASE_URL,
    //     contentSelector: ".introduction .container .view-content",
    //     detailType: "notice",
    // },
    {
        type: "notice",
        live: `${BASE_URL}/decisions`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "notice",
    },
    {
        type: "notice",
        live: `${BASE_URL}/tolbikas`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "notice",
    },
    {
        type: "notice",
        live: `${BASE_URL}/act-law-directives`,
        baseUrl: BASE_URL,
        contentSelector: ".introduction .container .view-content",
        detailType: "notice",
    },
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
