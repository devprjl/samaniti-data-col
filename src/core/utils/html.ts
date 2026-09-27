import { load as cheerioLoad, CheerioAPI, Cheerio, Element } from "cheerio";
import { chromium } from "playwright";
import { DocumentData } from "../types/domain.js";

/**
 * Scopes a full page HTML string down to the inner HTML of the first element
 * matching `selector`. If the selector matches nothing, returns the full body HTML.
 */
export function scopeHtml(fullHtml: string, selector: string): string {
    const $ = cheerioLoad(fullHtml);
    const el = $(selector);
    if (!el.length) {
        console.warn(
            `[scopeHtml] Selector "${selector}" matched nothing — falling back to full body.`,
        );
        return $("body").length ? $.html($("body")) : fullHtml;
    }
    return $.html(el) ?? fullHtml;
}

/**
 * Extracts all absolute hrefs from an HTML string using a selector.
 */
export function extractLinksFromHtml(html: string, selector: string, baseUrl: string): string[] {
    const $ = cheerioLoad(html);
    const links: string[] = [];
    $(selector).each((_, el) => {
        const href = $(el).attr("href");
        if (!href) return;
        // Trim whitespace/newlines — some themes (e.g. NEB) embed newlines inside href values
        const trimmed = href.trim();
        if (!trimmed) return;
        const absolute = trimmed.startsWith("http") ? trimmed : `${baseUrl}${trimmed}`;
        links.push(absolute);
    });
    return links;
}

/**
 * Converts Nepali Devanagari numerals (०-९) to English numerals (0-9).
 */
function convertNepaliToEnglishDigits(str: string): string {
    const nepaliDigits = ["०", "१", "२", "३", "४", "५", "६", "७", "८", "९"];
    return str.replace(/[०-९]/g, (digit) => nepaliDigits.indexOf(digit).toString());
}

/**
 * Extracts and standardizes fiscal years from Drupal taxonomy fields or raw text.
 * Converts input like "०७८/७९" or "२०७८/७९" -> "2078/79".
 */
export function extractFiscalYear($: CheerioAPI): string | null {
    // 1. Target Drupal fiscal year taxonomy container or general fiscal year fields
    const rawText =
        $(".field-name-field-fiscal-year .links, .field-name-field-fiscal-year .field-items")
            .text()
            .trim() ||
        $(".field-name-field-fiscal-year").text().trim() ||
        "";

    if (!rawText) return null;

    // Convert any Devanagari digits to English
    const convertedText = convertNepaliToEnglishDigits(rawText);

    // Match 2-digit or 4-digit year format (e.g., "078/79" or "2078/79")
    const match = convertedText.match(/(\d{2,4})\s*[\/\-]\s*(\d{2})/);
    if (!match) return null;

    const [, rawStartYear, endYear] = match;

    // Normalize startYear without mutating raw destructuring variables
    let startYear = rawStartYear;
    if (startYear.length === 2) {
        startYear = `20${startYear}`;
    } else if (startYear.length === 3) {
        startYear = `2${startYear}`;
    }

    return `${startYear}/${endYear}`;
}

export function extractDate($: CheerioAPI): string {
    return (
        // 1. ISO timestamp directly from the content attribute of the span
        $('span[property="dc:date dc:created"]').attr("content")?.trim() ||
        $('meta[property="dc:date"]').attr("content")?.trim() ||
        $('meta[property="article:published_time"]').attr("content")?.trim() ||
        // 2. Fallback to visible text inside the span (e.g. "Fri, 07/22/2022 - 22:39")
        $('span[property="dc:date dc:created"]').text().trim() ||
        // 3. Drupal views table cell fallback
        $(".views-field-created").text().replace(/\s+/g, " ").trim() ||
        // 4. Custom theme date container
        $(".meta.date").text().replace(/\s+/g, " ").trim() ||
        // 5. Container string cleanup (strips "Submitted on:")
        $(".meta.submitted")
            .text()
            .replace(/^Submitted on:\s*/i, "")
            .replace(/\s+/g, " ")
            .trim() ||
        $("time").attr("datetime")?.trim() ||
        $("time").text().trim() ||
        ""
    );
}

