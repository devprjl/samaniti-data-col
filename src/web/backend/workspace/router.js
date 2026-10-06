import express from "express";
import path from "node:path";
import {
    getAllRouteDescriptors,
    getAvailableScrapers,
    getProjectRoot,
    getRouteDescriptors,
    getTargetIdentity,
    matchTargets,
    runScraperTarget,
} from "../../../core/scraper/registry.js";
import { matchesRouteName } from "../../../core/scraper/route-selection.js";
import {
    PAGINATION_ENV_VAR,
    parseBooleanFlag,
    resolvePaginationSetting,
} from "../../../core/scraper/settings.js";
import { prisma as scraperPrisma } from "../../../core/db/loader.js";
import { captureConsoleLogs } from "./console-capture.js";
import { appendLog, createJob, finishJob, getActiveJob, getJob, listJobs } from "./job-store.js";

// Crawlee keeps request-queue state in ./storage relative to the working
// directory. The API is started from the backend workspace, so point it at the
// repository's own storage/ directory instead of creating a second one.
if (!process.env.CRAWLEE_STORAGE_DIR) {
    process.env.CRAWLEE_STORAGE_DIR = path.join(getProjectRoot(), "storage");
}

/**
 * Scraper workspace API.
 *
 * Four responsibilities, all read from the repository at request time:
 *   1. expose the route configurations declared in each `extract.ts`
 *   2. start a scraper run for a single route (or a whole municipality)
 *   3. report the progress and outcome of those runs
 *   4. report the OCR backlog and push a chosen number of documents onto the
 *      Redis job queue the OCR worker consumes
 *
 * There is deliberately no endpoint here for persisting selectors or review
 * findings: selectors live in code, and discrepancies are tracked outside this
 * service.
 *
 * @param prisma - the API's own Prisma client, used for read-only lookups
 */
