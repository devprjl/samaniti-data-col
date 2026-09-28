import { EtlPayload } from "../types/domain.js";
import type { ScraperRunSummary } from "../scraper/pipeline.js";

export interface ScraperConfig {
    timeoutMs?: number;
    /**
     * Overrides the environment driven pagination mode (SCRAPER_PAGINATION) for a
     * single execution. When omitted, the crawler falls back to the environment.
     */
    pagination?: boolean;
    /**
     * Restricts the execution to the listed routes. Route names are matched
     * leniently (case, `-`/`_` separators and the `-mun` suffix are ignored), so
     * "budget-program" also matches "budget_program".
     */
    routeNames?: string[];
}

export interface RouteConfig {
    type: string;
    live: string;
    baseUrl?: string;
    contentSelector?: string; // For Listing Pages (e.g., ".view-content")
    detailSelector?: string; // To extract detail URLs from Listing (e.g., ".views-row h2 a")
    detailContentSelector?: string; // For Detail Pages (e.g., ".region-content" or "#content")
    detailType?: string;
}

export interface ScrapedPage {
    url: string;
    html: string; // Scoped HTML fragment (or full body if no contentSelector)
    routeType: string; // Carries route.type through extraction for transformer dispatch
    category?: string; // this will basically be mapped as 'type' in the database
}

export interface IMunicipalityScraper {
    municipalityCode: string;
    routes?: RouteConfig[];
    extract(config?: ScraperConfig): Promise<ScrapedPage[]>;
    transform(pages: ScrapedPage[]): Promise<EtlPayload> | EtlPayload;
    load(data: EtlPayload): Promise<{ itemsAdded: number; itemsUpdated: number }> | Promise<void>;
    run(config?: ScraperConfig): Promise<ScraperRunSummary>;
}
