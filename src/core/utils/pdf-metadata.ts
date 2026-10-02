/**
 * Learning one cheap fact about a remote PDF: how many pages it has.
 *
 * Why this exists
 * ---------------
 * OCR cost is proportional to page count, and a one-page notice costs about a
 * minute while a two-hundred-page gazette costs hours. The OCR queue therefore
 * converts the short documents first, which needs a page count *before* a
 * document is queued -- but the queue does not download the file, and at the
 * moment of queueing nothing knows how big the file is.
 *
 * So we learn it here, once, at crawl time, and store it on the document.
 *
 * How it works
 * ------------
 * No library can answer this from a URL without transferring bytes, so the
 * transfer is the design. A PDF describes its own page count in a `/Count`
 * entry in the page tree, and that entry sits near the front of the file in most
 * PDFs and in the cross-reference block at the back in others. We therefore ask
 * for two small windows -- the first and the last -- and read `/Count` out of
 * whichever replies. That is a few hundred kilobytes instead of the tens of
 * megabytes a full download would cost.
 *
 * Measured against locally generated PDFs, `/Count` was always in the first 64KB
 * and never in the tail, which is why the head is tried first: it is the common
 * case, and it is one request instead of two for most documents.
 *
 * When it cannot be read, pageCount is null. It is never guessed. A wrong page
 * count is worse than no page count, because the queue would then be ordering on
 * a number nobody can trust. Callers treat null as "unknown, sort last", which
 * degrades to arrival order for that document rather than failing.
 */

/**
 * The user-agent these municipal portals expect. Several of them answer a default
 * request with an error page rather than the file, which during a probe looks
 * exactly like a PDF whose page count cannot be read. Matches the agent the OCR
 * worker downloads with, so a document that is reachable for one is reachable for
 * both.
 */
const USER_AGENT =
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

/** How much of the front, and of the back, of the file to read. */
const WINDOW_BYTES = 262_144;

/**
 * Default time to wait for one request.
 *
 * Generous, because these are small municipal portals on slow connections.
 * Measured against live documents from this collection, a HEAD alone regularly
 * took 7-20 seconds; at an 8-second timeout the probe failed on twelve of twelve
 * real documents, and at 30 seconds it read eleven. A timeout tuned to a data
 * centre would report almost the whole backlog as unmeasurable and quietly
 * disable the ordering it exists to provide.
 */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * Extensions that are a single page by definition.
 *
 * A JPEG is one image, so it is one page. This is the most valuable branch in the
 * probe and it costs nothing: about 8% of this collection is a bare image, those
 * documents are the cheapest in the entire backlog, and deciding they are one
 * page requires no network call at all. The same documents would otherwise each
 * cost a 7-20 second round trip to a slow server to learn what their own
 * extension already says.
 */
const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "tif", "tiff", "webp", "bmp", "gif", "heic"];

/** The lowercase extension of a URL's path, or "" when it has none. */
function extensionOf(url: string): string {
    try {
        const path = new URL(url).pathname;
        const lastSegment = path.split("/").pop() ?? "";
        const dot = lastSegment.lastIndexOf(".");
        return dot === -1 ? "" : lastSegment.slice(dot + 1).toLowerCase();
    } catch {
        return "";
    }
}

function isImageExtension(url: string): boolean {
    return IMAGE_EXTENSIONS.includes(extensionOf(url));
}

/**
 * The JSON stored in documents.metadata. Every field is optional because a probe
 * can fail partway: the HEAD may answer and the ranged GET may not.
 */
export interface DocumentMetadata {
    /** Number of pages, read from the PDF's page tree. Null when it could not be read. */
    pageCount?: number | null;
    /** File size in bytes, from the HEAD response's Content-Length. */
    fileSizeBytes?: number | null;
    /** When this probe ran. So a stale count is visible rather than silently trusted. */
    probedAt?: string;
    /**
     * Whether the file could be fetched at all.
     *
     * This is the field that separates the two ways a page count can be missing,
     * and they are not the same problem:
     *
     *   reachable=false means the host is gone or the file is not there. Nothing
     *     can be done with this document at all, so it must not be queued for OCR.
     *
     *   reachable=true with a null pageCount means the file answered but its page
     *     tree could not be parsed -- an unusual PDF layout, most likely. The
     *     download will still work, so it should be queued and sorted last, and
     *     the worker fills in the real count once it has the file in hand.
     *
     * Without this field the two cases are indistinguishable, and a queue that
     * treats "unknown" as "reachable" spends its time re-failing downloads of
     * documents whose hosts died months ago.
     */
    reachable?: boolean | null;
    /**
     * JSONB is open-ended: the next cheap fact worth recording needs no migration.
     * Prisma requires an index signature on anything assigned to a Json column,
     * which is why this is here rather than on the named fields alone. The type is
     * deliberately narrow -- a JSON column will happily hold anything, and this is
     * the only thing that keeps it readable.
     */
    [key: string]: number | string | boolean | null | undefined;
}

