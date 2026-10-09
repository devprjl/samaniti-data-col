import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
    IMunicipalityScraper,
    RouteConfig,
    ScraperConfig,
} from "../contracts/scraper.interface.js";
import { ScraperRunSummary } from "./pipeline.js";
import { getRouteName, getRouteSlug } from "./route-selection.js";

/**
 * Discovery of scraper targets and their route definitions.
 *
 * Everything the scraper workspace needs is derived from the repository itself:
 * the `src/scrapers/<province>/<municipality>/` folders, the `ROUTES` array of
 * each `extract.ts` and the scraper class exported by each `index.ts`. Nothing
 * is duplicated in the database, so the UI can never drift from the code.
 */

export interface ScraperTarget {
    /** Directory name of the municipality, e.g. "sainamaina-mun". */
    municipality: string;
    /** Directory name without the "-mun" suffix, e.g. "sainamaina". */
    cleanMun: string;
    province: string;
    /** Structured key for province level targeting, e.g. "lumbini:sainamaina". */
    key: string;
    directory: string;
    extractPath: string;
    transformPath: string | null;
    indexPath: string | null;
}

/**
 * Identity of a scraper as stored in the database.
 *
 * The municipality code is read from the scraper's own `MUNICIPALITY_CODE`
 * — the value the loader upserts under.
 */
export interface ScraperTargetIdentity {
    municipalityCode: string | null;
    municipalityName: string | null;
}

/**
 * The extraction settings exposed to the UI. This is a deliberate whitelist:
 * only the selectors and URLs needed to verify a route are surfaced, never
 * transformer or crawler internals.
 */
export interface RouteExtractionConfig {
    type: string;
    live: string;
    baseUrl: string | null;
    contentSelector: string | null;
    detailSelector: string | null;
    detailContentSelector: string | null;
    detailType: string | null;
}

export interface RouteDescriptor {
    /** Full structured key, e.g. "lumbini:sainamaina:budget-program". */
    key: string;
    targetKey: string;
    routeName: string;
    /** Value stored on every record produced by the route (`PolicyEntity.type`). */
    routeSlug: string;
    province: string;
    municipality: string;
    cleanMun: string;
    /** 1-based position of this configuration inside the scraper's ROUTES array. */
    position: number;
    /** How many configurations in the scraper share this route name. */
    configurationCount: number;
    extraction: RouteExtractionConfig;
    /** Repository relative path of the file the configuration was read from. */
    sourceFile: string;
}

export type TargetScope = "all" | "province" | "municipality" | "route";

export interface TargetMatch {
    targets: ScraperTarget[];
    scope: TargetScope;
    requested: string;
    /** Route name when the key targeted a single route. */
    routeName: string | null;
    error: string | null;
}

let cachedRoot: string | null = null;

/**
 * Locates the project root by walking up until the scrapers folder is found,
 * so the registry works from `src/` (tsx) and from `dist/` (compiled) alike.
 */
export function getProjectRoot(): string {
    if (cachedRoot) return cachedRoot;

    const candidates: string[] = [];
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let depth = 0; depth < 8; depth += 1) {
        candidates.push(dir);
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }
    candidates.push(process.cwd());

    for (const candidate of candidates) {
        if (fs.existsSync(path.join(candidate, "src", "scrapers"))) {
            cachedRoot = candidate;
            return candidate;
        }
    }

    throw new Error("[registry] Unable to locate the 'src/scrapers' directory.");
}

/** Repository relative path, used by the UI to show where a config came from. */
export function toRelativePath(absolutePath: string): string {
    return path.relative(getProjectRoot(), absolutePath).split(path.sep).join("/");
}

