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
    buildDocument,
    extractDate,
} from "../../../core/utils/index.js";
import { executeTransform } from "../../../core/constants/transformers.js";

export const MUNICIPALITY_CODE = "KANCHAN";

export const MUNICIPALITY_METADATA: MunicipalityData = {
    code: MUNICIPALITY_CODE,
    nameNe: "कञ्चन गाउँपालिका",
    nameEn: "Kanchan Rural Municipality",
    province: "Lumbini",
    district: "Rupandehi",
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
        },
    };
}

async function transformReportRow(
    $: cheerio.CheerioAPI,
    row: cheerio.Cheerio<any>,
    baseUrl: string,
    category: string,
): Promise<PolicyEntityData> {
    const $titleLink = row.find(".views-field-title a");
    const titleNe = $titleLink.text().trim() || "";
    const rawSourceUrl = $titleLink.attr("href") || "";
    const publishedDate = row.find(".views-field-created .field-content").text().trim() || null;

    const rawFileUrl = row.find(".views-field-field-documents a").attr("href") || null;

    const sourceUrl = rawSourceUrl.startsWith("http") ? rawSourceUrl : `${baseUrl}${rawSourceUrl}`;

    const documents: DocumentData[] = [];
    if (rawFileUrl) {
        documents.push(await buildDocument(rawFileUrl, baseUrl, titleNe, publishedDate));
    }

    return {
        municipalityCode: MUNICIPALITY_CODE,
        category: "report",
        titleNe,
        titleEn: null,
        type: category,
        fiscalYear: parseNepaliFiscalYear(titleNe) || null,
        publishedDate,
        sourceUrl: decodeURIComponent(sourceUrl),
        documents,
    };
}

async function transformNoticeRow(
    $: cheerio.CheerioAPI,
    row: cheerio.Cheerio<any>,
    baseUrl: string,
    category: string,
): Promise<PolicyEntityData> {
    const titleEl = row.find("h2 a");
    const dateEl = row.find('.meta.submitted span[property="dc:date dc:created"]');
    const docEl = row.find(".field-name-field-documents a");

    const titleNe = titleEl.text().trim() || "";
    const rawLink = titleEl.attr("href") || "";
    const sourceUrl = rawLink
        ? rawLink.startsWith("http")
            ? rawLink
            : `${baseUrl}${rawLink}`
        : "";

    const publishedDate = dateEl.attr("content") || dateEl.text().trim() || null;

    const documents: DocumentData[] = [];
    const docHref = docEl.attr("href");
    if (docHref) {
        const fullDocUrl = docHref.startsWith("http") ? docHref : `${baseUrl}${docHref}`;
        documents.push(
            await buildDocument(fullDocUrl, baseUrl, docEl.text().trim() || titleNe, publishedDate),
        );
    }

    return {
        municipalityCode: MUNICIPALITY_CODE,
        category: "notice",
        titleNe,
        titleEn: null,
        type: category,
        publishedDate,
        sourceUrl: decodeURIComponent(sourceUrl),
        documents,
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
    const documents = extractDocumentLinks($, baseUrl);

    return {
        policyEntities: [
            {
                municipalityCode: MUNICIPALITY_CODE,
                category: "report",
                titleNe,
                titleEn: null,
                type: page.category,
                fiscalYear: parseNepaliFiscalYear(titleNe) || null,
                publishedDate: null,
                sourceUrl: decodeURIComponent(page.url),
                documents,
            },
        ],
    };
}

async function transformNoticeDetail(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const titleNe = extractTitle($);
    const documents = extractDocumentLinks($, new URL(page.url).origin);

    return {
        policyEntities: [
            {
                municipalityCode: MUNICIPALITY_CODE,
                category: "notice",
                titleNe,
                titleEn: null,
                contentNe: $(".node-content, .content").text().trim() || null,
                type: page.category,
                publishedDate: null,
                sourceUrl: decodeURIComponent(page.url),
                documents,
            },
        ],
    };
}

async function transformProjectListing(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;
    const rows = $(".views-row").toArray();

    const projects = await Promise.all(
        rows.map((row) => transformProjectRow($, $(row), baseUrl, page.category || "")),
    );

    return { policyEntities: projects };
}

async function transformReportListing(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;
    const rows = $(".views-row").toArray();

    const reports = await Promise.all(
        rows.map((row) => transformReportRow($, $(row), baseUrl, page.category || "")),
    );

    return { policyEntities: reports };
}

async function transformNoticeListing(page: ScrapedPage): Promise<Partial<EtlPayload>> {
    const $ = cheerio.load(page.html);
    const baseUrl = new URL(page.url).origin;
    const rows = $(".views-row").toArray();

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
