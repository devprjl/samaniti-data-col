import "dotenv/config";
import {
    IMunicipalityScraper,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { EtlPayload } from "../../../core/types/domain.js";
import { extract, ROUTES } from "./extract.js";
import { transform, MUNICIPALITY_CODE } from "./transform.js";
import { load } from "./load.js";
import { prisma, recordScraperRun } from "../../../core/db/loader.js";

export class SainamainaScraper implements IMunicipalityScraper {
    public municipalityCode = MUNICIPALITY_CODE;
    public routes = ROUTES;

    async extract(config?: ScraperConfig): Promise<ScrapedPage[]> {
        return extract(config);
    }

    async transform(pages: ScrapedPage[]): Promise<EtlPayload> {
        return transform(pages);
    }

    async load(data: EtlPayload): Promise<{ itemsAdded: number; itemsUpdated: number }> {
        return load(data);
    }

    async run(config?: ScraperConfig): Promise<void> {
        console.log(`[SainamainaScraper] Starting ETL run for '${this.municipalityCode}'`);
        const startTime = Date.now();
        let itemsAdded = 0;
        let itemsUpdated = 0;
        let status = "success";
        let errorMsg: string | undefined = undefined;

        try {
            const pages = await this.extract(config);
            console.log(
                `[SainamainaScraper] Extracted ${pages.length} page(s). Processing incrementally...`,
            );

            for (const page of pages) {
                try {
                    const partialData = await this.transform([page]);
                    const res = await this.load(partialData);
                    if (res) {
                        itemsAdded += res.itemsAdded;
                        itemsUpdated += res.itemsUpdated;
                    }
                } catch (err: any) {
                    console.error(`[SainamainaScraper] Error processing page ${page.url}:`, err);
                }
            }
            console.log(`[SainamainaScraper] ETL run completed successfully.`);
        } catch (err: any) {
            status = "failed";
            errorMsg = err?.message ?? String(err);
            console.error(`[SainamainaScraper] ETL run failed:`, err);
            throw err;
        } finally {
            const durationMs = Date.now() - startTime;
            await recordScraperRun(this.municipalityCode, {
                scraperName: this.municipalityCode,
                durationMs,
                status,
                itemsAdded,
                itemsUpdated,
                error: errorMsg,
            });
        }
    }
}

// Run directly: npm run scraper lumbini:sainamaina
(async () => {
    const scraper = new SainamainaScraper();
    try {
        await scraper.run();
    } catch (err) {
        console.error("[SainamainaScraper] Fatal error:", err);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
})();
