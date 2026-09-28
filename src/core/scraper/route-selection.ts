import { RouteConfig } from "../contracts/scraper.interface.js";
import { extractSlugFromUrl } from "../utils/url.js";

/**
 * Route selection helpers.
 *
 * A route is addressed by its name — the slug of the listing URL, e.g. the
 * route `https://sainamainamun.gov.np/ne/budget-program` is named
 * "budget-program". The same slug is stored on every record produced by the
 * route (`PolicyEntity.type`), which is what makes a single key usable for both
 * running a route and inspecting its scraped records.
 */

/** Normalises any user/CLI/UI supplied segment into a comparable key. */
export function normalizeRouteName(value: string | null | undefined): string {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** The route name derived from a route's listing URL. */
export function getRouteName(route: Pick<RouteConfig, "live">): string {
    return normalizeRouteName(extractSlugFromUrl(route.live));
}

/** The raw slug stored on records produced by this route (e.g. `budget_program`). */
export function getRouteSlug(route: Pick<RouteConfig, "live">): string {
    return extractSlugFromUrl(route.live);
}

function normalizeUrl(value: string): string {
    try {
        const url = new URL(value);
        const path = url.pathname.replace(/\/+$/, "");
        return `${url.origin.toLowerCase()}${path}`;
    } catch {
        return String(value ?? "")
            .trim()
            .toLowerCase();
    }
}

/**
 * Loose route matching: a name may be given as a slug ("budget_program",
 * "budget-program"), as a full listing URL, or as a partial slug. This keeps
 * callers from having to know the exact separator the portal uses.
 */
export function matchesRouteName(route: RouteConfig, name: string): boolean {
    const wanted = normalizeRouteName(name);
    if (!wanted) return true;

    const routeName = getRouteName(route);
    if (routeName === wanted) return true;

    if (routeName.includes(wanted) || wanted.includes(routeName)) return true;

    const wantedUrl = normalizeUrl(String(name));
    const routeUrl = normalizeUrl(route.live);
    if (wantedUrl === routeUrl) return true;

    return normalizeUrl(route.live).endsWith(`/${wanted}`);
}

/**
 * Filters routes by name. An empty/absent filter keeps every route so a full
 * municipality run behaves exactly as before.
 */
export function selectRoutes(routes: RouteConfig[], routeNames?: string[] | null): RouteConfig[] {
    if (!routeNames || routeNames.length === 0) return routes;

    const wanted = routeNames.filter((name) => normalizeRouteName(name));
    if (wanted.length === 0) return routes;

    return routes.filter((route) => wanted.some((name) => matchesRouteName(route, name)));
}
