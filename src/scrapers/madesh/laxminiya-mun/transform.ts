import * as cheerio from "cheerio";
import {
    DocumentData,
    EtlPayload,
    MunicipalityData,
    PolicyEntityData,
} from "../../../core/types/domain.js";
import { ScrapedPage } from "../../../core/contracts/scraper.interface.js";
import {
    parseNepaliFiscalYear,
    extractTitle,
    extractDocumentLinks,
    extractDate,
    extractFiscalYear,
} from "../../../core/utils/index.js";
import { executeTransform } from "../../../core/constants/transformers.js";

export const MUNICIPALITY_CODE = "LAKSHMINIYA";

export const MUNICIPALITY_METADATA: MunicipalityData = {
    code: MUNICIPALITY_CODE,
    nameNe: "लक्ष्मीनिया गाउँपालिका",
    nameEn: "Lakshminiya Rural Municipality",
    province: "Madhesh",
    district: "Dhanusha",
};

// ---------------------------------------------------------------------------
// Shared transformers for listing rows
// ---------------------------------------------------------------------------

/**
 * Transforms a single row from a listing page into a PolicyEntity record.
 */
async function transformProjectRow(
    $: cheerio.CheerioAPI,
    row: cheerio.Cheerio<cheerio.Element>,
    baseUrl: string,
    category: string,
): Promise<PolicyEntityData> {
    const titleAnchor = row.find(".views-field-title a, h2 a").first();
    const titleNe = titleAnchor.text().trim().replace(/\s+/g, " ") || "";
    const rawHref = titleAnchor.attr("href") || "";

    let sourceUrl = "";
    if (rawHref) {
        try {
            sourceUrl = decodeURIComponent(new URL(rawHref, baseUrl).href);
        } catch {
            sourceUrl = rawHref;
        }
    }

    const fiscalYearAnchor = row.find(".views-field-field-fiscal-year a");
    const fiscalYearCellText = fiscalYearAnchor.text().trim();
    const fiscalYear = fiscalYearCellText || parseNepaliFiscalYear(titleNe) || null;

    const createdTd = row.find(".views-field-created");
    const dateCreated = createdTd.text().trim() || null;
    const rawFiscalYearHref = fiscalYearAnchor.attr("href") || "";

    let fiscalYearUrl: string | null = null;
    if (rawFiscalYearHref) {
        try {
            fiscalYearUrl = new URL(rawFiscalYearHref, baseUrl).href;
        } catch {
            fiscalYearUrl = rawFiscalYearHref;
        }
    }

    const documents: DocumentData[] = extractDocumentLinks($, baseUrl, row);

    return {
        municipalityCode: MUNICIPALITY_CODE,
        category: "project",
        titleNe,
        titleEn: null,
        budgetAmount: null,
        fiscalYear,
        status: "",
        wardNo: null,
        type: category || null,
        sourceUrl,
        documents,
        metadata: {
            dateCreated,
            fiscalYear,
            fiscalYearUrl,
        },
    };
}

/**
 * Transforms a single row from a listing page into a PolicyEntity record (Report).
 */
async function transformReportRow(
    $: cheerio.CheerioAPI,
    row: cheerio.Cheerio<cheerio.Element>,
    baseUrl: string,
    category: string,
): Promise<PolicyEntityData> {
    const titleAnchor = row.find(".views-field-title a, h2 a").first();
    const titleNe = titleAnchor.text().trim().replace(/\s+/g, " ") || "";
    const rawHref = titleAnchor.attr("href") || "";

    let sourceUrl = "";
    if (rawHref) {
        try {
            sourceUrl = decodeURIComponent(new URL(rawHref, baseUrl).href);
        } catch {
            sourceUrl = rawHref;
        }
    }

    const fiscalYearAnchor = row.find(".views-field-field-fiscal-year a");
    const fiscalYearCellText = fiscalYearAnchor.text().trim();
    const fiscalYear = fiscalYearCellText || parseNepaliFiscalYear(titleNe) || null;

    const dateCreatedRaw =
        row.find(".views-field-created .field-content").text().trim() ||
        row
            .find(".views-field-created")
            .text()
            .replace(/^Post date\s*/i, "")
            .trim();
    const dateCreated = dateCreatedRaw || null;

    const documents: DocumentData[] = extractDocumentLinks($, baseUrl, row);

    return {
        municipalityCode: MUNICIPALITY_CODE,
        category: "report",
        titleNe,
        titleEn: null,
        fiscalYear,
        type: category || null,
        sourceUrl,
        documents,
        publishedDate: dateCreated,
    };
}