function isHttpUrl(url: string): boolean {
    try {
        return new URL(url).protocol.startsWith("http");
    } catch {
        return false;
    }
}

/**
 * Pull every `/Count N` out of a buffer of PDF bytes.
 *
 * A well-formed PDF has one, in the page tree root. Taking the maximum is the
 * safe reading: the root's count is the total, and a malformed file can carry
 * smaller counts deeper in the tree. Taking the first one instead would
 * under-report a document and quietly push it to the back of the queue.
 */
function readPageCount(buffer: Buffer): number | null {
    // latin1, not utf8: the PDF syntax is byte-oriented, so a multi-byte
    // character must not be mangled into a false match. The bytes around `/Count`
    // are ASCII either way, but latin1 is the honest decoding for binary data.
    const text = buffer.toString("latin1");
    let best: number | null = null;
    for (const match of text.matchAll(/\/Count\s+(\d+)/g)) {
        const value = Number(match[1]);
        if (Number.isSafeInteger(value) && (best === null || value > best)) {
            best = value;
        }
    }
    // A zero-page PDF is not a thing worth queueing on the strength of one field.
    return best && best > 0 ? best : null;
}

/** Read the front or the back of a remote file. Returns null if the server refuses. */
async function readWindow(
    url: string,
    rangeHeader: string,
    timeoutMs: number,
): Promise<Buffer | null> {
    try {
        const response = await fetch(url, {
            headers: { "User-Agent": USER_AGENT, Range: rangeHeader },
            signal: AbortSignal.timeout(timeoutMs),
        });

        // 206 is a real ranged reply. 200 means the server ignored the Range
        // header and is sending the whole file, which is the one outcome that
        // makes this probe expensive -- but it is also a valid answer, so read it
        // rather than discard it. The bytes are already in flight by then.
        if (response.status !== 206 && response.status !== 200) return null;

        return Buffer.from(await response.arrayBuffer());
    } catch {
        // A portal that is down, slow, or does not answer Range is not an error
        // here. The document still gets queued; it just sorts as unknown.
        return null;
    }
}

/**
 * How many documents to probe at once.
 *
 * Modest, because a probe is one slow round trip to a municipal web server rather
 * than a fast API call -- measured at 7-20 seconds each against this collection.
 * The work is entirely I/O bound, so raising this buys very little and makes the
 * crawler's requests rude faster.
 */
const RESOLVE_CONCURRENCY = 8;

/** How long to wait per request while a crawl is running. */
const RESOLVE_TIMEOUT_MS = 30_000;

/**
 * Fills in the page count for any document in `documents` that does not have one.
 *
 * This exists because documents reach the database by more than one route, and
 * none of them probe. Documents are built either by `extractDocumentLinks` in
 * `utils/html.ts`, which scans a page's markup for links to files, or by
 * `buildDocument` in `utils/document.ts`, for a page that is itself the document.
 * Both are synchronous and cheap, and a probe is neither.
 *
 * Rather than make those helpers async and change every transform that calls them,
 * this runs once on the way to the database. One place, and it catches every path
 * including ones added later.
 *
 * Documents that already carry metadata are left alone, so this costs nothing for
 * the routes that did probe.
 *
 * Mutates and returns the same array. Never throws: a document that cannot be
 * probed gets metadata recording that, which is what keeps it out of the front of
 * the OCR queue without stopping the scrape.
 */
export async function resolveDocumentMetadata<
    T extends { originalUrl?: string; metadata?: unknown },
