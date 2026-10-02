import { RouteConfig, ScrapedPage, ScraperConfig } from "../contracts/scraper.interface.js";
import { EtlPayload } from "../types/domain.js";
import { recordScraperRun } from "../db/loader.js";
import { resolveDocumentMetadata } from "../utils/pdf-metadata.js";
import { getRouteName, selectRoutes } from "./route-selection.js";
import { PaginationSetting, resolvePaginationSetting } from "./settings.js";

/**
 * Whether a crawl measures its documents before writing them.
 *
 * On by default. The page count it records is what lets the OCR queue convert the
 * shortest documents first instead of whatever happened to be queued, so a
 * document written without one is a document the queue cannot cost.
 *
 * It is not free. Each document is one request to a municipal web server, and those
 * are slow -- 7-20 seconds measured against this collection. A page with forty
 * documents adds roughly a minute of waiting to the crawl, spent on I/O rather than
 * on CPU, so it overlaps poorly with the crawler's own requests.
 *
 * Set OCR_PROBE_DURING_SCRAPE=false to turn it off and leave the counting to
 * `npm run ocr:pages`, which reaches the same documents with a longer timeout and
 * without slowing the crawl. Documents written without a count are not lost either
 * way: the OCR queue probes anything unmeasured before it claims it.
 */
const PROBE_DURING_SCRAPE =
    (process.env.OCR_PROBE_DURING_SCRAPE ?? "true").toLowerCase() !== "false";

/**
 * The single execution path for every municipality scraper.
 *
 * Both the CLI runner (`npm run scraper`) and the scraper workspace in the web UI
 * call this function through `IMunicipalityScraper.run()`, so a route verified
 * in the UI behaves exactly like the same route run from the terminal.
 */

export interface ScraperPipeline {
    /** Display name used in log lines, e.g. "SainamainaScraper". */
    label: string;
    municipalityCode: string;
    routes?: RouteConfig[];
    extract(config?: ScraperConfig): Promise<ScrapedPage[]>;
    transform(pages: ScrapedPage[]): Promise<EtlPayload>;
    load(data: EtlPayload): Promise<{ itemsAdded: number; itemsUpdated: number }>;
}

export interface ScraperRunSummary {
    label: string;
    municipalityCode: string;
    /** Route names selected for this run ("all" when the whole scraper ran). */
    routeNames: string[];
    totalRoutes: number;
    pagesExtracted: number;
    pagesFailed: number;
    itemsAdded: number;
    itemsUpdated: number;
    pagination: PaginationSetting;
    status: "success" | "failed";
    error?: string;
    durationMs: number;
}

/** Error thrown when a run fails; always carries the run summary. */
export class ScraperRunError extends Error {
    readonly summary: ScraperRunSummary;

    constructor(message: string, summary: ScraperRunSummary) {
        super(message);
        this.name = "ScraperRunError";
        this.summary = summary;
    }
}

/**
 * Runs extract → transform → load for a scraper, optionally restricted to a
 * subset of routes, and always records a `ScraperRun` telemetry row.
 *
 * Pages are transformed and loaded one at a time so a single malformed page
 * never discards the records already collected in the same run.
 */
export async function runScraperPipeline(
    pipeline: ScraperPipeline,
    config?: ScraperConfig,
): Promise<ScraperRunSummary> {
    const { label, municipalityCode, extract, transform, load } = pipeline;
    const allRoutes = pipeline.routes ?? [];
    const selectedRoutes = selectRoutes(allRoutes, config?.routeNames);
    const pagination = resolvePaginationSetting(config);
    const startTime = Date.now();

    const summary: ScraperRunSummary = {
        label,
        municipalityCode,
        routeNames: selectedRoutes.map((route) => getRouteName(route)),
        totalRoutes: allRoutes.length,
        pagesExtracted: 0,
        pagesFailed: 0,
        itemsAdded: 0,
        itemsUpdated: 0,
        pagination,
        status: "success",
        durationMs: 0,
    };

    console.log(`[${label}] Starting ETL run for '${municipalityCode}'`);

    if (selectedRoutes.length !== allRoutes.length) {
        console.log(
            `[${label}] Route selection: ${selectedRoutes.length} of ${allRoutes.length} route(s) — ${summary.routeNames.join(", ") || "none"}`,
        );
    }
    console.log(`[${label}] Pagination: ${pagination.label} (${pagination.source}).`);

    try {
        const pages = await extract(config);
        summary.pagesExtracted = pages.length;
        console.log(`[${label}] Extracted ${pages.length} page(s). Processing incrementally...`);

        const pagesPerRoute = new Map<string, number>();

        for (const page of pages) {
            try {
                const partialData = await transform([page]);

                // Documents reach here by several routes, and only one of them probes
                // as it builds the document. This is the single point every document
                // passes through, so it is where the rest are measured.
                if (PROBE_DURING_SCRAPE && partialData.policyEntities?.length) {
                    for (const entity of partialData.policyEntities) {
                        if (entity.documents?.length) {
                            await resolveDocumentMetadata(entity.documents);
                        }
                    }
                }

                const res = await load(partialData);
                if (res) {
                    summary.itemsAdded += res.itemsAdded;
                    summary.itemsUpdated += res.itemsUpdated;
                }
                const routeKey = page.category || page.routeType;
                pagesPerRoute.set(routeKey, (pagesPerRoute.get(routeKey) ?? 0) + 1);
            } catch (err: any) {
                summary.pagesFailed += 1;
                console.error(`[${label}] Error processing page ${page.url}:`, err);
            }
        }

        for (const [routeKey, count] of pagesPerRoute) {
            console.log(`[${label}] Route '${routeKey}': ${count} page(s) processed.`);
        }

        console.log(
            `[${label}] ETL run completed successfully (+${summary.itemsAdded} new, ${summary.itemsUpdated} updated).`,
        );
    } catch (err: any) {
        summary.status = "failed";
        const message = err?.message ?? String(err);
        summary.error = message;
        console.error(`[${label}] ETL run failed:`, err);
        throw new ScraperRunError(message, summary);
    } finally {
        summary.durationMs = Date.now() - startTime;
        await recordScraperRun(municipalityCode, {
            scraperName: municipalityCode,
            durationMs: summary.durationMs,
            status: summary.status,
            itemsAdded: summary.itemsAdded,
            itemsUpdated: summary.itemsUpdated,
            error: summary.error,
        });

        // Loading may have opened the OCR queue connection (ENABLE_AUTO_OCR).
        // This is the one exit point every scraper run passes through -- the CLI
        // spawns each scraper as its own process and the workspace runs them in
        // background tasks -- so releasing it here stops both from hanging on a
        // live socket after the run has finished. Imported lazily so a scraper
        // that never touches the queue does not load the Redis client at all.
        if (process.env.ENABLE_AUTO_OCR === "true") {
            const { closeRedisClient } = await import("../queue/redis.js");
            await closeRedisClient().catch(() => {});
        }
    }

    return summary;
}