/**
 * Transforms a single row from a listing page into a PolicyEntity record (Notice).
 */
async function transformNoticeRow(
    $: cheerio.CheerioAPI,
    row: cheerio.Cheerio<any>,
    baseUrl: string,
    category: string,
): Promise<PolicyEntityData> {
    const titleAnchor = row.find(".views-field-title a, h2 a, h2, td").first();
    const titleNe = titleAnchor.text().trim().replace(/\s+/g, " ") || "";
    const rawHref = titleAnchor.attr("href") || "";
    console.log(titleAnchor, titleNe, rawHref);

    let sourceUrl = "";
    if (rawHref) {
        try {
            sourceUrl = decodeURIComponent(new URL(rawHref, baseUrl).href);
        } catch {
            sourceUrl = rawHref;
        }
    }

    const fiscalYearAnchor = row.find(".views-field-field-fiscal-year a");
    const fiscalYearCellText = fiscalYearAnchor.text().trim();
    const fiscalYear = fiscalYearCellText || parseNepaliFiscalYear(titleNe) || null;

    const createdTd = row.find(".views-field-created");
    const dateCreated = createdTd.text().trim() || null;

    const documents: DocumentData[] = extractDocumentLinks($, baseUrl, row);

    return {
        municipalityCode: MUNICIPALITY_CODE,
        category: "notice",
        titleNe,
        titleEn: null,
        type: category || null,
        sourceUrl,
        documents,
        publishedDate: dateCreated,
        metadata: {
            fiscalYear,
        },
    };
}

// ---------------------------------------------------------------------------
// Detail page transformers
// ---------------------------------------------------------------------------

export async function transformProjectDetail(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;

    const $context = $(".field-items");

    const titleNe = extractTitle($);
    const documents = extractDocumentLinks($, baseUrl, $context);
    const publishedDate = extractDate($);
    const fiscalYear = extractFiscalYear($);

    console.log(`[Project Detail] "${titleNe}" | docs: ${documents.length} | url: ${page.url}`);

    return {
        policyEntities: [
            {
                municipalityCode: MUNICIPALITY_CODE,
                category: "project",
                titleNe,
                titleEn: null,
                budgetAmount: null,
                fiscalYear: fiscalYear,
                status: "",
                wardNo: null,
                sourceUrl: decodeURIComponent(page.url),
                documents,
                type: page.category,
                publishedDate,
            },
        ],
    };
}

async function transformReportDetail(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;

    const $context = $(".content");

    const titleNe = extractTitle($);
    const documents = extractDocumentLinks($, baseUrl, $context);
    const publishedDate = extractDate($);
    const fiscalYear = extractFiscalYear($);

    console.log(
        `[Report Detail] "${titleNe}" | date: ${publishedDate} | docs: ${documents.length} | url: ${page.url}`,
    );

    return {
        policyEntities: [
            {
                municipalityCode: MUNICIPALITY_CODE,
                category: "report",
                titleNe,
                titleEn: null,
                type: page.category,
                fiscalYear,
                publishedDate,
                sourceUrl: decodeURIComponent(page.url),
                documents,
            },
        ],
    };
}

async function transformNoticeDetail(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;
    const $context = $(".field-items");

    const titleNe = extractTitle($);
    const documents = extractDocumentLinks($, baseUrl, $context);
    const publishedDate = extractDate($);
    const fiscalYear = extractFiscalYear($);

    console.log(
        `[Notice Detail] "${titleNe}" | date: ${publishedDate} | docs: ${documents.length} | url: ${page.url}`,
    );

    return {
        policyEntities: [
            {
                municipalityCode: MUNICIPALITY_CODE,
                category: "notice",
                titleNe,
                titleEn: null,
                contentNe: null,
                fiscalYear,
                type: page.category,
                publishedDate,
                sourceUrl: decodeURIComponent(page.url),
                documents,
            },
        ],
    };
}

