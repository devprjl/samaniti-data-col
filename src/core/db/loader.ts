import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
    MunicipalityData,
    MunicipalityProfileData,
    PolicyEntityData,
    DocumentData,
    EtlPayload,
} from "../types/domain.js";

if (!process.env.DATABASE_URL) {
    throw new Error("[loader] DATABASE_URL environment variable is not set.");
}

const adapter = new PrismaPg(process.env.DATABASE_URL);
export const prisma = new PrismaClient({ adapter });

/**
 * Creates or updates the primary Municipality entry.
 */
export async function upsertMunicipality(data: MunicipalityData) {
    return await prisma.municipality.upsert({
        where: { code: data.code },
        update: {
            nameNe: data.nameNe,
            nameEn: data.nameEn,
            province: data.province,
            district: data.district,
        },
        create: {
            code: data.code,
            nameNe: data.nameNe,
            nameEn: data.nameEn,
            province: data.province,
            district: data.district,
        },
    });
}

/**
 * Creates or updates profile overview data for a municipality.
 */
export async function upsertMunicipalityProfile(data: MunicipalityProfileData): Promise<void> {
    const { municipalityCode, ...profileFields } = data;

    const municipality = await prisma.municipality.findUnique({
        where: { code: municipalityCode },
    });

    if (!municipality) {
        throw new Error(`Municipality with code '${municipalityCode}' not found.`);
    }

    await prisma.municipalityProfile.upsert({
        where: { municipalityId: municipality.id },
        update: { ...profileFields },
        create: {
            ...profileFields,
            municipalityId: municipality.id,
        },
    });
}

/**
 * Maps input document objects into Prisma upsert queries (unique by originalUrl),
 * and deduplicates documents to prevent unique constraint clashes in a single payload.
 */
function buildDocumentUpsertQuery(docs?: DocumentData[]) {
    if (!docs || docs.length === 0) return undefined;

    const uniqueDocsMap = new Map<string, DocumentData>();
    for (const doc of docs) {
        if (doc.originalUrl) {
            uniqueDocsMap.set(doc.originalUrl, doc);
        }
    }

    return {
        connectOrCreate: Array.from(uniqueDocsMap.values()).map((doc) => ({
            where: { originalUrl: doc.originalUrl },
            create: {
                fileName: doc.fileName,
                fileType: doc.fileType,
                originalUrl: doc.originalUrl,
                storagePath: doc.storagePath,
                downloadStatus: doc.downloadStatus ?? "pending",
                downloadError: doc.downloadError ?? null,
                ocrStatus: doc.ocrStatus ?? "pending",
                ocrData: doc.ocrData ?? null,
                // The PDF probe runs at crawl time so the OCR queue can order by
                // page count. Null is a real answer meaning "could not be read", so
                // it is stored rather than dropped: an absent column would be
                // indistinguishable from a row that predates the probe.
                metadata: doc.metadata ?? undefined,
            },
        })),
    };
}

/**
 * Writes a freshly measured page count onto documents that already exist.
 *
 * This is separate from the upsert above because `connectOrCreate` cannot do it.
 * Prisma 7 removed the `update` option from `connectOrCreate`, so that clause only
 * ever runs on first insert -- and these documents are re-scraped routinely, so a
 * measurement would be written once and then frozen. A portal that replaced a long
 * PDF with a one-page notice would keep being costed as a long document forever.
 *
 * A nested `upsert` is not an option either: the same helper feeds both the parent's
 * `create` and its `update`, and in the `create` branch the documents do not exist
 * yet, so only `create` and `connectOrCreate` are valid there.
 *
 * Only successful measurements are written. A probe that found the host gone
 * records `reachable: false`, and that must not erase a page count an earlier
 * scrape established -- municipal portals go down, and a document would otherwise
 * lose its count because its server was unreachable today.
 */
async function refreshDocumentMetadata(docs?: DocumentData[]): Promise<void> {
    if (!docs || docs.length === 0) return;

    const measured = docs.filter((doc) => {
        if (!doc.originalUrl || doc.metadata == null) return false;
        return (doc.metadata as { reachable?: boolean | null }).reachable !== false;
    });
    if (measured.length === 0) return;

    // One update per document rather than a single updateMany: each carries its own
    // metadata, so there is no one value to set them all to. Batched into one
    // transaction so the page is not left half-measured if one write fails.
    await prisma.$transaction(
        measured.map((doc) =>
            prisma.document.update({
                where: { originalUrl: doc.originalUrl! },
                data: { metadata: doc.metadata ?? undefined },
            }),
        ),
    );
}

/**
 * Upserts a PolicyEntity record and links attached documents using `sourceUrl` as unique key.
 */
