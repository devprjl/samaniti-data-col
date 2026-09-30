import { Prisma } from "@prisma/client";
import { getRedisClient, OCR_QUEUE_NAME } from "./redis.js";
import type { OcrJobPayload } from "./types.js";
import { prisma } from "../db/loader.js";

/**
 * A job left in "queued" for longer than this is assumed lost -- Redis was
 * flushed, or the queue was drained by something that did not run the worker.
 */
const STALE_QUEUED_MINUTES = 60;

/**
 * A document left in "processing" for longer than this is assumed lost, because
 * the worker was killed part-way through a conversion and never got to mark it
 * failed. The window is generous on purpose: a single PDF of a few hundred pages
 * runs on the CPU for hours, and reclaiming a job that is still running would
 * queue the same document twice.
 */
const STALE_PROCESSING_MINUTES = 360;

interface ClaimedDocument {
    id: string;
    original_url: string;
    file_name: string;
    file_type: string | null;
}

/**
 * Pushes a single document OCR task to the Redis job queue.
 *
 * The document is expected to have been claimed already (see
 * {@link enqueuePendingDocuments}); this only publishes.
 */
export async function enqueueOcrJob(payload: OcrJobPayload): Promise<boolean> {
    try {
        const redis = getRedisClient();
        if (redis.status === "wait") {
            await redis.connect();
        }
        await redis.lpush(OCR_QUEUE_NAME, JSON.stringify(payload));
        return true;
    } catch (err: any) {
        console.error(
            `[ocr-producer] Failed to enqueue job for doc ${payload.document_id}: ${err.message}`,
        );
        return false;
    }
}

/**
 * Atomically moves eligible documents from "pending" to "queued" and returns them.
 *
 * The claim is what makes queueing idempotent, and it is the reason this used to
 * be a bug. The ETL loads one page at a time, and the old code re-queried every
 * pending document for the municipality on each load, so a hundred-page run
 * queued the same backlog a hundred times before the worker had finished a
 * single job. A document that is already "queued" is not selected again.
 *
 * `FOR UPDATE SKIP LOCKED` means concurrent producers skip rows another producer
 * is claiming instead of blocking on them, and the `RETURNING` clause reports
 * only the rows this statement actually took -- so a producer never queues a
 * document another one already owns.
 */
async function claimPendingDocuments(options: {
    limit: number;
    originalUrls?: string[];
    municipalityCode?: string;
}): Promise<ClaimedDocument[]> {
    const originalUrls = options.originalUrls;

    const urlFilter = originalUrls?.length
        ? Prisma.sql`AND d.original_url = ANY(${originalUrls}::text[])`
        : Prisma.empty;

    const municipalityFilter = options.municipalityCode
        ? Prisma.sql`AND EXISTS (
                SELECT 1
                FROM policy_entities pe
                JOIN municipalities m ON m.id = pe.municipality_id
                WHERE pe.id = d.policy_entity_id AND m.code = ${options.municipalityCode}
            )`
        : Prisma.empty;

    return await prisma.$queryRaw<ClaimedDocument[]>(Prisma.sql`
        WITH claimable AS (
            SELECT d.id
            FROM documents d
            WHERE (
                    (d.ocr_status = 'pending' AND (d.ocr_data IS NULL OR d.ocr_data = ''))
                 OR (d.ocr_status = 'queued'
                     AND d.updated_at < NOW() - make_interval(mins => ${STALE_QUEUED_MINUTES}))
                 OR (d.ocr_status = 'processing'
                     AND d.updated_at < NOW() - make_interval(mins => ${STALE_PROCESSING_MINUTES}))
                )
                ${urlFilter}
                ${municipalityFilter}
            ORDER BY d.created_at ASC
            LIMIT ${options.limit}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE documents AS d
        SET ocr_status = 'queued', updated_at = NOW()
        FROM claimable
        WHERE d.id = claimable.id
        RETURNING d.id, d.original_url, d.file_name, d.file_type
    `);
}

/**
 * Queues documents that still need OCR and returns how many were queued.
 *
 * Pass `originalUrls` to queue only the documents a just-finished ETL load
 * touched. Pass `municipalityCode`, or neither, to sweep the backlog. Either way
 * each document is queued at most once, because claiming moves it out of
 * "pending" and the next call will not select it again.
 */
export async function enqueuePendingDocuments(options?: {
    limit?: number;
    municipalityCode?: string;
    originalUrls?: string[];
}): Promise<number> {
    // An explicit but empty URL list means "these documents", which is nothing.
    if (options?.originalUrls && options.originalUrls.length === 0) {
        return 0;
    }

    const claimed = await claimPendingDocuments({
        limit: options?.limit ?? 100,
        originalUrls: options?.originalUrls,
        municipalityCode: options?.municipalityCode,
    });

    if (claimed.length === 0) {
        return 0;
    }

    const redis = getRedisClient();
    if (redis.status === "wait") {
        await redis.connect();
    }

    const pipeline = redis.pipeline();
    for (const doc of claimed) {
        const payload: OcrJobPayload = {
            document_id: doc.id,
            source_url: doc.original_url,
            file_name: doc.file_name,
            file_type: doc.file_type,
            engine: "auto",
        };
        pipeline.lpush(OCR_QUEUE_NAME, JSON.stringify(payload));
    }
    await pipeline.exec();

    const scope = options?.originalUrls?.length
        ? `${options.originalUrls.length} URL(s) from this load`
        : options?.municipalityCode
          ? `municipality ${options.municipalityCode}`
          : "the whole backlog";
    console.log(
        `[ocr-producer] Queued ${claimed.length} document(s) from ${scope} onto ${OCR_QUEUE_NAME}`,
    );
    return claimed.length;
}
