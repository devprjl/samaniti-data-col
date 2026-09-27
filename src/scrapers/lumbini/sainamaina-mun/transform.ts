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
} from "../../../core/utils/index.js";
import { executeTransform } from "../../../core/constants/transformers.js";

export const MUNICIPALITY_CODE = "SAINAMAINA";

export const MUNICIPALITY_METADATA: MunicipalityData = {
    code: MUNICIPALITY_CODE,
    nameNe: "सैनामैना नगरपालिका",
    nameEn: "Sainamaina Municipality",
    province: "Lumbini",
    district: "Rupandehi",
};

// ---------------------------------------------------------------------------
// Shared transformers for listing rows
// ---------------------------------------------------------------------------

async function transformProjectRow(
    $: cheerio.CheerioAPI,
    row: cheerio.Cheerio<any>,
    baseUrl: string,
    category: string,
): Promise<PolicyEntityData> {
    const $titleLink = row.find("h2 a, .views-field-title a").first();
    const titleNe = $titleLink.text().trim().replace(/\s+/g, " ") || "";
    const rawHref = $titleLink.attr("href") || "";
    const sourceUrl = rawHref
        ? rawHref.startsWith("http")
            ? rawHref
            : `${baseUrl}${rawHref}`
        : "";

    const docElements = row.find(".file a, a[href$='.pdf']").toArray();
    const documents: DocumentData[] = [];
    for (const docEl of docElements) {
        const rawFileUrl = $(docEl).attr("href");
        if (!rawFileUrl || rawFileUrl.startsWith("data:")) continue;
        const fileUrl = rawFileUrl.startsWith("http") ? rawFileUrl : `${baseUrl}${rawFileUrl}`;
        documents.push(await buildDocument(fileUrl, baseUrl, titleNe, null));
    }

    if (documents.length === 0 && sourceUrl.endsWith(".pdf")) {
        documents.push(await buildDocument(sourceUrl, baseUrl, titleNe, null));
    }

    return {
        municipalityCode: MUNICIPALITY_CODE,
        category: "project",
        titleNe,
        titleEn: null,
        budgetAmount: null,
        fiscalYear: parseNepaliFiscalYear(titleNe) || null,
        status: "",
        wardNo: null,
        type: category,
        sourceUrl: decodeURIComponent(sourceUrl),
        documents,
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
    const $titleLink = row.find(".views-field-title a");
    const titleNe = $titleLink.text().trim() || "";
    const rawSourceUrl = $titleLink.attr("href") || "";
    const sourceUrl = rawSourceUrl.startsWith("http") ? rawSourceUrl : `${baseUrl}${rawSourceUrl}`;

    return {
        municipalityCode: MUNICIPALITY_CODE,
        category: "notice",
        titleNe,
        titleEn: null,
        contentNe: null,
        type: category,
        publishedDate: null,
        sourceUrl: decodeURIComponent(sourceUrl),
        documents: [],
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
