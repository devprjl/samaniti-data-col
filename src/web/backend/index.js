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
 * Whether the scraper workspace is served.
 *
 * Running a scrape is not a read operation: it spawns crawlers against live
 * government portals from this host's IP address, and the CLI will run one worker
 * per CPU core. A publicly deployed instance must never expose it.
 *
 * So this is strictly opt-in, and production is a second, independent barrier.
 * Anything that is not an explicit SCRAPER_WORKSPACE_ENABLED=true leaves the run
 * endpoint unmounted, which is the state a deployment that configures nothing ends
 * up in. A deployment that also reports NODE_ENV=production cannot be talked out of
 * it even if a .env carrying the opt-in is shipped alongside.
 *
 * Both conditions are needed. Opt-in alone is undone by a .env that leaks into a
 * build; NODE_ENV alone is undone by a host that does not set one. Two independent
 * barriers, and neither is load-bearing on its own.
 */
const scraperWorkspaceEnabled =
    process.env.SCRAPER_WORKSPACE_ENABLED === "true" && process.env.NODE_ENV !== "production";

const app = express();
const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

// Imported after the environment is loaded, and only when enabled: the workspace
// router pulls in the scraper pipeline, which opens its own Prisma client on
// import. Loading it in a read-only deployment would add a second database
// connection and the whole crawler stack for routes that cannot be called.
let workspaceRouter = null;
if (scraperWorkspaceEnabled) {
    const { createWorkspaceRouter } = await import("./workspace/router.js");
    workspaceRouter = createWorkspaceRouter(prisma);
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
// Not mounted at all when disabled, so POST /api/workspace/runs cannot be called
// on a read-only deployment.
if (workspaceRouter) {
    app.use("/api/workspace", workspaceRouter);
} else {
    app.use("/api/workspace", (_req, res) => {
        res.status(404).json({ error: "The scraper workspace is disabled on this instance." });
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
