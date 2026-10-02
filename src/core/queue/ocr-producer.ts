import { Prisma } from "@prisma/client";
import { getRedisClient, OCR_QUEUE_NAME } from "./redis.js";
import type { OcrJobPayload } from "./types.js";
import { prisma } from "../db/loader.js";
import { probePdfMetadata } from "../utils/pdf-metadata.js";

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

/**
 * Anything that has been waiting in the queue longer than this goes to the front
 * regardless of how many pages it has.
 *
 * The queue sorts by page count so a one-page notice is not made to wait behind a
 * two-hundred-page gazette. That is the right default, but taken to its
 * conclusion it means long documents are never converted at all, and those tend to
 * be the gazettes and policy documents -- the most valuable thing in the
 * collection. This is the escape valve: the ordering can reorder the queue, never
 * starve it.
 *
 * Keyed on updated_at, not created_at. updated_at is when the document was last
 * written, which for a queued document is when it was claimed onto the queue -- so
 * this measures time spent *waiting*, which is what starving means. created_at is
 * when the crawler found it, which may be weeks earlier, and keying on that would
 * promote every document in a backlog the moment it was first enqueued.
 *
 * A week is deliberate, and it is longer than it looks. At roughly a minute a
 * page, working through this backlog takes on the order of a fortnight, so a
 * shorter window would fire for the entire queue at once and silently turn the
 * page-count ordering back into arrival order. It has to exceed the time it takes
 * to reach the end of a backlog, or it cannot protect the documents at the end of
 * it.
 */
const STALE_QUEUE_PROMOTION_MINUTES = 10_080;

interface ClaimedDocument {
    id: string;
    original_url: string;
    file_name: string;
    file_type: string | null;
    storage_path: string | null;
    previous_status: string;
}

/** How many jobs a single explicit batch may claim. */
export const OCR_ENQUEUE_MAX = 5000;

/**
 * Re-exported so callers have one module to import the OCR queue surface from.
 * The name itself still lives with the connection it belongs to.
 */
export { OCR_QUEUE_NAME } from "./redis.js";

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
 * Depth of the Redis job list, or `null` when Redis cannot be reached.
 *
 * A queue length is worth reporting but is never worth failing a request over, so
 * an unreachable Redis is reported as "unknown" rather than as an empty queue.
 */
