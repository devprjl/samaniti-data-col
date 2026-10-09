import "dotenv/config";
import { fileURLToPath } from "node:url";
import {
    IMunicipalityScraper,
    ScrapedPage,
    ScraperConfig,
} from "../../../core/contracts/scraper.interface.js";
import { EtlPayload } from "../../../core/types/domain.js";
import { runScraperPipeline, ScraperRunSummary } from "../../../core/scraper/pipeline.js";
import { extract, ROUTES } from "./extract.js";
import { transform, MUNICIPALITY_CODE } from "./transform.js";
import { load } from "./load.js";
import { prisma } from "../../../core/db/loader.js";

export class LakshminiyaScraper implements IMunicipalityScraper {
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

    async run(config?: ScraperConfig): Promise<ScraperRunSummary> {
        return runScraperPipeline(
            {
                label: "LakshminiyaScraper",
                municipalityCode: this.municipalityCode,
                routes: this.routes,
                extract: (scraperConfig) => this.extract(scraperConfig),
                transform: (pages) => this.transform(pages),
                load: (data) => this.load(data),
            },
            config,
        );
    }
}

// Run directly: npx tsx src/scrapers/madhesh/lakshminiya-mun/index.ts
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    (async () => {
        const scraper = new LakshminiyaScraper();
        try {
            await scraper.run();
        } catch (err) {
            console.error("[LakshminiyaScraper] Fatal error:", err);
            process.exit(1);
        } finally {
            await prisma.$disconnect();
        }
    })();
}
