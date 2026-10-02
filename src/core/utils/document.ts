import { DocumentData } from "../types/domain.js";

/**
 * The single place a DocumentData is constructed.
 *
 * Documents are discovered in two ways, and there used to be two separate
 * implementations, which had drifted apart:
 *
 *   extractDocumentLinks()  scans a page's HTML for links to files
 *   buildDocument()        takes a URL someone already holds
 *
 * They disagreed on `fileType` (a MIME type against a bare extension) and on
 * `downloadStatus` ("pending" against "skipped"), so the same file scraped by
 * two municipalities produced two different rows. Both now come through here, so
 * there is one shape and the two entry points only differ in where the URL came
 * from.
 *
 * @param fileUrl  Relative or absolute. Query strings and fragments are dropped,
 *                 because the same file reached through a tracking-tagged link is
 *                 one document, not two.
 * @param baseUrl  Site root, used to resolve a relative URL
 * @param fileName A human-readable name. Derived from the URL when not given.
 */
export function createDocument(fileUrl: string, baseUrl: string, fileName?: string): DocumentData {
    const absoluteUrl = resolveUrl(fileUrl, baseUrl);

    return {
        fileName: fileName?.trim() || nameFromUrl(absoluteUrl),
        // The bare extension, not a MIME type. Nothing downstream distinguishes
        // them -- the OCR worker reads the suffix off the URL itself -- and an
        // extension is what the DOM scanner has to work with anyway.
        fileType: extensionOf(absoluteUrl) || "unknown",
        originalUrl: absoluteUrl,
        // The scraper records where a document lives; it never downloads the
        // attachment. So "skipped" is the truthful value, and it is what the DOM
        // scanner has always recorded. Nothing branches on this field.
        storagePath: null,
        downloadStatus: "skipped",
        downloadError: null,
    };
}

/**
 * Builds a DocumentData for a URL the caller already holds.
 *
 * This is the narrow case: a page that *is* the document, such as a detail page
 * served straight as a PDF. There is no link in the HTML for the DOM scanner to
 * find, so this cannot be folded into `extractDocumentLinks`.
 *
 * It exists for exactly one caller. Everywhere else the document is a link on a
 * page, and those routes should be using `extractDocumentLinks` -- which handles
 * the ignore-list, image resolution and de-duplication that this deliberately does
 * not, because it has no markup to work with.
 *
 * Synchronous, and it does not probe the file. Measuring a document's page count
 * is a network call, and it happens in one place for every document instead:
 * `resolveDocumentMetadata`, called by the pipeline on the way to the database.
 * Keeping the probe here would mean documents discovered this way were measured
 * twice.
 */
export function buildDocument(fileUrl: string, baseUrl: string, fileName?: string): DocumentData {
    return createDocument(fileUrl, baseUrl, fileName);
}

/** A URL as an absolute, fragment-free, query-free string. */
export function resolveUrl(fileUrl: string, baseUrl: string): string {
    const trimmed = fileUrl.trim();
    if (!trimmed) return "";

    try {
        // `new URL` handles the awkward cases the scraper actually meets: relative
        // paths, protocol-relative "//host/x.pdf", and a baseUrl with a trailing
        // slash or without one.
        const parsed = new URL(trimmed, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
        parsed.hash = "";
        parsed.search = "";
        return parsed.href;
    } catch {
        // A malformed URL is not worth losing the document over. Keep whatever we
        // were given, minus the fragment, so it can still be looked up later.
        return trimmed.split("#")[0].split("?")[0];
    }
}

/** The lowercase extension of a URL's last path segment, or "" when it has none. */
export function extensionOf(url: string): string {
    const lastSegment = url.split("?")[0].split("#")[0].split("/").pop() ?? "";
    const dot = lastSegment.lastIndexOf(".");
    return dot <= 0 ? "" : lastSegment.slice(dot + 1).toLowerCase();
}

/** The last path segment of a URL, percent-decoded, as a display name. */
function nameFromUrl(url: string): string {
    const lastSegment = url.split("?")[0].split("#")[0].split("/").pop() || "";
    if (!lastSegment) return "Document";
    try {
        return decodeURIComponent(lastSegment) || "Document";
    } catch {
        // Not valid percent-encoding, so the raw segment is the best available name.
        return lastSegment;
    }
}
