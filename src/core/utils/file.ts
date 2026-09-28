import path from "path";
import fs from "fs";
import { Agent, fetch } from "undici";
import { DownloadStatus } from "../types/domain.js";
import { MIME_TYPES } from "../constants/file.js";

// Default timeout: 60 seconds (60,000ms), or configurable via FILE_DOWNLOAD_TIMEOUT_MS
const DEFAULT_TIMEOUT_MS = process.env.FILE_DOWNLOAD_TIMEOUT_MS
    ? parseInt(process.env.FILE_DOWNLOAD_TIMEOUT_MS, 10)
    : 60_000;

const defaultDispatcher = new Agent({
    connect: { timeout: DEFAULT_TIMEOUT_MS },
    headersTimeout: DEFAULT_TIMEOUT_MS,
    bodyTimeout: DEFAULT_TIMEOUT_MS,
});

/** Result returned by downloadAndSaveDocument — always populated, never null. */
export interface DownloadResult {
    storagePath: string | null;
    downloadStatus: DownloadStatus;
    downloadError: string | null;
}

export interface FileMetadata {
    nameWithoutExtension: string;
    extension: string;
    mimeType: string;
}

/**
 * Downloads a file from a URL and saves it to the structured folder path:
 * storage/province/municipality/rootFolder/typeFolder/timestamp.ext
 *
 * Always returns a DownloadResult — never throws. Callers should persist the
 * result to the database regardless of success or failure so no data is lost.
 */
export async function downloadAndSaveDocument(
    municipalityProvince: string,
    municipalityCode: string,
    fileUrl: string,
    titleNe: string,
    publishedDate: string | null,
    reportType: string,
    rootFolder: string = "reports",
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<DownloadResult> {
    // Skip mode — no file is downloaded but we still record the intent
    if (process.env.SKIP_FILE_DOWNLOADS === "true") {
        return {
            storagePath: null,
            downloadStatus: "skipped",
            downloadError: null,
        };
    }

    try {
        const province = municipalityProvince.toLowerCase();
        const municipality = municipalityCode.toLowerCase();
        const rootDir = rootFolder.toLowerCase().replace(/\s+/g, "_");
        const typeFolder = reportType.toLowerCase().replace(/\s+/g, "_");

        // storage/province/municipality/rootDir[/typeFolder]
        const baseDir =
            rootDir === typeFolder
                ? path.join(process.cwd(), "storage", province, municipality, rootDir)
                : path.join(process.cwd(), "storage", province, municipality, rootDir, typeFolder);

        if (!fs.existsSync(baseDir)) {
            fs.mkdirSync(baseDir, { recursive: true });
        }

        const fileExtension = path.extname(new URL(fileUrl).pathname) || ".pdf";
        const timestamp = Date.now();
        const finalFileName = `${timestamp}${fileExtension}`;
        const absoluteStoragePath = path.join(baseDir, finalFileName);

        // Skip downloading if the file already exists locally
        if (fs.existsSync(absoluteStoragePath)) {
            return {
                storagePath: absoluteStoragePath,
                downloadStatus: "ok",
                downloadError: null,
            };
        }

        const dispatcher =
            timeoutMs === DEFAULT_TIMEOUT_MS
                ? defaultDispatcher
                : new Agent({
                      connect: { timeout: timeoutMs },
                      headersTimeout: timeoutMs,
                      bodyTimeout: timeoutMs,
                  });

        const response = await fetch(fileUrl, {
            dispatcher,
            signal: AbortSignal.timeout(timeoutMs),
        });

        if (!response.ok) {
            const errMsg = `HTTP ${response.status} ${response.statusText}`;
            console.warn(`[Download Failed] ${errMsg} — ${fileUrl}`);
            return {
                storagePath: null,
                downloadStatus: "failed",
                downloadError: errMsg,
            };
        }

        const arrayBuffer = await response.arrayBuffer();
        fs.writeFileSync(absoluteStoragePath, Buffer.from(arrayBuffer));

        console.log(`[Downloaded] Saved to: ${absoluteStoragePath}`);
        return {
            storagePath: absoluteStoragePath,
            downloadStatus: "ok",
            downloadError: null,
        };
    } catch (error) {
        const errMsg = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.error(`[Error downloading file from ${fileUrl}]: ${errMsg}`);
        return {
            storagePath: null,
            downloadStatus: "failed",
            downloadError: errMsg,
        };
    }
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
