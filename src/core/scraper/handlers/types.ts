import { RouteConfig } from "../../contracts/scraper.interface.js";

/** Metadata attached to every request entering the crawler queue. */
export interface CrawlerRequestData {
    route: RouteConfig;
    isListingPage: boolean;
    pageNum: number;
}