// ---------------------------------------------------------------------------
// Listing page transformers
// ---------------------------------------------------------------------------

async function transformProjectListing(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;
    const rows = $("table tbody tr").toArray();

    console.log(`[Project Listing] ${rows.length} row(s) found on ${page.url}`);

    const projects = await Promise.all(
        rows.map((row) => transformProjectRow($, $(row), baseUrl, page.category || "")),
    );

    return { policyEntities: projects };
}

async function transformReportListing(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;
    const rows = $(".view-content table tbody tr").toArray();

    console.log(`[Report Listing] ${rows.length} row(s) found on ${page.url}`);

    const reports = await Promise.all(
        rows.map((row) => transformReportRow($, $(row), baseUrl, page.category || "")),
    );

    return { policyEntities: reports };
}

async function transformNoticeListing(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;
    const rows = $("table tbody tr").toArray();

    console.log(`[Notice Listing] ${rows.length} row(s) found on ${page.url}`);

    const notices = await Promise.all(
        rows.map((row) => transformNoticeRow($, $(row), baseUrl, page.category || "")),
    );

    return { policyEntities: notices };
}

async function transformUnstructuredNotice(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;

    // FIXED: Target the views-row directly where each notice resides
    const rows = $(".view-documents .views-row").toArray();
    console.log(`[Unstructured Notice] \({rows.length} row(s) found on\){page.url}`);

    const notices = await Promise.all(
        rows.map(async (rowElement) => {
            const row = $(rowElement);
            const titleAnchor = row.find("h2 a, .field-name-title a").first();
            const titleNe = titleAnchor.text().trim().replace(/\s+/g, " ") || "";
            const rawHref = titleAnchor.attr("href") || row.find(".node").attr("about") || "";

            let sourceUrl = "";
            if (rawHref) {
                try {
                    sourceUrl = decodeURIComponent(new URL(rawHref, baseUrl).href);
                } catch {
                    sourceUrl = rawHref;
                }
            }

            const fiscalYearAnchor = row.find(
                ".field-name-field-fiscal-year a, .views-field-field-fiscal-year a",
            );
            const fiscalYearCellText = fiscalYearAnchor.text().trim();
            const fiscalYear = fiscalYearCellText || parseNepaliFiscalYear(titleNe) || null;

            const dateSpan = row
                .find(
                    ".meta.submitted span[property*='date'], .field-name-date, .views-field-created",
                )
                .first();
            const publishedDate =
                dateSpan.attr("content") ||
                dateSpan
                    .text()
                    .replace(/^Submitted on:\s*/i, "")
                    .trim() ||
                null;

            const docTypeAnchor = row.find(".field-name-field-doc-type a").first();
            const docType = docTypeAnchor.text().trim() || page.category || null;

            const documents: DocumentData[] = extractDocumentLinks($, baseUrl, row);

            return {
                municipalityCode: MUNICIPALITY_CODE,
                category: "notice",
                titleNe,
                titleEn: null,
                type: docType,
                sourceUrl: sourceUrl || decodeURIComponent(page.url),
                documents,
                publishedDate,
                metadata: {
                    fiscalYear,
                },
            };
        }),
    );

    return { policyEntities: notices };
}

// ---------------------------------------------------------------------------
// Main transform function - routes to correct handler based on routeType
// ---------------------------------------------------------------------------

const TRANSFORMERS: Record<string, (page: ScrapedPage) => Promise<Partial<EtlPayload>>> = {
    report: transformReportListing,
    reportDetail: transformReportDetail,

    project: transformProjectListing,
    projectDetail: transformProjectDetail,

    notice: transformNoticeListing,
    noticeDetail: transformNoticeDetail,

    unstructuredNotice: transformUnstructuredNotice,
};

export async function transform(pages: ScrapedPage[]): Promise<EtlPayload> {
    return executeTransform(pages, MUNICIPALITY_METADATA, TRANSFORMERS);
}
