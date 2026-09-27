/**
 * Helpers for the scraper workspace.
 *
 * A route is addressed by a structured key — `<province>:<municipality>:<route>`
 * — and the route name is the slug of the listing URL. The very same slug is
 * written to `PolicyEntity.type` for every record a route produces, which is
 * what lets the workspace show exactly which records belong to a route.
 */

export function normalizeRouteKey(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

export function buildRouteKey(target, routeName) {
    if (!target) return "";
    return routeName ? `${target.key}:${routeName}` : target.key;
}

function trimPath(pathname) {
    return String(pathname || "").replace(/\/+$/, "");
}

/** True when a record was collected from the route's listing page or a detail page below it. */
function isCollectedFromRoute(policy, route) {
    if (!policy.sourceUrl || !route.extraction?.live) return false;

    try {
        const record = new URL(policy.sourceUrl);
        const listing = new URL(route.extraction.live);
        if (record.origin !== listing.origin) return false;

        const recordPath = trimPath(record.pathname);
        const listingPath = trimPath(listing.pathname);
        return recordPath === listingPath || recordPath.startsWith(`${listingPath}/`);
    } catch {
        return false;
    }
}

/**
 * Records belonging to a route: either tagged with the route's slug, or
 * collected from the route's URL (some portals label records with the linked
 * document title instead of the route).
 */
export function isRecordForRoute(policy, route) {
    if (!policy || !route) return false;
    return (
        normalizeRouteKey(policy.type) === normalizeRouteKey(route.routeName) ||
        isCollectedFromRoute(policy, route)
    );
}

/** Records of one route, restricted to the route's own municipality. */
export function recordsForRoute(policies, route, target) {
    if (!route) return [];
    return (policies || []).filter(
        (policy) =>
            (!target?.municipalityId || policy.municipalityId === target.municipalityId) &&
            isRecordForRoute(policy, route),
    );
}

function recordPath(policy) {
    try {
        const url = new URL(policy.sourceUrl);
        return `${url.origin.toLowerCase()}${trimPath(url.pathname)}`;
    } catch {
        return null;
    }
}

/**
 * Groups the records of one municipality by route name.
 *
 * A single pass builds the two indexes the routes need (the route tag stored on
 * the record, and the URL it was collected from) so the route list can show
 * record counts without re-scanning every record for every route.
 */
export function collectRouteRecords(policies, routeGroups, target) {
    const records = (policies || []).filter(
        (policy) => !target?.municipalityId || policy.municipalityId === target.municipalityId,
    );

    const byType = new Map();
    const byPath = new Map();

    for (const policy of records) {
        const type = normalizeRouteKey(policy.type);
        if (type) {
            if (!byType.has(type)) byType.set(type, []);
            byType.get(type).push(policy);
        }

        const path = recordPath(policy);
        if (path) {
            if (!byPath.has(path)) byPath.set(path, []);
            byPath.get(path).push(policy);
        }
    }

    const result = new Map();

    for (const group of routeGroups || []) {
        const routeName = normalizeRouteKey(group.routeName);
        const matched = new Set(byType.get(routeName) || []);

        let listingPath = null;
        try {
            const listing = new URL(group.live);
            listingPath = `${listing.origin.toLowerCase()}${trimPath(listing.pathname)}`;
        } catch {
            listingPath = null;
        }

        if (listingPath) {
            for (const [path, policiesAtPath] of byPath) {
                if (path === listingPath || path.startsWith(`${listingPath}/`)) {
                    for (const policy of policiesAtPath) matched.add(policy);
                }
            }
        }

        result.set(group.routeName, [...matched]);
    }

    return result;
}

/** Groups the configurations of one target by route name, in declaration order. */
export function groupRoutesByName(routes) {
    const groups = new Map();

    for (const route of routes || []) {
        const existing = groups.get(route.routeName);
        if (existing) {
            existing.push(route);
        } else {
            groups.set(route.routeName, [route]);
        }
    }

    return [...groups.values()].map((configurations) => ({
        routeName: configurations[0].routeName,
        key: configurations[0].key,
        type: configurations[0].extraction.type,
        live: configurations[0].extraction.live,
        configurations,
    }));
}

/** A copy/paste friendly snapshot of a route's extraction configuration. */
export function toConfigSnippet(route) {
    const { extraction } = route;
    return {
        type: extraction.type,
        live: extraction.live,
        baseUrl: extraction.baseUrl,
        contentSelector: extraction.contentSelector,
        detailSelector: extraction.detailSelector,
        detailContentSelector: extraction.detailContentSelector,
        detailType: extraction.detailType,
    };
}

export function toConfigJson(route) {
    return JSON.stringify(toConfigSnippet(route), null, 2);
}

const SELECTOR_FIELDS = [
    ["contentSelector", "Listing scope"],
    ["detailSelector", "Detail links"],
    ["detailContentSelector", "Detail scope"],
];

export function selectorEntries(route) {
    const { extraction } = route;
    return SELECTOR_FIELDS.map(([field, label]) => ({
        field,
        label,
        value: extraction[field],
    })).filter((entry) => Boolean(entry.value));
}

export async function copyToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
    }

    // Fallback for browsers without the async clipboard API.
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);
    return copied;
}
