import * as ndc from "nepali-date-converter";

// Handle both CJS and ESM default export bindings
const NepaliDateClass = (ndc as any).default?.default || (ndc as any).default || ndc;

/**
 * Mapping of Devanagari numerals to standard ASCII numerals.
 */
export const NEPALI_NUMERAL_MAP: Record<string, string> = {
    "०": "0",
    "१": "1",
    "२": "2",
    "३": "3",
    "४": "4",
    "५": "5",
    "६": "6",
    "७": "7",
    "८": "8",
    "९": "9",
};

export const ASCII_TO_NEPALI_NUMERAL_MAP: Record<string, string> = {
    "0": "०",
    "1": "१",
    "2": "२",
    "3": "३",
    "4": "४",
    "5": "५",
    "6": "६",
    "7": "७",
    "8": "८",
    "9": "९",
};

/**
 * Converts all Devanagari numerals in a string into standard ASCII numbers.
 * e.g., "२०८०-०३-१५" -> "2080-03-15"
 */
export function nepaliToAsciiNumber(str: string): string {
    if (!str) return "";
    return str.replace(/[०-९]/g, (digit) => NEPALI_NUMERAL_MAP[digit] ?? digit);
}

/**
 * Converts ASCII numerals in a string or number into Devanagari numerals.
 * e.g., "2080" -> "२०८०"
 */
export function asciiToNepaliNumber(val: string | number): string {
    if (val === null || val === undefined) return "";
    const str = String(val);
    return str.replace(/[0-9]/g, (digit) => ASCII_TO_NEPALI_NUMERAL_MAP[digit] ?? digit);
}

/**
 * Parses an integer from Nepali (or English) text, properly handling Devanagari digits.
 * Returns null if the string cannot be parsed.
 */