/**
 * Checks if a page contains a views table (listing) or a detail view.
 */
export function isListView(html: string): boolean {
    const $ = cheerioLoad(html);
    return $(".views-row").length > 0;
}

/**
 * Extracts the title from HTML, trying multiple selectors in order of preference.
 */
export function extractTitle($: CheerioAPI): string {
    return (
        $('span[property="dc:title"]').attr("content")?.trim() ||
        $("#page-title").text().trim() ||
        $(".news__title").text().trim() ||
        $(".section-title").text().trim() ||
        $(".node-title").text().trim() ||
        $("h1").text().trim() ||
        ""
    );
}

/**
 * Normalizes Drupal/CMS styled image and thumbnail URLs to their original,
 * uncompressed full-resolution source URLs for high-quality OCR processing.
 *
 * Example:
 *   "https://bardaghatmun.gov.np/sites/bardaghatmun.gov.np/files/styles/thumbnail/public/field/image/Screenshot.png?itok=NZZ6oq5X"
 * becomes:
 *   "https://bardaghatmun.gov.np/sites/bardaghatmun.gov.np/files/field/image/Screenshot.png"
 */
export function normalizeOriginalImageUrl(url: string): string {
    // 1. Remove Drupal image style path segment: /styles/{style_name}/(public|private)/
    let unstyled = url.replace(/\/styles\/[^/]+\/(public|private)\//, "/");

    // 2. Strip Drupal itok query parameter while preserving other params if any
    try {
        const parsed = new URL(unstyled);
        if (parsed.searchParams.has("itok")) {
            parsed.searchParams.delete("itok");
            unstyled = parsed.searchParams.toString()
                ? parsed.href
                : `${parsed.origin}${parsed.pathname}`;
        }
    } catch {
        unstyled = unstyled.split("?")[0];
    }

    return unstyled;
}

export async function extractCdnLinksViaNetwork(
    pageUrl: string,
    cdnDomains = ["lgwebprimarycdn.gov.np"],
): Promise<DocumentData[]> {
    console.log("[CDN Extraction] running...");
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    const capturedUrls = new Set<string>();

    // Listen to ALL outgoing network requests (XHR, Fetch, Document loads)
    page.on("request", (request) => {
        const url = request.url();
        if (cdnDomains.some((domain) => url.includes(domain))) {
            if (url.endsWith(".pdf") || url.includes("/media/pdf_upload/")) {
                capturedUrls.add(url);
            }
        }
    });

    try {
        // Navigate and wait for network activity to settle (JS / XHR execution)
        await page.goto(pageUrl, { waitUntil: "networkidle", timeout: 30000 });
    } catch (e) {
        console.warn(
            `Timeout or error loading ${pageUrl}, processing captured links anyway. Error: ${(e as any).message}`,
        );
    } finally {
        await browser.close();
    }

    console.log(`[CDN Extraction] Captured URLS: ${Array.from(capturedUrls)}`);

    return Array.from(capturedUrls).map((url) => ({
        fileName: decodeURIComponent(url.split("/").pop()?.split("?")[0] || "Document.pdf"),
        fileType: "pdf",
        originalUrl: decodeURIComponent(url),
        storagePath: null,
        downloadStatus: "skipped",
        downloadError: null,
    }));
}

/**
 * Extracts document links, full-resolution images, and embedded flipbooks from HTML.
 */
export function extractDocumentLinks(
    $: CheerioAPI,
    baseUrl: string,
    $context?: Cheerio<Element>,
    hrefPattern?: RegExp,
): DocumentData[] {
    const documentsMap = new Map<string, DocumentData>();
    const targetContext = $context && $context.length > 0 ? $context : $("body");

    const IGNORED_URL_PATTERNS: string[] = [
        "get.adobe.com",
        "adobe.com/acrobat",
        "adobe_reader",
        "download_acrobat",
        "get_adobe_reader",
        "/modules/file/icons/",
        "/misc/icons/",
        "newlogo.png",
        "logo.png",
        "logo.svg",
        "emblem_of_nepal",
        "/assets/image/",
        "/static/assets/",
    ];

    const IGNORED_TEXT_PATTERNS: string[] = [
        "download adobe",
        "adobe reader",
        "get adobe",
        "get acrobat",
    ];

    const isIgnored = (url: string, ...textCandidates: (string | undefined | null)[]): boolean => {
        const lowerUrl = url.toLowerCase();
        if (IGNORED_URL_PATTERNS.some((pattern) => lowerUrl.includes(pattern))) {
            return true;
        }

        const combinedText = textCandidates
            .filter((t): t is string => Boolean(t))
            .join(" ")
            .toLowerCase();
        return IGNORED_TEXT_PATTERNS.some((pattern) => combinedText.includes(pattern));
    };

    const getFirstNonEmptyString = (...candidates: (string | undefined | null)[]): string => {
        for (const item of candidates) {
            if (item && typeof item === "string") {
                const trimmed = item.trim();
                if (trimmed.length > 0) {
                    return trimmed;
                }
            }
        }
        return "";
    };

    const toAbsoluteUrl = (url: string): string => {
        try {
            const parsed = new URL(url, baseUrl);
            parsed.hash = ""; // Clean hash fragments (#view=Fit, etc.)
            return parsed.href;
        } catch {
            return url.split("#")[0];
        }
    };

    const getExtension = (url: string): string => {
        const cleanUrl = url.split("?")[0].split("#")[0];
        const parts = cleanUrl.split(".");
        const ext = parts.length > 1 ? parts.pop() : "";
        return ext ? ext.toLowerCase() : "";
    };

    // 1. EXTRACT FROM ANCHOR TAGS & OBJECT / EMBED TAGS
    targetContext.find("a[href], object[data], embed[src]").each((_, el) => {
        const $element = $(el);
        const rawHref = $element.attr("href") || $element.attr("data") || $element.attr("src");

        if (!rawHref) return;
        const trimmedHref = rawHref.trim();
        if (!trimmedHref || trimmedHref.startsWith("javascript:") || trimmedHref.startsWith("#")) {
            return;
        }

        const absoluteUrl = toAbsoluteUrl(trimmedHref);
        const anchorText = $element.text();
        const titleAttr = $element.attr("title");

        if (isIgnored(absoluteUrl, anchorText, titleAttr)) {
            return;
        }

        if (hrefPattern && !hrefPattern.test(absoluteUrl)) {
            return;
        }

        const ext = getExtension(absoluteUrl);
        const isDocExtension = [
            "pdf",
            "doc",
            "docx",
            "xls",
            "xlsx",
            "ppt",
            "pptx",
            "zip",
            "csv",
            "jpg",
            "jpeg",
            "png",
            "gif",
            "webp",
        ].includes(ext);

        const isFileContainer =
            $element.closest(
                ".file, .field-type-file, .field-name-field-supporting-documents, .field-name-field-documents",
            ).length > 0;

        if (isDocExtension || isFileContainer) {
            const isImage = ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);
            const resolvedUrl = isImage ? normalizeOriginalImageUrl(absoluteUrl) : absoluteUrl;
            const resolvedExt = getExtension(resolvedUrl) || ext;

            let fileName = getFirstNonEmptyString(titleAttr, anchorText);

            if (
                $element.hasClass("df-ui-download") ||
                !fileName ||
                fileName.toLowerCase().includes("download")
            ) {
                try {
                    const pathParts = resolvedUrl.split("?")[0].split("#")[0].split("/");
                    const decodedName = decodeURIComponent(pathParts[pathParts.length - 1]);
                    if (decodedName) {
                        fileName = decodedName;
                    }
                } catch {
                    // Fallback
                }
            }

            if (!fileName) {
                fileName = "Untitled Document";
            }

            documentsMap.set(resolvedUrl, {
                fileName,
                fileType: resolvedExt || "unknown",
                originalUrl: resolvedUrl,
                storagePath: null,
                downloadStatus: "skipped",
                downloadError: null,
            });
        }
    });

    // 2. EXTRACT FROM IMAGE TAGS
    targetContext.find("img[src]").each((_, el) => {
        const $img = $(el);
        const rawSrc = $img.attr("src");

        if (!rawSrc) return;
        const trimmedSrc = rawSrc.trim();
        if (!trimmedSrc) return;

        const absoluteUrl = toAbsoluteUrl(trimmedSrc);
        const altText = $img.attr("alt");
        const titleText = $img.attr("title");

        if (isIgnored(absoluteUrl, altText, titleText)) {
            return;
        }

        const $parentAnchor = $img.closest("a");
        const parentHref = $parentAnchor.attr("href")?.trim();
        let targetUrl = absoluteUrl;

        if (parentHref && !parentHref.startsWith("javascript:") && !parentHref.startsWith("#")) {
            const parentAbsUrl = toAbsoluteUrl(parentHref);
            const parentExt = getExtension(parentAbsUrl);
            const isParentMedia =
                ["jpg", "jpeg", "png", "gif", "webp", "svg", "pdf", "doc", "docx"].includes(
                    parentExt,
                ) || parentAbsUrl.includes("/files/");

            if (isParentMedia && !isIgnored(parentAbsUrl)) {
                targetUrl = parentAbsUrl;
            }
        }

        if (hrefPattern && !hrefPattern.test(targetUrl)) {
            return;
        }

        const normalizedUrl = normalizeOriginalImageUrl(targetUrl);
        const normalizedExt = getExtension(normalizedUrl);
        const isImageExtension = ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(
            normalizedExt,
        );

        if (isImageExtension) {
            const parentLinkText = $img.closest("a").text();
            const rowTitleText = targetContext.find(".views-field-title").text();

            let urlFileName = "";
            try {
                const pathParts = normalizedUrl.split("?")[0].split("#")[0].split("/");
                urlFileName = decodeURIComponent(pathParts[pathParts.length - 1]);
            } catch {}

            const fileName = getFirstNonEmptyString(
                altText,
                titleText,
                urlFileName,
                parentLinkText,
                rowTitleText,
                `Image_${Date.now()}.${normalizedExt}`,
            );

            if (!documentsMap.has(normalizedUrl)) {
                documentsMap.set(normalizedUrl, {
                    fileName,
                    fileType: normalizedExt,
                    originalUrl: normalizedUrl,
                    storagePath: null,
                    downloadStatus: "skipped",
                    downloadError: null,
                });
            }
        }
    });

    // 3. EXTRACT FROM SCRIPT TAGS (e.g. DFlip flipbook)
    const fullHtml = $.html();
    const scriptMatches = fullHtml.matchAll(/var\s+pdf\s*=\s*['"]([^'"]+\.pdf[^'"]*)['"]/gi);
    for (const match of scriptMatches) {
        const rawPdfUrl = match[1].trim();
        const absoluteUrl = toAbsoluteUrl(rawPdfUrl);
        if (!isIgnored(absoluteUrl)) {
            let fileName = "Document.pdf";
            try {
                const pathParts = absoluteUrl.split("?")[0].split("#")[0].split("/");
                const decoded = decodeURIComponent(pathParts[pathParts.length - 1]);
                if (decoded) fileName = decoded;
            } catch {}
            if (!documentsMap.has(absoluteUrl)) {
                documentsMap.set(absoluteUrl, {
                    fileName,
                    fileType: "pdf",
                    originalUrl: absoluteUrl,
                    storagePath: null,
                    downloadStatus: "skipped",
                    downloadError: null,
                });
            }
        }
    }

    return Array.from(documentsMap.values());
}
