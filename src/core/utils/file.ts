import path from "path";
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { MIME_TYPES } from "../constants/file.js";
import { getS3Client, getS3PublicUrl, S3_BUCKET } from "../storage/config.js";
import type { DocumentData } from "../types/domain.js";

// Global in-memory cache shared across all upload calls in the running process
const globalUploadCache = new Map<string, string>();

/**
 * Filename facts used when a record is written: the extension, the name without
 * it, and the MIME type that goes with it.
 */
export interface FileMetadata {
    nameWithoutExtension: string;
    extension: string;
    mimeType: string;
}

/**
 * Strips the extension from a filename and resolves its MIME type.
 *
 * @param filename - The filename or path (e.g., "foobar.pdf", "/tmp/report.v1.docx")
 * @returns Metadata containing filename without extension, extension, and mimeType
 */
export function getFileMetadata(filename: string): FileMetadata {
    const ext = path.extname(filename).toLowerCase().replace(".", "");

    const nameWithoutExtension = path.basename(filename, ext ? `.${ext}` : "");

    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    return {
        nameWithoutExtension,
        extension: ext,
        mimeType,
    };
}

/** Result of a single upload attempt. */
export interface UploadResult {
    originalUrl: string;
    /** The full public S3 URL, or null when the upload failed. */
    storageUrl: string | null;
    /** Human-readable error when the upload failed, null on success. */
    error: string | null;
}

/**
 * Downloads a remote file and streams it straight to S3 — no local disk used.
 *
 * Deduplication checks:
 * 1. Process memory cache: immediately returns if already uploaded in this process.
 * 2. S3 HeadObject check: if the object key already exists in the S3 bucket,
 *    skips downloading from the municipal portal and skips re-uploading.
 *
 * Returns the full normalized public S3 URL, which is what gets stored in `storagePath`.
 *
 * Throws on fetch failure or S3 error so the caller can decide how to handle it.
 */
export async function streamUrlToS3(
    fileUrl: string,
    destinationFolder: string,
    fileName: string,
    forceOverwrite = false,
): Promise<string> {
    if (!S3_BUCKET) {
        throw new Error("AWS_BUCKET_NAME is not defined in the environment.");
    }

    // 1. In-process cache check
    if (globalUploadCache.has(fileUrl)) {
        return globalUploadCache.get(fileUrl)!;
    }

    const s3Key = `${destinationFolder.replace(/\/+$/, "")}/${fileName.replace(/^\/+/, "")}`;
    const s3 = getS3Client();

    // 2. S3 bucket existence check: avoids re-downloading and re-uploading
    if (!forceOverwrite) {
        try {
            await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
            const existingUrl = getS3PublicUrl(s3Key);
            console.log(`[storage] Object already exists in S3 (${s3Key}), skipping upload.`);
            globalUploadCache.set(fileUrl, existingUrl);
            return existingUrl;
        } catch (err: unknown) {
            // If NotFound (404), the file does not exist in S3 yet — proceed to upload.
            const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
                ?.httpStatusCode;
            const name = (err as { name?: string })?.name;
            if (status !== 404 && name !== "NotFound") {
                // Warning on unexpected errors, but don't block upload attempt
                const msg = err instanceof Error ? err.message : String(err);
                console.warn(`[storage] HeadObject check warning for ${s3Key}: ${msg}`);
            }
        }
    }

    const response = await fetch(fileUrl, {
        headers: {
            // Several municipal portals reject requests that look like bots.
            "User-Agent":
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        },
    });

    if (!response.ok) {
        throw new Error(
            `Failed to fetch file from remote URL: ${fileUrl} (Status: ${response.status})`,
        );
    }

    if (!response.body) {
        throw new Error(`Response body is missing for URL: ${fileUrl}`);
    }

    // AWS SDK v3 on Node.js requires a Buffer or Uint8Array — not a browser
    // ReadableStream. arrayBuffer() reads the full response into memory, which
    // is acceptable for the document sizes here (municipal PDFs up to ~100MB).
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const contentType = response.headers.get("content-type") ?? "application/octet-stream";

    const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: buffer,
        ContentType: contentType,
    });

    await s3.send(command);

    const publicUrl = getS3PublicUrl(s3Key);
    console.log(`[storage] Uploaded to S3: ${s3Key} -> ${publicUrl}`);
    globalUploadCache.set(fileUrl, publicUrl);
    return publicUrl;
}

/**
 * Uploads all documents in an array to S3, updating each document in-place
 * with the resulting `storagePath` (public URL) and `downloadStatus`.
 *
 * Features:
 * - Sequential execution so municipal servers are not overloaded.
 * - Deduplication cache: identical URLs within the same batch are uploaded
 *   only once, and all matching document instances are populated with the same URL.
 * - Non-fatal error handling: a single document failure logs an error and
 *   marks that document as "failed" without halting the pipeline.
 *
 * @param documents         Array of DocumentData to upload. Modified in-place.
 * @param destinationFolder S3 prefix/folder, e.g. "documents/madesh/harion-mun".
 * @returns A summary of how many succeeded and failed.
 */
export async function uploadDocumentsToS3(
    documents: DocumentData[],
    destinationFolder: string,
): Promise<{ succeeded: number; failed: number; results: UploadResult[] }> {
    let succeeded = 0;
    let failed = 0;
    const results: UploadResult[] = [];

    // Cache of originalUrl -> { storageUrl, error } so duplicate documents
    // within the same crawl/transform are uploaded once and shared.
    const urlCache = new Map<
        string,
        { storageUrl: string | null; error: string | null; status: "ok" | "failed" }
    >();

    for (const doc of documents) {
        if (!doc.originalUrl) continue;

        // Check global process cache or batch cache
        if (globalUploadCache.has(doc.originalUrl)) {
            const cachedUrl = globalUploadCache.get(doc.originalUrl)!;
            doc.storagePath = cachedUrl;
            doc.downloadStatus = "ok";
            doc.downloadError = null;
            continue;
        }

        if (urlCache.has(doc.originalUrl)) {
            const cached = urlCache.get(doc.originalUrl)!;
            doc.storagePath = cached.storageUrl;
            doc.downloadStatus = cached.status;
            doc.downloadError = cached.error;
            continue;
        }

        const result: UploadResult = {
            originalUrl: doc.originalUrl,
            storageUrl: null,
            error: null,
        };

        try {
            const fileName =
                doc.fileName || path.basename(doc.originalUrl.split("?")[0]) || "document.pdf";
            const storageUrl = await streamUrlToS3(doc.originalUrl, destinationFolder, fileName);

            // Mutate the document in-place so downstream loaders store the URL
            doc.storagePath = storageUrl;
            doc.downloadStatus = "ok";
            doc.downloadError = null;

            result.storageUrl = storageUrl;
            urlCache.set(doc.originalUrl, {
                storageUrl,
                error: null,
                status: "ok",
            });
            succeeded++;
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[storage] Failed to upload ${doc.originalUrl}: ${message}`);

            doc.downloadStatus = "failed";
            doc.downloadError = message;

            result.error = message;
            urlCache.set(doc.originalUrl, {
                storageUrl: null,
                error: message,
                status: "failed",
            });
            failed++;
        }

        results.push(result);
    }

    console.log(
        `[storage] Upload batch complete: ${succeeded} succeeded, ${failed} failed (folder: ${destinationFolder})`,
    );

    return { succeeded, failed, results };
}