export function parseNepaliInt(str: string | null | undefined): number | null {
    if (!str) return null;
    const converted = nepaliToAsciiNumber(str.trim());
    // Extract the first sequence of digits with optional leading negative sign
    const match = converted.match(/-?\d+/);
    if (!match) return null;
    const parsed = parseInt(match[0], 10);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Parses a floating-point number from Nepali (or English) text, properly handling Devanagari digits.
 * Returns null if the string cannot be parsed.
 */
export function parseNepaliFloat(str: string | null | undefined): number | null {
    if (!str) return null;
    const converted = nepaliToAsciiNumber(str.trim());
    // Extract number with optional decimal
    const match = converted.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = parseFloat(match[0]);
    return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Parses Nepali currency strings into numeric amounts.
 * Supports:
 * - Direct amounts with currency symbols: "रु. १,५०,०००", "रु 50,000", "Rs. 2,00,000/-", "NPR 100000"
 * - Nepali denominations:
 *   - "हजार" (thousand: x 1,000)
 *   - "लाख" (lakh: x 100,000)
 *   - "करोड" (crore: x 10,000,000)
 *   - "अर्ब" (arab: x 1,000,000,000)
 */
export function parseNepaliCurrency(str: string | null | undefined): number | null {
    if (!str) return null;
    const cleaned = str.trim();
    if (!cleaned) return null;

    // Convert Devanagari numerals
    const asciiStr = nepaliToAsciiNumber(cleaned);

    // Check for unit multipliers (लाख, करोड, हजार, अर्ब)
    let multiplier = 1;
    if (/अर्ब|arab/i.test(asciiStr)) {
        multiplier = 1_000_000_000;
    } else if (/करोड|crore|cr/i.test(asciiStr)) {
        multiplier = 10_000_000;
    } else if (/लाख|lakh/i.test(asciiStr)) {
        multiplier = 100_000;
    } else if (/हजार|thousand/i.test(asciiStr)) {
        multiplier = 1_000;
    }

    // Remove currency prefixes, suffixes, and punctuation
    // Remove "रु.", "रु", "Rs.", "Rs", "NPR", "/-", commas, spaces
    const numericPortion = asciiStr
        .replace(/(?:रु\.?|rs\.?|npr|\/-)/gi, "")
        .replace(/[^\d.-]/g, "");

    if (!numericPortion) return null;

    const parsed = parseFloat(numericPortion);
    if (Number.isNaN(parsed)) return null;

    return parsed * multiplier;
}

/**
 * Normalizes Nepali date strings to standard ISO-like `YYYY-MM-DD` BS format.
 * Translates Devanagari digits and normalizes delimiters (., /, -).
 * e.g., "२०८०/०३/१५" -> "2080-03-15"
 * e.g., "२०८०.३.५" -> "2080-03-05"
 */
export function normalizeNepaliDate(dateStr: string | null | undefined): string | null {
    if (!dateStr) return null;
    const converted = nepaliToAsciiNumber(dateStr.trim());

    // Match 4 digits year, 1-2 digits month, 1-2 digits day separated by -, /, or .
    const match = converted.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (!match) {
        // If only year is given
        const yearMatch = converted.match(/^(\d{4})$/);
        if (yearMatch) return `${yearMatch[1]}-01-01`;
        return null;
    }

    const year = match[1];
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");

    return `${year}-${month}-${day}`;
}

/**
 * Converts a Bikram Sambat (BS) date string to a Gregorian (AD) JavaScript Date object.
 * e.g., "२०८०-०३-१५" -> Date(2023-06-29T...)
 */
export function bsToAd(bsDateStr: string | null | undefined): Date | null {
    if (!bsDateStr) return null;

    const normalized = normalizeNepaliDate(bsDateStr);
    if (!normalized) return null;

    try {
        const parts = normalized.split("-").map((p) => parseInt(p, 10));
        const year = parts[0];
        const month = parts[1]; // 1-12
        const day = parts[2]; // 1-32

        // nepali-date-converter uses 0-based month (0 = Baisakh, 11 = Chaitra)
        const nepaliDate = new NepaliDateClass(year, month - 1, day);
        const jsDate = nepaliDate.toJsDate();
        return Number.isNaN(jsDate.getTime()) ? null : jsDate;
    } catch {
        return null;
    }
}

/**
 * Converts a Gregorian (AD) Date object or string to a Bikram Sambat (BS) date string `YYYY-MM-DD`.
 */
export function adToBs(adDate: Date | string | null | undefined): string | null {
    if (!adDate) return null;
    const dateObj = typeof adDate === "string" ? new Date(adDate) : adDate;
    if (Number.isNaN(dateObj.getTime())) return null;

    try {
        const nepaliDate = new NepaliDateClass(dateObj);
        const year = nepaliDate.getYear();
        const month = String(nepaliDate.getMonth() + 1).padStart(2, "0");
        const day = String(nepaliDate.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    } catch {
        return null;
    }
}

/**
 * Extracts and normalizes Nepali fiscal years from text.
 * e.g., "आर्थिक वर्ष २०८०/८१ को नीति" -> "२०८०/८१"
 * e.g., "FY 2080/81" -> "2080/81"
 */
export function parseNepaliFiscalYear(text: string | null | undefined): string | null {
    if (!text) return null;
    // Match Devanagari fiscal year e.g. २०८०/८१ or २०८०-८१
    const nepaliMatch = text.match(/([०-९]{4}[\/–\-][०-९]{2,4})/);
    if (nepaliMatch) return nepaliMatch[1];

    // Match ASCII fiscal year e.g. 2080/81 or 2080-81
    const asciiMatch = text.match(/(\d{4}[\/–\-]\d{2,4})/);
    if (asciiMatch) return asciiMatch[1];

    return null;
}

/**
 * Utility to clean and collapse excess whitespace from extracted Nepali strings.
 */
export function cleanNepaliText(text: string | null | undefined): string | null {
    if (!text) return null;
    const cleaned = text.replace(/\s+/g, " ").trim();
    return cleaned.length > 0 ? cleaned : null;
}