export async function getOcrQueueLength(): Promise<number | null> {
    try {
        const redis = getRedisClient();
        if (redis.status === "wait") {
            await redis.connect();
        }
        return await redis.llen(OCR_QUEUE_NAME);
    } catch (err: any) {
        console.error(`[ocr-producer] Failed to read ${OCR_QUEUE_NAME} depth: ${err.message}`);
        return null;
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
 *
 * A `limit` of `null` claims the entire eligible backlog, which is what the
 * "enqueue everything" control in the OCR workspace sends. The claim is still one
 * atomic statement, so the unbounded form is no less safe than a bounded one.
 */
/**
 * The filters that narrow a claim, shared so the preview and the claim agree.
 *
 * Both are built as SQL fragments rather than a string so the values stay
 * parameters, and both are factored out because a preview that disagrees with the
 * claim is worse than no preview: it would show documents that never get queued.
 */
function eligibilityFilters(options: { originalUrls?: string[]; municipalityCode?: string }) {
    const urlFilter = options.originalUrls?.length
        ? Prisma.sql`AND d.original_url = ANY(${options.originalUrls}::text[])`
        : Prisma.empty;

    const municipalityFilter = options.municipalityCode
        ? Prisma.sql`AND EXISTS (
                SELECT 1
                FROM policy_entities pe
                JOIN municipalities m ON m.id = pe.municipality_id
                WHERE pe.id = d.policy_entity_id AND m.code = ${options.municipalityCode}
            )`
        : Prisma.empty;

    return { municipalityFilter, urlFilter };
}

/** A document as the workspace shows it: enough to open the file and judge it. */
export interface EligibleDocument {
    id: string;
    file_name: string;
    file_type: string | null;
    original_url: string;
    storage_path: string | null;
    ocr_status: string;
    created_at: Date;
}

/**
 * The documents an enqueue would take, without claiming any of them.
 *
 * Read-only and lock-free on purpose: it is a SELECT with the same predicate and
 * the same ordering as the claim, so what the operator inspects is what the next
 * request will queue. It can go stale -- another producer may claim rows in
 * between -- which is why the answer is a preview of the queue order, not a
 * promise. Only the claim guarantees ownership.
 */
export async function peekEligibleDocuments(options?: {
    limit?: number | null;
    municipalityCode?: string;
}): Promise<EligibleDocument[]> {
    const { municipalityFilter, urlFilter } = eligibilityFilters({
        municipalityCode: options?.municipalityCode,
    });

    const limitClause =
        options?.limit === null || options?.limit === undefined
            ? Prisma.empty
            : Prisma.sql`LIMIT ${Math.max(0, Math.trunc(options.limit))}`;

    return await prisma.$queryRaw<EligibleDocument[]>(Prisma.sql`
        SELECT d.id, d.file_name, d.file_type, d.original_url,
               d.storage_path, d.ocr_status, d.created_at
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
        ORDER BY
            -- Anything waiting longer than the promotion window goes first, so the
            -- page-count ordering below cannot starve long documents.
            (d.updated_at < NOW() - make_interval(mins => ${STALE_QUEUE_PROMOTION_MINUTES})) DESC,
            -- Then shortest first: the cost of a conversion is known before it is
            -- queued, so there is no reason to make a cheap document wait for an
            -- expensive one. Rows whose page count could not be read are NULL and
            -- sort last rather than first, because "unknown" is not "zero".
            (d.metadata ->> 'pageCount')::int ASC NULLS LAST,
            d.created_at ASC
        ${limitClause}
    `);
}

/** How many documents the current scope still has eligible, however many are listed. */
export async function countEligibleDocuments(options?: {
    municipalityCode?: string;
}): Promise<number> {
    const { municipalityFilter, urlFilter } = eligibilityFilters({
        municipalityCode: options?.municipalityCode,
    });

    const rows = await prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
        SELECT COUNT(*) AS count
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
    `);

    return Number(rows[0]?.count ?? 0);
}

async function claimPendingDocuments(options: {
    limit: number | null;
    originalUrls?: string[];
    municipalityCode?: string;
}): Promise<ClaimedDocument[]> {
    const { municipalityFilter, urlFilter } = eligibilityFilters({
        originalUrls: options.originalUrls,
        municipalityCode: options.municipalityCode,
    });

    const limitClause =
        options.limit === null
            ? Prisma.empty
            : Prisma.sql`LIMIT ${Math.max(0, Math.trunc(options.limit))}`;

    return await prisma.$queryRaw<ClaimedDocument[]>(Prisma.sql`
        WITH claimable AS (
            SELECT d.id, d.ocr_status AS previous_status
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
            ORDER BY
                (d.updated_at < NOW() - make_interval(mins => ${STALE_QUEUE_PROMOTION_MINUTES})) DESC,
                (d.metadata ->> 'pageCount')::int ASC NULLS LAST,
                d.created_at ASC
            ${limitClause}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE documents AS d
        SET ocr_status = 'queued', updated_at = NOW()
        FROM claimable
        WHERE d.id = claimable.id
        RETURNING d.id, d.original_url, d.file_name, d.file_type, d.storage_path,
                  claimable.previous_status
    `);
}

/**
 * Puts claimed documents back where they were, after a failed publish.
 *
 * The claim and the push are two steps, so a Redis outage between them would
 * otherwise leave documents marked "queued" that no job exists for -- invisible
 * work that the stale-queued reclaim only notices an hour later. That reclaim is
 * the safety net; this is the fix. The statuses go back exactly as they were, so
 * a batch reclaimed from a half-finished "processing" run is not silently
 * downgraded to "pending".
 */
async function releaseClaimedDocuments(claimed: ClaimedDocument[]): Promise<void> {
    const idsByStatus = new Map<string, string[]>();
    for (const doc of claimed) {
        const ids = idsByStatus.get(doc.previous_status) || [];
        ids.push(doc.id);
        idsByStatus.set(doc.previous_status, ids);
    }

    for (const [status, ids] of idsByStatus) {
        try {
            await prisma.$executeRaw`
                UPDATE documents
                SET ocr_status = ${status}, updated_at = NOW()
                WHERE id = ANY(${ids}::uuid[])
                  AND ocr_status = 'queued'
            `;
        } catch (err: any) {
            console.error(
                `[ocr-producer] Failed to release ${ids.length} claim(s) back to '${status}': ${err.message}`,
            );
        }
    }
}

/** What an enqueue actually did, reported from the claim rather than a re-read. */
export interface EnqueueResult {
    /** How many documents were pushed onto the queue. */
    count: number;
    /**
     * The documents that were pushed, in the order they were claimed.
     *
     * Taken from the claim itself rather than re-read afterwards, so it is the
     * authoritative list of what a given enqueue queued and cannot disagree with
     * the queue if another producer claimed rows in between.
     */
    documents: EligibleDocument[];
}

/**
 * How many unprobed documents to resolve before a claim, and how many at a time.
 *
 * Bounded because this runs on the enqueue path, which people click and wait on.
 * Whatever is left over is picked up by the next call, so a large backlog fills in
 * over several enqueues rather than blocking one of them for an hour.
 */
const RESOLVE_BUDGET = 40;
const RESOLVE_CONCURRENCY = 8;

/**
 * Probes any eligible document whose page count has never been established.
 *
 * This is what makes the page count a guarantee rather than a hope. A document
 * cannot be ordered by a number nobody has measured, and a document whose host does
 * not answer cannot be converted at all -- so both are settled here, before
 * anything is claimed, rather than discovered later by a worker burning three
 * minutes on a download that will fail.
 *
 * Two outcomes per document, both useful:
 *
 *   reachable with a count   -> sorted into place, at its true cost
 *   reachable without one   -> queued anyway, sorted last, and the worker records
 *                              the real count once it has downloaded the file
 *   not reachable            -> left pending, never queued, because the download
 *                              would fail too. `npm run ocr:sweep -- unreachable`
 *                              is what eventually marks these skipped.
 *
 * Already-probed documents are skipped: `probedAt` is the marker. Re-probing three
 * thousand known documents on every enqueue would make the button unusable, and
 * nothing about a dead host changes in the time between two clicks.
 */
async function resolvePendingPageCounts(originalUrls?: string[]): Promise<number> {
    const unprobed = await prisma.document.findMany({
        where: {
            ocrStatus: "pending",
            ...(originalUrls?.length ? { originalUrl: { in: originalUrls } } : {}),
            // No probe has ever recorded a result for this document.
            // "Never probed" is expressed as a null metadata column and nothing
            // more elaborate. A JSON-path comparison would be the obvious way to
            // test for the probedAt key, but Postgres refuses `json ->> key = NULL`
            // ("a JSON path cannot be set without a scalar filter"), so it would
            // throw on every enqueue rather than filter anything.
            //
            // It is also unnecessary: the probe writes metadata on every outcome,
            // including failure, so a null column already means "no attempt has
            // been made". Anything non-null has been probed.
            metadata: { equals: Prisma.DbNull },
        },
        select: { id: true, originalUrl: true },
        orderBy: { createdAt: "asc" },
        take: RESOLVE_BUDGET,
    });

    if (unprobed.length === 0) return 0;

    const queue = [...unprobed];
    let resolved = 0;

    // Each task drains the queue. The work is one slow request to a municipal web
    // server, so this is I/O bound and the pool is sized for politeness rather than
    // throughput.
    async function drain(): Promise<void> {
        while (queue.length > 0) {
            const document = queue.shift();
            if (!document) return;
            try {
                const metadata = await probePdfMetadata(document.originalUrl, {
                    timeoutMs: 30_000,
                });
                await prisma.document.update({ where: { id: document.id }, data: { metadata } });
                resolved += 1;
            } catch {
                // Mark it probed-anyway. Without this a document whose probe throws
                // would be retried on every single enqueue, forever.
                await prisma.document
                    .update({
                        where: { id: document.id },
                        data: {
                            metadata: {
                                pageCount: null,
                                reachable: false,
                                probedAt: new Date().toISOString(),
                            },
                        },
                    })
                    .catch(() => undefined);
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(RESOLVE_CONCURRENCY, unprobed.length) }, () => drain()),
    );
    return resolved;
}

/**
 * Queues documents that still need OCR and reports which ones.
 *
 * Pass `originalUrls` to queue only the documents a just-finished ETL load
 * touched. Pass `municipalityCode`, or neither, to sweep the backlog. Either way
 * each document is queued at most once, because claiming moves it out of
 * "pending" and the next call will not select it again.
 *
 * `limit: null` sweeps the whole eligible backlog in one go.
 *
 * Throws if the push fails, after putting the claim back, so a caller never
 * reports a batch as queued when no job exists for it.
 */
export async function enqueuePendingDocuments(options?: {
    limit?: number | null;
    municipalityCode?: string;
    originalUrls?: string[];
}): Promise<EnqueueResult> {
    // An explicit but empty URL list means "these documents", which is nothing.
    if (options?.originalUrls && options.originalUrls.length === 0) {
        return { count: 0, documents: [] };
    }

    // Settle page counts first, so the claim below is ordering on measured cost
    // rather than on arrival order with a hole in it.
    await resolvePendingPageCounts(options?.originalUrls);

    const claimed = await claimPendingDocuments({
        limit: options?.limit === undefined ? 100 : options.limit,
        originalUrls: options?.originalUrls,
        municipalityCode: options?.municipalityCode,
    });

    if (claimed.length === 0) {
        return { count: 0, documents: [] };
    }

    try {
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

        const results = await pipeline.exec();

        // A pipeline resolves with one `[error, result]` pair per command rather
        // than rejecting, so a Redis that is refusing connections can leave a
        // whole batch of jobs unsent and still look like a success. Reading the
        // errors is what makes the rollback below reachable.
        const failure = results?.find((entry) => entry?.[0]);
        if (failure) {
            throw failure[0];
        }
    } catch (err: any) {
        await releaseClaimedDocuments(claimed);
        throw err;
    }

    const scope = options?.originalUrls?.length
        ? `${options.originalUrls.length} URL(s) from this load`
        : options?.municipalityCode
          ? `municipality ${options.municipalityCode}`
          : "the whole backlog";
    console.log(
        `[ocr-producer] Queued ${claimed.length} document(s) from ${scope} onto ${OCR_QUEUE_NAME}`,
    );

    return {
        count: claimed.length,
        documents: claimed.map((doc) => ({
            id: doc.id,
            file_name: doc.file_name,
            file_type: doc.file_type,
            original_url: doc.original_url,
            storage_path: doc.storage_path,
            // A reclaimed row is reported as what it was, not as `queued`, so the
            // list explains why an already-failed document is being retried.
            ocr_status: doc.previous_status,
            created_at: new Date(),
        })),
    };
}
