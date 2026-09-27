import {
    RouteConfig,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { crawlRoutes } from "../../../core/scraper/crawler.js";

export const BASE_URL = "https://bangangamun.gov.np";

export const ROUTES: RouteConfig[] = [
    {
        type: "report",
        live: `${BASE_URL}/category/annual-report-booklet/`,
        baseUrl: BASE_URL,
        contentSelector: ".category-1 .custom-container",
        detailSelector: "h3.card__title a",
        detailContentSelector: "body",
        detailType: "reportDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/category/press-release/`,
        baseUrl: BASE_URL,
        contentSelector: ".category-1 .custom-container",
        detailSelector: "h3.card__title a",
        detailContentSelector: "body",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/category/news-notice/`,
        baseUrl: BASE_URL,
        contentSelector: ".category-1 .custom-container",
        detailSelector: "h3.card__title a",
        detailContentSelector: "body",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/category/tender-award-notice/`,
        baseUrl: BASE_URL,
        contentSelector: ".category-1 .custom-container",
        detailSelector: "h3.card__title a",
        detailContentSelector: "body",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/category/executive-decisions/`,
        baseUrl: BASE_URL,
        contentSelector: ".category-1 .custom-container",
        detailSelector: "h3.card__title a",
        detailContentSelector: "body",
        detailType: "noticeDetail",
    },
    {
        type: "notice",
        live: `${BASE_URL}/category/municipality-decisions/`,
        baseUrl: BASE_URL,
        contentSelector: ".category-1 .custom-container",
        detailSelector: "h3.card__title a",
        detailContentSelector: "body",
        detailType: "noticeDetail",
    },
];

export async function extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
    return crawlRoutes(ROUTES, config);
}
