import type { DocumentData } from "../types/domain.js";
import { uploadDocumentsToS3 } from "../utils/file.js";
import { prisma } from "../db/loader.js";

/**
 * Safely synchronises an array of extracted documents to cloud storage (S3)
 * if enabled in the environment.
 *
 * Deduplication checks:
 * 1. Skips documents that already have an HTTP/HTTPS storagePath.
 * 2. Queries PostgreSQL in a single batch query: if a document was already uploaded
 *    in an earlier run, its storagePath is reused without touching S3 or fetching the file.
 * 3. Uploads only genuinely new or un-uploaded documents.
 *
 * Safeguards:
 * - Never runs in Vercel (`process.env.VERCEL`).
 * - Only runs when `FILE_DOWNLOAD=true` (or `FILE_DOWNLOAD=1`).
 * - Mutates document objects in-place with their S3 public URL (`storagePath`)
 *   and sets `downloadStatus = "ok"`.
 *
 * @param documents         Array of DocumentData to sync. Modified in-place.
 * @param destinationFolder S3 folder prefix, defaults to "samaniti-poc".
 */
export async function syncDocumentsToStorage(
    documents: DocumentData[],
    destinationFolder = "samaniti-poc",
): Promise<void> {
    if (!documents || documents.length === 0) return;

    const isVercel = Boolean(process.env.VERCEL);
    const isFileDownloadEnabled =
        process.env.FILE_DOWNLOAD === "true" ||
        process.env.FILE_DOWNLOAD === "1"

    if (isVercel || !isFileDownloadEnabled) return;

    // Filter out documents that already have an uploaded cloud URL
    const pendingDocs: DocumentData[] = [];
    const urlsToCheck: string[] = [];

    for (const doc of documents) {
        if (doc.storagePath?.startsWith("http://") || doc.storagePath?.startsWith("https://")) {
            // Already synced
            continue;
        }
        if (doc.originalUrl) {
            urlsToCheck.push(doc.originalUrl);
            pendingDocs.push(doc);
        }
    }

    if (pendingDocs.length === 0) return;

    // Database deduplication check: find files already recorded in Postgres
    try {
        const existingRecords = await prisma.document.findMany({
            where: {
                originalUrl: { in: urlsToCheck },
                storagePath: { not: null },
            },
            select: {
                originalUrl: true,
                storagePath: true,
                downloadStatus: true,
            },
        });

        if (existingRecords.length > 0) {
            const existingMap = new Map(
                existingRecords.map((r) => [r.originalUrl, r.storagePath]),
            );

            // Re-use storagePath for any document already uploaded in a previous scrape
            for (let i = pendingDocs.length - 1; i >= 0; i--) {
                const doc = pendingDocs[i];
                const existingPath = existingMap.get(doc.originalUrl);
                if (existingPath) {
                    doc.storagePath = existingPath;
                    doc.downloadStatus = "ok";
                    doc.downloadError = null;
                    // Remove from pending upload list
                    pendingDocs.splice(i, 1);
                }
            }
        }
    } catch (err: unknown) {
        // If DB query fails for any reason, continue with upload without crashing
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[storage] Database deduplication check skipped due to error: ${message}`);
    }

    // Upload remaining documents to S3
    if (pendingDocs.length > 0) {
        await uploadDocumentsToS3(pendingDocs, destinationFolder);
    }
}
