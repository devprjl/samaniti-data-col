import { ScraperConfig } from "../contracts/scraper.interface.js";

/**
 * Execution settings that are driven by the environment rather than by the
 * route definitions in `extract.ts`.
 */

/** Environment variable that turns listing pagination on/off for every route. */
export const PAGINATION_ENV_VAR = "SCRAPER_PAGINATION";

export type PaginationSource = "config" | "env" | "default";

export interface PaginationSetting {
    /** Whether the crawler should walk beyond the first listing page. */
    enabled: boolean;
    /** Where the value came from, surfaced in the UI so the active mode is never a mystery. */
    source: PaginationSource;
    /** Human readable description of the active mode. */
    label: string;
}

/**
 * Parses a loose boolean ("true", "1", "yes", "on" and their negatives).
 * Returns `null` when the value is absent or unrecognised so callers can fall
 * back to their own default.
 */
export function parseBooleanFlag(value: string | null | undefined): boolean | null {
    if (value === null || value === undefined) return null;

    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return null;

    if (["1", "true", "yes", "y", "on", "enabled"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off", "disabled"].includes(normalized)) return false;

    return null;
}

/**
 * Resolves the pagination mode for a single execution.
 *
 * Precedence: explicit `ScraperConfig.pagination` → `SCRAPER_PAGINATION` env var
 * → `false` (first listing page only, which still yields the complete content
 * for portals that do not paginate).
 */
export function resolvePaginationSetting(config?: ScraperConfig): PaginationSetting {
    if (typeof config?.pagination === "boolean") {
        return {
            enabled: config.pagination,
            source: "config",
            label: config.pagination ? "All listing pages" : "First listing page only",
        };
    }

    const raw = process.env[PAGINATION_ENV_VAR];
    const fromEnv = parseBooleanFlag(raw);

    if (fromEnv !== null) {
        return {
            enabled: fromEnv,
            source: "env",
            label: fromEnv ? "All listing pages" : "First listing page only",
        };
    }

    return {
        enabled: false,
        source: "default",
        label: "First listing page only",
    };
}

/** Convenience wrapper when only the boolean matters. */
export function isPaginationEnabled(config?: ScraperConfig): boolean {
    return resolvePaginationSetting(config).enabled;
}
