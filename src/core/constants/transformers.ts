import { ScrapedPage } from "../contracts/scraper.interface.js";
import { EtlPayload, MunicipalityData } from "../types/domain.js";

/**
 * Executes ETL payload merging across scraped pages using the provided transformer map.
 */
export async function executeTransform(
    pages: ScrapedPage[],
    municipalityMetadata: MunicipalityData,
    transformers: Record<string, (page: ScrapedPage) => Promise<Partial<EtlPayload>>>,
): Promise<EtlPayload> {
    let merged: Partial<EtlPayload> = {};

    for (const page of pages) {
        const key = page.routeType;
        const handler = transformers[key] ?? transformers[key?.toLowerCase()];
        if (!handler) {
            console.warn(
                `[transform] No handler for routeType "${page.routeType}". Skipping ${page.url}`,
            );
            continue;
        }

        const partial = await handler(page);

        merged = {
            ...merged,
            ...partial,
            policyEntities: [...(merged.policyEntities ?? []), ...(partial.policyEntities ?? [])],
        };
    }

    return {
        municipality: municipalityMetadata,
        ...merged,
    };
}
