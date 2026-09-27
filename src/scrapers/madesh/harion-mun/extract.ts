import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

// FIX: Links and PDfs for this municipality are not being stored in the db
export const BASE_URL = "https://harionmun.gov.np";

export const ROUTES: RouteConfig[] = [
    {
        type: "notice",
        live: `${BASE_URL}/category/news-notice/`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: "main#all-blocks .news-grid",
        detailSelector: "a",
        detailContentSelector: "main#all-blocks",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/category/emergency-notices/`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: "main#all-blocks .news-grid",
        detailSelector: "a",
        detailContentSelector: "main#all-blocks",
        detailType: "noticeDetail",
    },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/category/press-release/`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: "main#all-blocks .news-grid",
    //     detailSelector: "a",
    //     detailContentSelector: "main#all-blocks",
    //     detailType: "noticeDetail",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/category/tender-award-notice/`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: "main#all-blocks .news-grid",
    //     detailSelector: "a",
    //     detailContentSelector: "main#all-blocks",
    //     detailType: "noticeDetail",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/category/executive-decisions/`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: "main#all-blocks .news-grid",
    //     detailSelector: "a",
    //     detailContentSelector: "main#all-blocks",
    //     detailType: "noticeDetail",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/category/municipal-assembly-decisions/`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: "main#all-blocks .news-grid",
    //     detailSelector: "a",
    //     detailContentSelector: "main#all-blocks",
    //     detailType: "noticeDetail",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/category/public-hearing-report/`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: "main#all-blocks .news-grid",
    //     detailSelector: "a",
    //     detailContentSelector: "main#all-blocks",
    //     detailType: "noticeDetail",
    // },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "notice",
    //     live: `${BASE_URL}/category/proactive-disclosure/`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: "main#all-blocks .news-grid",
    //     detailSelector: "a",
    //     detailContentSelector: "main#all-blocks",
    //     detailType: "noticeDetail",
    // },
    {
        type: "report",
        live: `${BASE_URL}/category/act/`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: "main#all-blocks .news-grid",
        detailSelector: "a",
        detailContentSelector: "main#all-blocks",
        detailType: "reportDetail",
    },
    {
        type: "report",
        live: `${BASE_URL}/category/regulation/`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: "main#all-blocks .news-grid",
        detailSelector: "a",
        detailContentSelector: "main#all-blocks",
        detailType: "reportDetail",
    },
    {
        type: "report",
        live: `${BASE_URL}/category/procedure/`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: "main#all-blocks .news-grid",
        detailSelector: "a",
        detailContentSelector: "main#all-blocks",
        detailType: "reportDetail",
    },
    {
        type: "report",
        live: `${BASE_URL}/category/directives/`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: "main#all-blocks .news-grid",
        detailSelector: "a",
        detailContentSelector: "main#all-blocks",
        detailType: "reportDetail",
    },
    {
        type: "report",
        live: `${BASE_URL}/category/standards/`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: "main#all-blocks .news-grid",
        detailSelector: "a",
        detailContentSelector: "main#all-blocks",
        detailType: "reportDetail",
    },
    {
        type: "report",
        live: `${BASE_URL}/category/gazette/`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: "main#all-blocks .news-grid",
        detailSelector: "a",
        detailContentSelector: "main#all-blocks",
        detailType: "reportDetail",
    },
    {
        type: "report",
        live: `${BASE_URL}/category/code-of-conduct/`,
        baseUrl: BASE_URL,
        paginated: true,
        contentSelector: ".category-1 .custom-container",
        detailSelector: "h3.card__title a",
        detailContentSelector: "main#all-blocks",
        detailType: "noticeDetail",
    },
    // THIS PAGE HAS NO DATA SO SKIP THIS
    // {
    //     type: "report",
    //     live: `${BASE_URL}/category/annual-report-booklet/`,
    //     baseUrl: BASE_URL,
    //     paginated: true,
    //     contentSelector: "main#all-blocks .news-grid",
    //     detailSelector: "a",
    //     detailContentSelector: "main#all-blocks",
    //     detailType: "noticeDetail",
    // },
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
