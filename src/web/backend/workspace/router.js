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
 * Three responsibilities, all read from the repository at request time:
 *   1. expose the route configurations declared in each `extract.ts`
 *   2. start a scraper run for a single route (or a whole municipality)
 *   3. report the progress and outcome of those runs
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

    return router;
}
