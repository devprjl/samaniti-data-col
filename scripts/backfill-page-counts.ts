/**
 * Backfills documents.metadata with a PDF page count.
 *
 *     npm run ocr:pages -- --limit 5000
 *     npm run ocr:pages -- --limit 5000 --municipality POKHARA1
 *
 * Why this exists
 * ---------------
 * The crawl probes each PDF as it is discovered and records its page count, so
 * new documents arrive pre-measured. The backlog predates that column and has a
 * null count on every row, and the OCR queue sorts unknowns last -- which means
 * without this, the shortest-document-first ordering does nothing at all for the
 * documents that actually need converting.
 *
 * This walks the backlog once and fills in what it can. It is safe to re-run: a
 * document that already has a count is skipped unless --refresh is passed, so a
 * re-run costs nothing rather than re-probing thousands of documents.
 *
 * It is also safe to interrupt. Counts are written one document at a time as
 * they are learned, so stopping early leaves the work done so far.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "../src/core/db/loader.js";
import { probePdfMetadata } from "../src/core/utils/pdf-metadata.js";

/**
 * How many documents to probe at once.
 *
 * Modest, because each probe is one slow round trip to a municipal web server
 * rather than a fast API call. Measured against this collection, a single HEAD
 * takes 7-20 seconds, so the run is dominated by waiting on other people's
 * servers. Raising this does not make it much faster and does make it rude.
 */
const CONCURRENCY = 8;

/**
 * How long to wait for one request.
 *
 * Longer than the probe's own default on purpose: this is the only place where
 * patience buys anything, because there is no crawl to fall behind on. At the
 * default the probe failed on every real document it was tried against; at 30
 * seconds it read almost all of them.
 */
const PROBE_TIMEOUT_MS = 45_000;

interface Args {
    limit: number;
    municipality: string | null;
    refresh: boolean;
    dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
    const args: Args = { limit: 5000, municipality: null, refresh: false, dryRun: false };

    for (let i = 0; i < argv.length; i += 1) {
        const flag = argv[i];
        if (flag === "--limit" && argv[i + 1]) {
            args.limit = Number(argv[i + 1]);
            if (!Number.isInteger(args.limit) || args.limit <= 0) {
                throw new Error(`--limit needs a whole number, got '${argv[i + 1]}'.`);
            }
            i += 1;
        } else if (flag === "--municipality" && argv[i + 1]) {
            args.municipality = argv[i + 1];
            i += 1;
        } else if (flag === "--refresh") {
            args.refresh = true;
        } else if (flag === "--dry-run") {
            args.dryRun = true;
        } else {
            throw new Error(`Unknown argument '${flag}'.`);
        }
    }
    return args;
}

/** Documents that still need a count, oldest first within each page-count band. */
async function findUnmeasured(args: Args) {
    const documents = await prisma.document.findMany({
        where: {
            ...(args.municipality ? { policyEntity: { municipalityCode: args.municipality } } : {}),
            ...(args.refresh ? {} : { metadata: { equals: Prisma.DbNull } }),
        },
        select: { id: true, originalUrl: true, fileName: true },
        orderBy: { createdAt: "asc" },
        take: args.limit,
    });
    return documents;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    const documents = await findUnmeasured(args);
    if (documents.length === 0) {
        console.log("[ocr:pages] Nothing to probe. Every document already has a page count.");
        return;
    }

    const scope = args.municipality ?? "all municipalities";
    console.log(`[ocr:pages] Probing ${documents.length} document(s) for ${scope}...`);
    if (args.dryRun) {
        console.log("[ocr:pages] Dry run. Nothing will be written.");
    }

    let measured = 0;
    let unreachable = 0;
    let written = 0;
    const pages: number[] = [];

    // A hand-rolled pool rather than a dependency: the work is one network round
    // trip per document, so this is I/O bound and a promise library would only add
    // something to maintain. Each worker drains the whole queue before returning --
    // a pool that runs one document per worker would only ever probe CONCURRENCY
    // documents in total, no matter how many were asked for.
    const queue = [...documents];
    let done = 0;

    async function drainQueue(): Promise<void> {
        while (queue.length > 0) {
            const document = queue.shift();
            if (!document) return;

            try {
                const metadata = await probePdfMetadata(document.originalUrl, {
                    timeoutMs: PROBE_TIMEOUT_MS,
                });

                if (metadata.pageCount === null) {
                    unreachable += 1;
                } else {
                    measured += 1;
                    pages.push(metadata.pageCount);
                }

                if (!args.dryRun) {
                    await prisma.document.update({
                        where: { id: document.id },
                        data: { metadata },
                    });
                    written += 1;
                }
            } catch {
                // One portal answering badly must not end the run. Record it as
                // unreadable so the next run skips it instead of retrying forever.
                unreachable += 1;
                if (!args.dryRun) {
                    await prisma.document
                        .update({
                            where: { id: document.id },
                            data: {
                                metadata: {
                                    pageCount: null,
                                    fileSizeBytes: null,
                                    probedAt: new Date().toISOString(),
                                },
                            },
                        })
                        .catch(() => undefined);
                }
            }

            done += 1;
            if (done % 100 === 0 || done === documents.length) {
                console.log(
                    `[ocr:pages]   ${done}/${documents.length} probed ` +
                        `(${measured} measured, ${unreachable} not readable)`,
                );
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(CONCURRENCY, documents.length) }, () => drainQueue()),
    );

    console.log("");
    console.log(`[ocr:pages] ${args.dryRun ? "Would write" : "Wrote"} ${written} row(s).`);
    console.log(`[ocr:pages] ${measured} document(s) have a page count.`);

    if (pages.length > 0) {
        pages.sort((a, b) => a - b);
        const median = pages[Math.floor(pages.length / 2)];
        const p90 = pages[Math.floor(pages.length * 0.9)];
        const underTen = pages.filter((n) => n <= 10).length;
        console.log(
            `[ocr:pages] Median ${median} pages, 90th percentile ${p90} pages, ` +
                `longest ${pages[pages.length - 1]} pages.`,
        );
        console.log(
            `[ocr:pages] ${underTen}/${pages.length} are 10 pages or fewer, ` +
                `which is where shortest-document-first ordering pays off most.`,
        );
    }

    if (unreachable > 0) {
        console.log(
            `[ocr:pages] ${unreachable} document(s) could not be read. They stay unordered; ` +
                `npm run ocr:sweep -- unreachable finds the ones whose host is gone.`,
        );
    }
}

main()
    .then(() => prisma.$disconnect())
    .catch(async (error) => {
        console.error(`[ocr:pages] failed: ${(error as Error).message}`);
        await prisma.$disconnect();
        process.exit(1);
    });
