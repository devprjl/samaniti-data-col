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

/**
 * One page (or group of pages) to scrape from a municipality portal.
 *
 * Every municipality's `extract.ts` holds a list of these, and the crawler walks
 * through them. A listing page is followed by its detail pages automatically when
 * `detailSelector` is set.
 */
export interface RouteConfig {
    /** What kind of record this is. Decides which transformer runs: "report", "project", "notice". */
    type: string;
    /** The address to fetch. */
    live: string;
    /** Used to turn relative links into full addresses. Defaults to the portal's own origin. */
    baseUrl?: string;
    /** Picks the listing rows out of a listing page, e.g. ".view-content". */
    contentSelector?: string;
    /** Picks the links to each item's own page, e.g. ".views-row h2 a". */
    detailSelector?: string;
    /** Picks the part of a detail page worth keeping, e.g. "#content". */
    detailContentSelector?: string;
    /** Tells the transformer which function to use, e.g. "projectDetail". */
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