>(documents: T[], options: { timeoutMs?: number; concurrency?: number } = {}): Promise<T[]> {
    const needingProbe = documents.filter(
        (doc) => doc.originalUrl?.startsWith("http") && doc.metadata === undefined,
    );
    if (needingProbe.length === 0) return documents;

    const timeoutMs = options.timeoutMs ?? RESOLVE_TIMEOUT_MS;
    const concurrency = Math.max(1, options.concurrency ?? RESOLVE_CONCURRENCY);

    let cursor = 0;

    // Each worker pulls the next index off the shared cursor, so no document is
    // probed twice and no worker sits idle while another queue grows long.
    async function worker(): Promise<void> {
        for (;;) {
            const index = cursor;
            cursor += 1;
            if (index >= needingProbe.length) return;

            const doc = needingProbe[index];
            try {
                doc.metadata = await probePdfMetadata(doc.originalUrl!, { timeoutMs });
            } catch {
                doc.metadata = {
                    pageCount: null,
                    reachable: false,
                    probedAt: new Date().toISOString(),
                };
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, needingProbe.length) }, worker));
    return documents;
}

/**
 * Learn a document's page count without downloading it.
 *
 * Returns whatever could be established. `pageCount` is null when the file could
 * not be read, which is a normal outcome and never throws.
 *
 * timeoutMs is exposed because the right value depends entirely on the caller: a
 * crawl wants to fail fast and move on, while the batch backfill is the one place
 * where being patient is worth the wall-clock time.
 */
export async function probePdfMetadata(
    url: string,
    options: { timeoutMs?: number } = {},
): Promise<DocumentMetadata> {
    const probedAt = new Date().toISOString();
    const timeoutMs = options.timeoutMs ?? PROBE_TIMEOUT_MS;

    // An image is one page, and its extension says so. Settled without a request.
    if (isImageExtension(url)) {
        return { pageCount: 1, fileSizeBytes: null, reachable: true, probedAt };
    }

    if (!isHttpUrl(url)) {
        return { pageCount: null, fileSizeBytes: null, reachable: false, probedAt };
    }

    // HEAD first: one small round trip, and it is the only request that yields the
    // file size and the content type. Both matter -- the content type is how a
    // document with no useful extension turns out to be an image after all.
    //
    // It also answers the question that pageCount cannot: is this host there? A
    // HEAD that times out or errors is the signal that the file is unreachable, and
    // that is worth more than a page count because it decides whether the document
    // should be queued at all.
    let fileSizeBytes: number | null = null;
    let contentType = "";
    let reachable = false;
    try {
        const head = await fetch(url, {
            method: "HEAD",
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(timeoutMs),
        });
        contentType = (head.headers.get("content-type") ?? "").toLowerCase();
        // Some of these portals answer HEAD with 403 or 405 while serving GET
        // perfectly well, so a refusal to answer the cheap request is not proof of
        // absence. Only a server that answered at all counts as reachable here; the
        // ranged GET below settles the rest.
        if (head.status < 400) {
            reachable = true;
        }
        const length = head.headers.get("content-length");
        if (length && /^\d+$/.test(length)) {
            fileSizeBytes = Number(length);
        }
    } catch {
        // No HEAD answer. Fall through: the ranged GET may still work on a server
        // that is merely slow to answer, and it is the request that actually reads
        // the bytes.
    }

    // A document that turned out to be an image is still one page. Worth checking
    // after the HEAD, because a third of the files here carry no extension at all
    // -- many are named after their Nepali title -- and an image among them is
    // invisible until something says so.
    if (contentType.startsWith("image/")) {
        return { pageCount: 1, fileSizeBytes, reachable: true, probedAt };
    }

    // Head window first: measured to be where /Count lives in most PDFs. A window
    // that arrives at all is also proof of life, whatever it does or does not
    // contain.
    const head = await readWindow(url, `bytes=0-${WINDOW_BYTES - 1}`, timeoutMs);
    let pageCount = head ? readPageCount(head) : null;
    if (head) reachable = true;

    // Tail window second, for the PDFs that keep their cross-reference block at
    // the back. Skipped when the head already answered, so the common case costs
    // one request.
    if (pageCount === null) {
        const tail = await readWindow(url, `bytes=-${WINDOW_BYTES}`, timeoutMs);
        if (tail) {
            reachable = true;
            pageCount = readPageCount(tail);
        }
    }

    return { pageCount, fileSizeBytes, reachable, probedAt };
}
