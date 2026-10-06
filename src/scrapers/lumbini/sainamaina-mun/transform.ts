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

    // Scoped to this row, so documents belonging to other rows on the listing
    // page are not attributed to this one.
    const documents: DocumentData[] = extractDocumentLinks($, baseUrl, row);

    // A page that is itself the document. The scanner cannot find this one --
    // there is no link on the page pointing at the page -- so it is built directly.
    if (documents.length === 0 && sourceUrl.endsWith(".pdf")) {
        documents.push(buildDocument(sourceUrl, baseUrl));
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

    const sourceUrl = rawSourceUrl.startsWith("http") ? rawSourceUrl : `${baseUrl}${rawSourceUrl}`;

    // Scoped to the row. `.views-field-field-documents` is the view wrapper around
    // `.field-name-field-documents`, which the scanner already treats as a file
    // container, so this finds the same link the old selector did.
    const documents: DocumentData[] = extractDocumentLinks($, baseUrl, row);

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
