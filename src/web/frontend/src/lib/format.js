export const CATEGORY_META = {
    notice: { label: "Notice", tone: "blue" },
    project: { label: "Project", tone: "green" },
    report: { label: "Report", tone: "amber" },
    budget: { label: "Budget", tone: "violet" },
    tender: { label: "Tender", tone: "slate" },
    decision: { label: "Decision", tone: "rose" },
};

const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? numberFormatter.format(number) : "—";
}

export function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    }).format(date);
}

export function formatDateTime(value) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);

    return new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

export function formatDuration(milliseconds) {
    const totalSeconds = Math.max(0, Math.round(Number(milliseconds || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

export function formatBudget(value) {
    if (value === null || value === undefined || value === "") return "—";

    const amount = Number(value);
    if (!Number.isFinite(amount)) return String(value);

    return `NPR ${numberFormatter.format(amount)}`;
}

export function getCategoryMeta(category) {
    const normalized = String(category || "other").toLowerCase();
    return (
        CATEGORY_META[normalized] || {
            label: String(category || "Other").replace(/[-_]/g, " "),
            tone: "slate",
        }
    );
}

export function getPolicyTitle(policy) {
    return policy?.titleEn || policy?.titleNe || "Untitled record";
}

export function getPolicySubtitle(policy) {
    if (!policy?.titleEn || !policy?.titleNe) return null;
    return policy.titleNe;
}

export function getMunicipalityName(municipality) {
    return (
        municipality?.nameEn || municipality?.nameNe || municipality?.code || "Unknown municipality"
    );
}

export function getMunicipalitySubtitle(municipality) {
    if (!municipality) return null;
    if (municipality.nameEn && municipality.nameNe) return municipality.nameNe;
    return municipality.nameEn || municipality.nameNe || null;
}

export function getRunMunicipality(run, municipalityById, municipalityByCode) {
    if (run.municipality) return run.municipality;
    if (run.municipalityId && municipalityById.has(run.municipalityId)) {
        return municipalityById.get(run.municipalityId);
    }

    const code = String(run.scraperName || "").toLowerCase();
    return municipalityByCode.get(code) || null;
}

export function getInitials(name) {
    return String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase();
}

export function pluralize(count, singular, plural = `${singular}s`) {
    return `${formatNumber(count)} ${count === 1 ? singular : plural}`;
}