export async function upsertPolicyEntity(data: PolicyEntityData): Promise<{ added: boolean }> {
    const { municipalityCode, documents, ...entityFields } = data;

    const municipality = await prisma.municipality.findUnique({
        where: { code: municipalityCode },
    });

    if (!municipality) {
        throw new Error(`Municipality with code '${municipalityCode}' not found.`);
    }

    // Check if record already exists to track added vs updated
    const existing = await prisma.policyEntity.findUnique({
        where: { sourceUrl: entityFields.sourceUrl },
    });

    // `sourceUrl` is unique, so an existing row means this URL was already written
    // and the upsert below replaces its contents. The previous values are about to
    // be lost, so report them while they can still be seen. A repeat from the same
    // route is a routine refresh; a different route means two routes list the same
    // page and only the last writer survives.
    if (existing) {
        const sameRoute = existing.type === entityFields.type;
        console.warn(
            `[loader] ${sameRoute ? "Repeat" : "Cross-route collision"} on ${entityFields.sourceUrl}` +
                ` — first written by route '${existing.type || "unknown"}', now overwritten by` +
                ` route '${entityFields.type || "unknown"}'` +
                ` (title: '${existing.titleNe}' -> '${entityFields.titleNe}').`,
        );
    }

    await prisma.policyEntity.upsert({
        where: { sourceUrl: entityFields.sourceUrl },
        update: {
            category: entityFields.category,
            titleNe: entityFields.titleNe,
            titleEn: entityFields.titleEn,
            contentNe: entityFields.contentNe,
            contentEn: entityFields.contentEn,
            type: entityFields.type,
            fiscalYear: entityFields.fiscalYear,
            budgetAmount: entityFields.budgetAmount,
            status: entityFields.status,
            wardNo: entityFields.wardNo,
            publishedDate: entityFields.publishedDate,
            metadata: entityFields.metadata,
            municipalityId: municipality.id,
            documents: buildDocumentUpsertQuery(documents),
        },
        create: {
            ...entityFields,
            municipalityId: municipality.id,
            documents: buildDocumentUpsertQuery(documents),
        },
    });

    // Second pass, because the upsert above cannot write to a document that
    // already exists. This is what makes a re-scrape actually refresh a page count.
    await refreshDocumentMetadata(documents);

    return { added: !existing };
}

export interface ScraperRunMeta {
    scraperName: string;
    durationMs: number;
    status: string;
    itemsAdded: number;
    itemsUpdated: number;
    error?: string | null;
}

/**
 * Records scraper execution run metrics.
 */
export async function recordScraperRun(
    municipalityCode: string,
    meta: ScraperRunMeta,
): Promise<void> {
    const municipality = await prisma.municipality.findUnique({
        where: { code: municipalityCode },
    });

    await prisma.scraperRun.create({
        data: {
            municipalityId: municipality?.id ?? null,
            scraperName: meta.scraperName,
            status: meta.status,
            itemsAdded: meta.itemsAdded,
            itemsUpdated: meta.itemsUpdated,
            durationMs: meta.durationMs,
            error: meta.error ?? null,
            endedAt: new Date(),
        },
    });
}

/**
 * Master loader method to run all domain upserts sequentially for a scraper execution.
 */
export async function loadEtlData(
    payload: EtlPayload,
): Promise<{ itemsAdded: number; itemsUpdated: number }> {
    let itemsAdded = 0;
    let itemsUpdated = 0;

    // 1. Upsert target municipality base record
    await upsertMunicipality(payload.municipality);

    // 2. Upsert profile attributes if present
    if (payload.profile) {
        await upsertMunicipalityProfile(payload.profile);
    }

    // 3. Upsert policy entities list
    if (payload.policyEntities && payload.policyEntities.length > 0) {
        for (const entity of payload.policyEntities) {
            const res = await upsertPolicyEntity(entity);
            if (res.added) {
                itemsAdded++;
            } else {
                itemsUpdated++;
            }
        }
    }

    // 4. Optionally hand this load's documents to the OCR queue.
    //
    // This runs once per ETL load and the pipeline loads one page at a time, so
    // it is called many times per scrape. It therefore queues by the URLs this
    // payload wrote rather than sweeping the municipality backlog, which is what
    // made a single run queue the same documents once per page.
    if (process.env.ENABLE_AUTO_OCR === "true") {
        const writtenUrls = collectDocumentUrls(payload);
        if (writtenUrls.length > 0) {
            try {
                const { enqueuePendingDocuments } = await import("../queue/ocr-producer.js");
                await enqueuePendingDocuments({ originalUrls: writtenUrls });
            } catch (queueErr: any) {
                console.warn(`[loader] Auto-enqueue OCR warning: ${queueErr.message}`);
            }
        }
    }

    return { itemsAdded, itemsUpdated };
}

/** The distinct original URLs of every document in the payload. */
function collectDocumentUrls(payload: EtlPayload): string[] {
    const urls = new Set<string>();
    for (const entity of payload.policyEntities ?? []) {
        for (const doc of entity.documents ?? []) {
            if (doc.originalUrl) {
                urls.add(doc.originalUrl);
            }
        }
    }
    return [...urls];
}