function normalizeSegment(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** All scraper targets found on disk, sorted by province then municipality. */
export function getAvailableScrapers(): ScraperTarget[] {
    const scrapersDir = path.join(getProjectRoot(), "src", "scrapers");
    if (!fs.existsSync(scrapersDir)) return [];

    const targets: ScraperTarget[] = [];

    for (const province of fs.readdirSync(scrapersDir, { withFileTypes: true })) {
        if (!province.isDirectory()) continue;

        const provinceDir = path.join(scrapersDir, province.name);
        for (const municipality of fs.readdirSync(provinceDir, { withFileTypes: true })) {
            if (!municipality.isDirectory()) continue;

            const directory = path.join(provinceDir, municipality.name);
            const extractPath = path.join(directory, "extract.ts");
            if (!fs.existsSync(extractPath)) continue;

            const indexPath = path.join(directory, "index.ts");
            const transformPath = path.join(directory, "transform.ts");
            const cleanMun = municipality.name.replace(/-mun$/, "");

            targets.push({
                province: province.name,
                municipality: municipality.name,
                cleanMun,
                key: `${province.name}:${cleanMun}`,
                directory,
                extractPath,
                transformPath: fs.existsSync(transformPath) ? transformPath : null,
                indexPath: fs.existsSync(indexPath) ? indexPath : null,
            });
        }
    }

    return targets.sort(
        (first, second) =>
            first.province.localeCompare(second.province) ||
            first.municipality.localeCompare(second.municipality),
    );
}

function matchMunicipality(
    targets: ScraperTarget[],
    province: string | null,
    municipality: string | null,
): ScraperTarget[] {
    const provinceFilter = province ? normalizeSegment(province) : null;
    const municipalityFilter = municipality ? normalizeSegment(municipality) : null;

    return targets.filter((target) => {
        if (provinceFilter && normalizeSegment(target.province) !== provinceFilter) return false;
        if (!municipalityFilter) return true;
        return (
            normalizeSegment(target.municipality) === municipalityFilter ||
            normalizeSegment(target.cleanMun) === municipalityFilter
        );
    });
}

/** Splits `<province>[:<municipality>[:<route>]]`, tolerating URLs in the route. */
export function splitTargetKey(key: string): {
    province: string | null;
    municipality: string | null;
    route: string | null;
} {
    const trimmed = String(key || "").trim();
    if (!trimmed) return { province: null, municipality: null, route: null };

    const firstColon = trimmed.indexOf(":");
    if (firstColon === -1) return { province: trimmed, municipality: null, route: null };

    const secondColon = trimmed.indexOf(":", firstColon + 1);
    if (secondColon === -1) {
        return {
            province: trimmed.slice(0, firstColon),
            municipality: trimmed.slice(firstColon + 1),
            route: null,
        };
    }

    return {
        province: trimmed.slice(0, firstColon),
        municipality: trimmed.slice(firstColon + 1, secondColon),
        route: trimmed.slice(secondColon + 1),
    };
}

/**
 * Resolves a target key against the scrapers on disk.
 *
 * Accepts `all`, `<province>`, `<province>:<municipality>` and
 * `<province>:<municipality>:<route>`, in any letter case, with or without the
 * `-mun` suffix on the municipality.
 */
export function matchTargets(targetKey?: string | null): TargetMatch {
    const available = getAvailableScrapers();
    const requested = String(targetKey || "").trim();

    if (!requested || requested.toLowerCase() === "all") {
        return { targets: available, scope: "all", requested, routeName: null, error: null };
    }

    const { province, municipality, route } = splitTargetKey(requested);
    const matched = matchMunicipality(available, province, municipality);

    if (matched.length === 0) {
        return {
            targets: [],
            scope: "route",
            requested,
            routeName: route,
            error: `No scraper found for '${requested}'.`,
        };
    }

    if (route) {
        return {
            targets: matched.slice(0, 1),
            scope: "route",
            requested,
            routeName: route,
            error: null,
        };
    }

    if (!municipality) {
        return {
            targets: matched,
            scope: "province",
            requested,
            routeName: null,
            error: null,
        };
    }

    return {
        targets: matched,
        scope: matched.length === 1 ? "municipality" : "province",
        requested,
        routeName: null,
        error: null,
    };
}

/** Loads a module from an absolute path, optionally bypassing the import cache. */
async function importModule(absolutePath: string, fresh = false): Promise<Record<string, any>> {
    const url = pathToFileURL(absolutePath).href;
    return import(fresh ? `${url}?v=${Date.now()}` : url);
}

function toExtractionConfig(route: RouteConfig): RouteExtractionConfig {
    return {
        type: route.type,
        live: route.live,
        baseUrl: route.baseUrl ?? null,
        contentSelector: route.contentSelector ?? null,
        detailSelector: route.detailSelector ?? null,
        detailContentSelector: route.detailContentSelector ?? null,
        detailType: route.detailType ?? null,
    };
}

/**
 * Reads the `ROUTES` array straight out of a scraper's `extract.ts`.
 *
 * The module is re-read on every call, so the UI always shows the configuration
 * that is currently on disk.
 */
export async function getRouteDescriptors(target: ScraperTarget): Promise<RouteDescriptor[]> {
    const module = await importModule(target.extractPath, true);
    const routes = (module.ROUTES ?? []) as RouteConfig[];

    if (!Array.isArray(routes)) {
        throw new Error(`'${toRelativePath(target.extractPath)}' does not export a ROUTES array.`);
    }

    const counts = new Map<string, number>();
    for (const route of routes) {
        const name = getRouteName(route);
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    const sourceFile = toRelativePath(target.extractPath);

    return routes.map((route, index) => {
        const routeName = getRouteName(route);
        return {
            key: `${target.key}:${routeName}`,
            targetKey: target.key,
            routeName,
            routeSlug: getRouteSlug(route),
            province: target.province,
            municipality: target.municipality,
            cleanMun: target.cleanMun,
            position: index + 1,
            configurationCount: counts.get(routeName) ?? 1,
            extraction: toExtractionConfig(route),
            sourceFile,
        };
    });
}

/** All route descriptors for every scraper on disk. */
export async function getAllRouteDescriptors(): Promise<RouteDescriptor[]> {
    const targets = getAvailableScrapers();
    const descriptors = await Promise.all(targets.map((target) => getRouteDescriptors(target)));
    return descriptors.flat();
}

/**
 * Reads the database identity of a scraper from its `transform.ts` metadata.
 *
 * Only the exported constants are read — none of the transformer internals ever
 * leave the backend.
 */
export async function getTargetIdentity(target: ScraperTarget): Promise<ScraperTargetIdentity> {
    if (!target.transformPath) return { municipalityCode: null, municipalityName: null };

    try {
        const module = await importModule(target.transformPath);
        return {
            municipalityCode: module.MUNICIPALITY_CODE ?? null,
            municipalityName: module.MUNICIPALITY_METADATA?.nameEn ?? null,
        };
    } catch (error: any) {
        console.warn(
            `[registry] Could not read the identity of '${target.key}': ${error?.message ?? error}`,
        );
        return { municipalityCode: null, municipalityName: null };
    }
}

/** Instantiates the scraper class exported by a target's `index.ts`. */
export async function loadScraper(target: ScraperTarget): Promise<IMunicipalityScraper> {
    if (!target.indexPath) {
        throw new Error(`No scraper entry point (index.ts) found for '${target.key}'.`);
    }

    const module = await importModule(target.indexPath);
    const className = Object.keys(module).find(
        (name) => typeof module[name] === "function" && name.endsWith("Scraper"),
    );

    if (!className) {
        throw new Error(`'${toRelativePath(target.indexPath)}' does not export a scraper class.`);
    }

    const ScraperClass = module[className];
    return new ScraperClass() as IMunicipalityScraper;
}

/**
 * Runs a scraper — optionally restricted to a single route — exactly the way
 * the CLI runner does, because both go through the scraper's own `run()`.
 */
export async function runScraperTarget(
    target: ScraperTarget,
    config?: ScraperConfig,
): Promise<ScraperRunSummary> {
    const scraper = await loadScraper(target);
    return scraper.run(config);
}
