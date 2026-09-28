import "dotenv/config";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { municipalitySelect, policyListSelect, policySelect } from "./selects.js";

const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(backendDirectory, "../../../.env") });

/**
 * Whether this process is running on a serverless host.
 *
 * A serverless function has no repository checkout, no writable working directory
 * worth the name, and a per-invocation CPU budget, so it is never a place a
 * crawler should run. Vercel sets VERCEL at both build and runtime; AWS Lambda
 * sets its own pair. Nothing has to be configured for this to be true, which is
 * the point: it holds even on a host that never sets NODE_ENV, so a deployment
 * cannot expose a crawler just because someone forgot one variable.
 */
const runningOnServerlessHost =
    process.env.VERCEL === "1" ||
    Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME) ||
    Boolean(process.env.FUNCTION_TARGET);

/**
 * Whether the scraper workspace is served.
 *
 * Running a scrape is not a read operation: it spawns crawlers against live
 * government portals from this host's IP address, and the CLI will run one worker
 * per CPU core. A public instance must never expose it, so production refuses.
 *
 * NODE_ENV is the switch, and it is the only one a deployment has to think
 * about: set it to production and the workspace is unmounted, leave it and the
 * workspace is available to whoever reaches the port. That asymmetry is
 * deliberate. This is not a build-time switch and it does not change how the
 * portal is built, it is a runtime guard on a write operation, so the safe
 * direction is the one where forgetting it is loud rather than the one where
 * forgetting it is silent and public.
 *
 * The serverless check is the backstop for a host that leaves NODE_ENV unset.
 * Vercel does not set it for the runtime, so a deployment that sets nothing at
 * all would otherwise read as development.
 */
const scraperWorkspaceEnabled = process.env.NODE_ENV !== "production" && !runningOnServerlessHost;

const app = express();
const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

// Imported after the environment is loaded, and only when enabled: the workspace
// router pulls in the scraper pipeline, which opens its own Prisma client on
// import. Loading it in a read-only deployment would add a second database
// connection and the whole crawler stack for routes that cannot be called.
//
// A failure here is caught rather than allowed to escape. This runs at module
// scope, so an uncaught throw would kill the process before Express ever sees a
// request and turn an optional feature into a total outage: the registry throws
// when it cannot find src/scrapers, which is exactly what happens wherever the
// repository is not checked out. The workspace is optional, so losing it costs
// the two /api/workspace routes and nothing else.
let workspaceRouter = null;
if (scraperWorkspaceEnabled) {
    try {
        const { createWorkspaceRouter } = await import("./workspace/router.js");
        workspaceRouter = createWorkspaceRouter(prisma);
    } catch (error) {
        console.error("[backend] Scraper workspace failed to start; serving read-only.", error);
    }
} else {
    console.log("[backend] Scraper workspace disabled; /api/workspace will not be served.");
}

app.use(cors());
app.use(express.json());

const asyncRoute = (handler) => (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
};

// Get municipalities with lightweight record counts for the directory view.
app.get(
    "/api/municipalities",
    asyncRoute(async (_req, res) => {
        const municipalities = await prisma.municipality.findMany({
            orderBy: [{ province: "asc" }, { nameEn: "asc" }],
            include: {
                profile: true,
                _count: {
                    select: {
                        policyEntities: true,
                        scraperRuns: true,
                    },
                },
            },
        });

        res.json(municipalities);
    }),
);

// Get every policy entity in one response so the portal can browse and
// filter the complete collection without making a request per municipality.
// Bodies are omitted here; GET /api/policies/:id returns one complete record.
app.get(
    "/api/policies",
    asyncRoute(async (req, res) => {
        const where = {};

        if (req.query.municipalityId) {
            where.municipalityId = String(req.query.municipalityId);
        }

        if (req.query.category) {
            where.category = String(req.query.category);
        }

        const policies = await prisma.policyEntity.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: policyListSelect,
        });

        res.json(policies);
    }),
);

// One complete record, including the notice/report body, for the detail page.
app.get(
    "/api/policies/:id",
    asyncRoute(async (req, res) => {
        const policy = await prisma.policyEntity.findUnique({
            where: { id: String(req.params.id) },
            select: policySelect,
        });

        if (!policy) {
            return res.status(404).json({ error: "Policy record not found" });
        }

        return res.json(policy);
    }),
);

// Get every ScraperRun record, including the municipality it belongs to.
// Runs without a municipality (for example, a run created before lineage was
// linked) are retained and returned with a null municipality relationship.
app.get(
    "/api/scraper-runs",
    asyncRoute(async (_req, res) => {
        const scraperRuns = await prisma.scraperRun.findMany({
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            include: {
                municipality: { select: municipalitySelect },
            },
        });

        res.json(scraperRuns);
    }),
);

// Get municipality by id with policy entities and scraper runs.
app.get(
    "/api/municipalities/:id",
    asyncRoute(async (req, res) => {
        const municipality = await prisma.municipality.findUnique({
            where: { id: req.params.id },
            include: {
                profile: true,
                policyEntities: {
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                    include: { documents: true },
                },
                scraperRuns: {
                    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
                },
            },
        });

        if (!municipality) {
            return res.status(404).json({ error: "Municipality not found" });
        }

        // Backward compatibility mapping for existing clients.
        const responseData = {
            ...municipality,
            projects: municipality.policyEntities.filter((policy) => policy.category === "project"),
            notices: municipality.policyEntities.filter((policy) => policy.category === "notice"),
            reports: municipality.policyEntities.filter((policy) => policy.category === "report"),
        };

        return res.json(responseData);
    }),
);

// Document download / serve endpoint.
app.get(
    "/api/documents/:id/download",
    asyncRoute(async (req, res) => {
        const doc = await prisma.document.findUnique({
            where: { id: req.params.id },
        });

        if (!doc) {
            return res.status(404).json({ error: "Document not found" });
        }

        if (doc.storagePath && fs.existsSync(doc.storagePath)) {
            return res.download(doc.storagePath, doc.fileName);
        }

        if (doc.originalUrl) {
            return res.redirect(doc.originalUrl);
        }

        return res.status(404).json({ error: "File not available" });
    }),
);

app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
});

// Scraper workspace: route configuration inspector and one-click route execution.
// Not mounted at all when disabled, so POST /api/workspace/runs has no handler to
// reach on a production instance.
if (workspaceRouter) {
    app.use("/api/workspace", workspaceRouter);
} else {
    // 403 rather than 404: the route is not missing, it is refused on purpose, and
    // saying so is the whole point of a guard. A caller gets the reason without
    // having to infer it from a 404.
    //
    // The stable code is what the frontend branches on, so it can tell "this
    // deployment is read-only by design" apart from "the database is unreachable".
    // Both arrive as a failed request and a generic error message would blame the
    // wrong thing.
    app.use("/api/workspace", (_req, res) => {
        res.status(403).json({
            error: {
                code: "scraper_workspace_disabled",
                message:
                    "Forbidden: running scrapers is disabled in production. Scraping is a " +
                    "write operation against live government portals, so it only runs from a " +
                    "maintainer's machine, never from the deployed site.",
            },
        });
    });
}

app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "Unable to complete the request" });
});

const PORT = process.env.PORT || 5001;

/**
 * True only when this file is the process entry point.
 *
 * A serverless runtime imports the app and calls it as a request handler, and a
 * `listen` there would open a socket nothing ever accepts on, so the server is
 * started exclusively for `npm run web:backend:start` and `tsx index.js`.
 */
const isEntryPoint =
    Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
    app.listen(PORT, () => {
        console.log(`Backend running on port ${PORT}`);
    });
}

export { app };
export default app;
