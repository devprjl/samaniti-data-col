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
            },
        })),
    };
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
        },
        create: {
            ...entityFields,
            municipalityId: municipality.id,
            documents: buildDocumentUpsertQuery(documents),
        },
    });

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
export async function recordScraperRun(municipalityCode: string, meta: ScraperRunMeta): Promise<void> {
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
    const mun = await upsertMunicipality(payload.municipality);

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

    return { itemsAdded, itemsUpdated };
}