export function createWorkspaceRouter(prisma) {
    const router = express.Router();

    const asyncRoute = (handler) => (req, res, next) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };

    function summarizeJob(job) {
        if (!job) return null;
        const { logs, ...rest } = job;
        return { ...rest, logCount: logs.length };
    }

    function buildRecentRuns() {
        const recent = {};
        for (const job of listJobs()) {
            if (!recent[job.key]) recent[job.key] = summarizeJob(job);
        }
        return recent;
    }

    /**
     * Joins every scraper target with its municipality row, so the UI can list the
     * records already collected for it. A target whose scraper has never run has no
     * row yet and is reported as `municipalityId: null` instead of guessing.
     */
    async function buildTargets() {
        const targets = getAvailableScrapers();

        const [municipalities, identities, routes] = await Promise.all([
            prisma.municipality.findMany({
                select: { id: true, code: true, nameEn: true, nameNe: true },
            }),
            Promise.all(targets.map((target) => getTargetIdentity(target))),
            getAllRouteDescriptors(),
        ]);

        const municipalityByCode = new Map(
            municipalities.map((municipality) => [
                String(municipality.code).toLowerCase(),
                municipality,
            ]),
        );

        const routeCountByTarget = new Map();
        for (const route of routes) {
            routeCountByTarget.set(
                route.targetKey,
                (routeCountByTarget.get(route.targetKey) ?? 0) + 1,
            );
        }

        return {
            routes,
            targets: targets.map((target, index) => {
                const identity = identities[index];
                const municipality = identity.municipalityCode
                    ? municipalityByCode.get(String(identity.municipalityCode).toLowerCase())
                    : null;

                return {
                    key: target.key,
                    province: target.province,
                    municipality: target.municipality,
                    cleanMun: target.cleanMun,
                    municipalityCode: identity.municipalityCode,
                    municipalityId: municipality?.id ?? null,
                    municipalityName:
                        identity.municipalityName ||
                        municipality?.nameEn ||
                        municipality?.nameNe ||
                        null,
                    routeCount: routeCountByTarget.get(target.key) ?? 0,
                    runnable: Boolean(target.indexPath),
                };
            }),
        };
    }

    router.get(
        "/routes",
        asyncRoute(async (_req, res) => {
            const { targets, routes } = await buildTargets();

            res.json({
                targets,
                routes,
                environment: {
                    pagination: resolvePaginationSetting(),
                    paginationEnvVar: PAGINATION_ENV_VAR,
                },
                recentRuns: buildRecentRuns(),
                running: summarizeJob(getActiveJob()),
            });
        }),
    );

    router.post(
        "/runs",
        asyncRoute(async (req, res) => {
            const active = getActiveJob();
            if (active) {
                return res.status(409).json({
                    error: `A run is already in progress (${active.key}). Wait for it to finish or reload this page.`,
                    running: summarizeJob(active),
                });
            }

            const requestedKey = String(req.body?.key ?? "").trim();
            if (!requestedKey) {
                return res.status(400).json({
                    error: "Provide a target key, e.g. lumbini:sainamaina:budget-program.",
                });
            }

            const match = matchTargets(requestedKey);
            if (match.error || match.targets.length === 0) {
                return res
                    .status(404)
                    .json({ error: match.error ?? `No scraper for '${requestedKey}'.` });
            }

            if (match.scope === "province" || match.scope === "all") {
                return res.status(400).json({
                    error: "Runs are limited to a single municipality or route. Pick one from the list, or use the <province>:<municipality>:<route> key.",
                });
            }

            const target = match.targets[0];
            const routeName = match.routeName;

            let routes = [];
            try {
                routes = await getRouteDescriptors(target);
            } catch (error) {
                return res
                    .status(500)
                    .json({ error: `Could not read route configurations: ${error.message}` });
            }

            if (routeName) {
                const matched = routes.filter((route) =>
                    matchesRouteName(route.extraction, routeName),
                );
                if (matched.length === 0) {
                    return res.status(404).json({
                        error: `Route '${routeName}' is not configured for ${target.key}.`,
                        availableRoutes: [...new Set(routes.map((route) => route.routeName))],
                    });
                }
            }

            const paginationOverride = parseBooleanFlag(req.body?.pagination);
            const hasPaginationOverride = typeof paginationOverride === "boolean";
            const pagination = resolvePaginationSetting(
                hasPaginationOverride ? { pagination: paginationOverride } : undefined,
            );

            const runConfig = {};
            if (routeName) runConfig.routeNames = [routeName];
            if (hasPaginationOverride) runConfig.pagination = paginationOverride;

            const job = createJob({
                key: routeName ? `${target.key}:${routeName}` : target.key,
                targetKey: target.key,
                routeName: routeName ?? null,
                label: target.key,
                pagination,
            });

            console.log(`[workspace] Run requested for '${job.key}' (${pagination.label}).`);

            // The run continues in the background; the UI polls this job for progress.
            (async () => {
                const restoreConsoleLogs = captureConsoleLogs((stream, message) =>
                    appendLog(job, stream, message),
                );

                try {
                    const summary = await runScraperTarget(
                        target,
                        Object.keys(runConfig).length > 0 ? runConfig : undefined,
                    );
                    appendLog(job, "log", `[workspace] Run finished: ${summary.status}.`);
                    finishJob(job, { status: summary.status, result: summary });
                } catch (error) {
                    const summary = error?.summary ?? null;
                    appendLog(job, "error", `[workspace] Run failed: ${error?.message ?? error}`);
                    finishJob(job, {
                        status: "failed",
                        result: summary,
                        error: error?.message ?? String(error),
                    });
                } finally {
                    restoreConsoleLogs();
                    await scraperPrisma.$disconnect().catch(() => {});
                }
            })();

            return res.status(202).json({ job: summarizeJob(job) });
        }),
    );

    router.get(
        "/runs",
        asyncRoute(async (_req, res) => {
            res.json({ jobs: listJobs().map(summarizeJob) });
        }),
    );

    router.get(
        "/runs/:id",
        asyncRoute(async (req, res) => {
            const job = getJob(req.params.id);
            if (!job) {
                return res.status(404).json({ error: "Unknown run." });
            }
            return res.json({ job });
        }),
    );

    /**
     * Document counts per OCR status, and the same pending counts broken down by
     * municipality so the workspace can offer a scope filter.
     *
     * Rebuilt on every read rather than cached: it is two aggregate queries, and a
     * stale number is worse than a slightly slower page on a page whose whole job
     * is telling the operator how much work is left.
     */
    async function buildOcrSnapshot() {
        const groups = await prisma.document.groupBy({
            by: ["ocrStatus"],
            _count: { _all: true },
        });
        const counts = {
            pending: 0,
            queued: 0,
            processing: 0,
            completed: 0,
            failed: 0,
            skipped: 0,
        };
        for (const group of groups) {
            if (group.ocrStatus in counts) {
                counts[group.ocrStatus] = group._count._all;
            }
        }

        // Postgres counts come back as BigInt, which does not survive JSON.
        const byMunicipality = await prisma.$queryRaw`
            SELECT m.code,
                   COALESCE(NULLIF(m.name_en, ''), NULLIF(m.name_ne, ''), m.code) AS name,
                   m.province,
                   COUNT(*) FILTER (WHERE d.ocr_status = 'pending') AS pending,
                   COUNT(*) AS total
            FROM documents d
            JOIN policy_entities pe ON pe.id = d.policy_entity_id
            JOIN municipalities m ON m.id = pe.municipality_id
            GROUP BY m.code, m.name_en, m.name_ne, m.province
            ORDER BY pending DESC, name ASC
        `;

        // Documents that were stored without a record to hang them off cannot be
        // attributed to a municipality, so they are reported on their own rather
        // than silently missing from the per-municipity breakdown.
        const linked = byMunicipality.reduce((total, row) => total + Number(row.total ?? 0), 0);
        const tracked = Object.values(counts).reduce((total, value) => total + value, 0);

        return {
            counts,
            total: tracked,
            unlinked: Math.max(0, tracked - linked),
            municipalities: byMunicipality.map((row) => ({
                code: row.code,
                name: row.name,
                province: row.province,
                pending: Number(row.pending ?? 0),
                total: Number(row.total ?? 0),
            })),
        };
    }

    router.get(
        "/ocr/status",
        asyncRoute(async (_req, res) => {
            const snapshot = await buildOcrSnapshot();
            const { OCR_QUEUE_NAME, getOcrQueueLength } =
                await import("../../../core/queue/ocr-producer.js");

            // `queueLength` is `null` rather than `0` when Redis is unreachable,
            // because "the queue is empty" and "we could not ask" are very
            // different things to an operator deciding whether to enqueue work.
            res.json({
                ...snapshot,
                queueName: OCR_QUEUE_NAME,
                queueLength: await getOcrQueueLength(),
            });
        }),
    );

    /**
     * The documents an enqueue would take, so they can be opened and judged first.
     *
     * Read-only: it claims nothing, so the list is a preview of the queue order
     * rather than a reservation. It answers with `total` alongside the rows so the
     * UI can say "first 50 of 3,476" instead of implying the scope is only 50
     * documents long.
     */
    router.get(
        "/ocr/documents",
        asyncRoute(async (req, res) => {
            const { OCR_ENQUEUE_MAX, countEligibleDocuments, peekEligibleDocuments } =
                await import("../../../core/queue/ocr-producer.js");

            const municipalityCode = req.query.municipalityCode
                ? String(req.query.municipalityCode)
                : undefined;
            const requested = Number(req.query.limit ?? 50);
            const limit = Number.isFinite(requested)
                ? Math.min(Math.max(1, Math.trunc(requested)), OCR_ENQUEUE_MAX)
                : 50;

            const [documents, total] = await Promise.all([
                peekEligibleDocuments({ limit, municipalityCode }),
                countEligibleDocuments({ municipalityCode }),
            ]);

            res.json({
                documents: documents.map((doc) => ({
                    id: doc.id,
                    fileName: doc.file_name,
                    fileType: doc.file_type,
                    originalUrl: doc.original_url,
                    // A local copy is served by the API and the portal has no way to
                    // know where on disk it is, so the UI is told only whether one
                    // exists and offered the download route instead.
                    hasLocalCopy: Boolean(doc.storage_path),
                    ocrStatus: doc.ocr_status,
                    createdAt: doc.created_at,
                })),
                total,
                shown: documents.length,
                scope: municipalityCode ?? "all municipalities",
            });
        }),
    );

    /**
     * Queues documents for OCR, either a fixed number or the whole backlog.
     *
     * `all: true` clears everything still eligible, which is why the response
     * carries a fresh snapshot: after a batch that large the numbers the operator
     * was looking at are the ones most worth re-reading. It also echoes the exact
     * documents that were queued, so a batch can be audited without trusting a
     * separate read that might have moved underneath it.
     */
    router.post(
        "/ocr/enqueue",
        asyncRoute(async (req, res) => {
            const { OCR_ENQUEUE_MAX, OCR_QUEUE_NAME, enqueuePendingDocuments, getOcrQueueLength } =
                await import("../../../core/queue/ocr-producer.js");

            const municipalityCode = req.body?.municipalityCode
                ? String(req.body.municipalityCode)
                : undefined;
            const enqueueAll = req.body?.all === true;

            // `all` clears the whole eligible backlog; otherwise the batch size is
            // read and clamped. A limit that is not a number is refused rather than
            // coerced, because a silent NaN reaching the SQL is worse than a 400.
            let limit = null;
            if (!enqueueAll) {
                const requested = Number(req.body?.limit ?? 50);
                if (!Number.isFinite(requested)) {
                    return res.status(400).json({
                        error: "Provide a whole number of documents to enqueue, e.g. 50.",
                    });
                }
                limit = Math.min(Math.max(1, Math.trunc(requested)), OCR_ENQUEUE_MAX);
            }

            const { count: enqueuedCount, documents } = await enqueuePendingDocuments({
                limit,
                municipalityCode,
            });
            const snapshot = await buildOcrSnapshot();

            console.log(
                `[workspace] Queued ${enqueuedCount} OCR job(s) onto ${OCR_QUEUE_NAME}` +
                    `${municipalityCode ? ` for ${municipalityCode}` : ""}` +
                    `${enqueueAll ? " (entire backlog)" : ` (limit ${limit})`}.`,
            );

            res.json({
                success: true,
                enqueuedCount,
                documents: documents.map((doc) => ({
                    id: doc.id,
                    fileName: doc.file_name,
                    originalUrl: doc.original_url,
                    hasLocalCopy: Boolean(doc.storage_path),
                    previousStatus: doc.ocr_status,
                })),
                requested: enqueueAll ? "all" : limit,
                enqueueAll,
                scope: municipalityCode ?? "all municipalities",
                queueName: OCR_QUEUE_NAME,
                queueLength: await getOcrQueueLength(),
                ...snapshot,
            });
        }),
    );

    return router;
}
