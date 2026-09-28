import path from "path";
import { MIME_TYPES } from "../constants/file.js";

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
