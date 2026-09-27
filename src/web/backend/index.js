import "dotenv/config";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const backendDirectory = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(backendDirectory, "../../../.env") });

const app = express();
const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

app.use(cors());
app.use(express.json());

const municipalitySelect = {
    id: true,
    code: true,
    nameEn: true,
    nameNe: true,
    province: true,
    district: true,
};

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
            select: {
                id: true,
                municipalityId: true,
                category: true,
                titleNe: true,
                titleEn: true,
                contentNe: true,
                contentEn: true,
                type: true,
                fiscalYear: true,
                budgetAmount: true,
                status: true,
                wardNo: true,
                publishedDate: true,
                sourceUrl: true,
                metadata: true,
                createdAt: true,
                updatedAt: true,
                municipality: { select: municipalitySelect },
                documents: {
                    select: {
                        id: true,
                        fileName: true,
                        fileType: true,
                        originalUrl: true,
                        storagePath: true,
                        downloadStatus: true,
                        downloadError: true,
                        createdAt: true,
                    },
                    orderBy: { createdAt: "asc" },
                },
            },
        });

        res.json(policies);
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

app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: "Unable to complete the request" });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
});
