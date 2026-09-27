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
} from "../../../core/utils/index.js";
import { executeTransform } from "../../../core/constants/transformers.js";

export const MUNICIPALITY_CODE = "BARDAGHAT";

export const MUNICIPALITY_METADATA: MunicipalityData = {
    code: MUNICIPALITY_CODE,
    nameNe: "बर्दघाट नगरपालिका",
    nameEn: "Bardaghat Municipality",
    province: "Lumbini",
    district: "Nawalparasi",
};

// ---------------------------------------------------------------------------
// Shared transformers for listing rows
// ---------------------------------------------------------------------------

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

async function transformNoticeRow(
    $: cheerio.CheerioAPI,
    row: cheerio.Cheerio<any>,
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

async function transformProjectDetail(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;

    const titleNe = extractTitle($);
    const documents = extractDocumentLinks($, baseUrl);

    return {
        policyEntities: [
            {
                municipalityCode: MUNICIPALITY_CODE,
                category: "project",
                titleNe,
                titleEn: null,
                budgetAmount: null,
                fiscalYear: parseNepaliFiscalYear(titleNe) || null,
                status: "",
                wardNo: null,
                sourceUrl: decodeURIComponent(page.url),
                documents,
                type: page.category,
            },
        ],
    };
}

async function transformReportDetail(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;

    const titleNe = extractTitle($);
    const publishedDate = extractDate($);
    const documents = extractDocumentLinks($, baseUrl, $(".content .field-item"));

    return {
        policyEntities: [
            {
                municipalityCode: MUNICIPALITY_CODE,
                category: "report",
                titleNe,
                titleEn: null,
                type: page.category,
                fiscalYear: parseNepaliFiscalYear(titleNe) || null,
                publishedDate,
                sourceUrl: decodeURIComponent(page.url),
                documents,
            },
        ],
    };
}

async function transformNoticeDetail(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const titleNe = extractTitle($);
    const publishedDate = $(".meta.submitted span").attr("content") || null;
    const documents = extractDocumentLinks(
        $,
        new URL(page.url).origin,
        $(".content .field-item"),
    );

    return {
        policyEntities: [
            {
                municipalityCode: MUNICIPALITY_CODE,
                category: "notice",
                titleNe,
                titleEn: null,
                contentNe: null,
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
    const rows = $(".view-content table tbody tr").toArray();

    const projects = await Promise.all(
        rows.map((row) => transformProjectRow($, $(row), baseUrl, page.category || "")),
    );

    return { policyEntities: projects };
}

async function transformReportListing(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;
    const rows = $(".view-content .views-row").toArray();

    const reports = await Promise.all(
        rows.map((row) => transformReportRow($, $(row), baseUrl, page.category || "")),
    );

    return { policyEntities: reports };
}

async function transformNoticeListing(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;
    const rows = $(".view-content table tbody tr").toArray();

    const notices = await Promise.all(
        rows.map((row) => transformNoticeRow($, $(row), baseUrl, page.category || "")),
    );

    return { policyEntities: notices };
}

const TRANSFORMERS: Record<string, (page: ScrapedPage) => Promise<Partial<EtlPayload>>> = {
    report: transformReportListing,
    reportDetail: transformReportDetail,
    project: transformProjectListing,
    projectDetail: transformProjectDetail,
    notice: transformNoticeListing,
    noticeDetail: transformNoticeDetail,
};

export async function transform(pages: ScrapedPage[]): Promise<EtlPayload> {
    return executeTransform(pages, MUNICIPALITY_METADATA, TRANSFORMERS);
}
