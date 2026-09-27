import { useMemo, useState } from "react";
import Link from "../components/Link";
import { useRouter } from "../lib/router";
import { formatDateTime, formatNumber, getMunicipalitySubtitle, pluralize } from "../lib/format";
import Icon from "../components/Icon";
import PolicyTable from "../components/PolicyTable";
import RunTable from "../components/RunTable";
import {
    EmptyState,
    PageHeader,
    SearchField,
    SelectField,
    StatCard,
    StatusBadge,
} from "../components/Primitives";

const tabs = [
    { id: "overview", label: "Overview" },
    { id: "policies", label: "Policy records" },
    { id: "runs", label: "Collection activity" },
];

function ProfileValue({ label, value, href }) {
    return (
        <div className="profile-value">
            <span>{label}</span>
            {href ? (
                <a href={href} rel="noreferrer" target="_blank">
                    {value || "Not listed"} <Icon name="arrow-up-right" size={13} />
                </a>
            ) : (
                <strong>{value || "Not listed"}</strong>
            )}
        </div>
    );
}

function OverviewTab({ municipality, stats, policies, runs }) {
    const latestRun = runs[0];
    const profile = municipality.profile || {};
    const recentPolicies = policies.slice(0, 5);

    return (
        <div className="detail-stack">
            <section className="stats-grid stats-grid-detail">
                <StatCard
                    detail={`${formatNumber(stats.categories.notice || 0)} notices in this record set`}
                    icon="file"
                    label="Policy records"
                    tone="blue"
                    value={formatNumber(stats.policyCount)}
                />
                <StatCard
                    detail="Linked source files"
                    icon="download"
                    label="Documents"
                    tone="amber"
                    value={formatNumber(stats.documentCount)}
                />
                <StatCard
                    detail={latestRun ? formatDateTime(latestRun.startedAt) : "No collection run"}
                    icon="activity"
                    label="Latest collection"
                    tone="green"
                    value={latestRun ? formatDurationForCard(latestRun.durationMs) : "—"}
                />
            </section>

            <div className="detail-grid detail-grid-main">
                <section className="panel profile-panel">
                    <div className="panel-title-row">
                        <div>
                            <p className="eyebrow">Administrative profile</p>
                            <h2>Local government details</h2>
                        </div>
                        <span className="profile-code">{municipality.code}</span>
                    </div>
                    <div className="profile-grid">
                        <ProfileValue label="Province" value={municipality.province} />
                        <ProfileValue label="District" value={municipality.district} />
                        <ProfileValue label="Established (B.S.)" value={profile.establishedBs} />
                        <ProfileValue
                            label="Total wards"
                            value={profile.totalWards ? formatNumber(profile.totalWards) : null}
                        />
                        <ProfileValue
                            label="Population"
                            value={profile.population ? formatNumber(profile.population) : null}
                        />
                        <ProfileValue
                            label="Area"
                            value={
                                profile.areaSqKm ? `${formatNumber(profile.areaSqKm)} km²` : null
                            }
                        />
                        <ProfileValue
                            label="Email"
                            value={profile.email}
                            href={profile.email ? `mailto:${profile.email}` : null}
                        />
                        <ProfileValue
                            label="Website"
                            value={profile.website}
                            href={profile.website}
                        />
                    </div>
                    {profile.includedVdcsNe && (
                        <div className="profile-note">
                            <Icon name="layers" size={16} />
                            <span>Included VDCs: {profile.includedVdcsNe}</span>
                        </div>
                    )}
                </section>

                <section className="panel run-summary-panel">
                    <div className="panel-title-row">
                        <div>
                            <p className="eyebrow">Collection status</p>
                            <h2>Latest run</h2>
                        </div>
                        {latestRun && <StatusBadge status={latestRun.status} />}
                    </div>
                    {latestRun ? (
                        <div className="run-summary-body">
                            <div className="run-summary-time">
                                <span>Started</span>
                                <strong>{formatDateTime(latestRun.startedAt)}</strong>
                            </div>
                            <div className="run-summary-metrics">
                                <div>
                                    <span>Added</span>
                                    <strong>{formatNumber(latestRun.itemsAdded)}</strong>
                                </div>
                                <div>
                                    <span>Updated</span>
                                    <strong>{formatNumber(latestRun.itemsUpdated)}</strong>
                                </div>
                                <div>
                                    <span>Duration</span>
                                    <strong>{formatDurationForCard(latestRun.durationMs)}</strong>
                                </div>
                            </div>
                            {latestRun.error && <p className="run-error-copy">{latestRun.error}</p>}
                            <Link
                                className="text-link"
                                to={`/municipalities/${encodeURIComponent(municipality.id)}/runs`}
                            >
                                View collection history <Icon name="arrow-right" size={15} />
                            </Link>
                        </div>
                    ) : (
                        <EmptyState
                            description="No scraper run has been linked to this local government."
                            icon="activity"
                            title="No run data"
                        />
                    )}
                </section>
            </div>

            <section className="panel panel-table">
                <div className="section-heading">
                    <div>
                        <p className="eyebrow">Latest additions</p>
                        <h2>Recent policy records</h2>
                        <p>The newest records currently available for this local government.</p>
                    </div>
                    <Link
                        className="text-link"
                        to={`/municipalities/${encodeURIComponent(municipality.id)}/policies`}
                    >
                        View all records <Icon name="arrow-right" size={15} />
                    </Link>
                </div>
                <PolicyTable
                    emptyDescription="No policy records have been collected for this local government."
                    emptyTitle="No policy records"
                    pageSize={5}
                    policies={recentPolicies}
                />
            </section>
        </div>
    );
}

function formatDurationForCard(duration) {
    const totalSeconds = Math.max(0, Math.round(Number(duration || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
}

function PolicyExplorer({ municipality, policies }) {
    const { search, navigate } = useRouter();
    const query = new URLSearchParams(search);
    const activeCategory = query.get("category") || "all";
    const activeYear = query.get("year") || "all";
    const urlSearch = query.get("q") || "";
    const [searchValue, setSearchValue] = useState(urlSearch);

    const years = useMemo(
        () =>
            [...new Set(policies.map((policy) => policy.fiscalYear).filter(Boolean))]
                .sort()
                .reverse(),
        [policies],
    );

    const filteredPolicies = useMemo(() => {
        const normalized = urlSearch.trim().toLowerCase();
        return policies.filter((policy) => {
            const matchesCategory = activeCategory === "all" || policy.category === activeCategory;
            const matchesYear = activeYear === "all" || policy.fiscalYear === activeYear;
            const matchesSearch =
                !normalized ||
                [policy.titleEn, policy.titleNe, policy.type, policy.fiscalYear]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
                    .includes(normalized);
            return matchesCategory && matchesYear && matchesSearch;
        });
    }, [activeCategory, activeYear, policies, urlSearch]);

    function updateQuery(key, value) {
        const next = new URLSearchParams(search);
        if (value && value !== "all") next.set(key, value);
        else next.delete(key);
        const nextSearch = next.toString();
        navigate(
            nextSearch
                ? `/municipalities/${encodeURIComponent(municipality.id)}/policies?${nextSearch}`
                : `/municipalities/${encodeURIComponent(municipality.id)}/policies`,
        );
    }

    function submitSearch(event) {
        event.preventDefault();
        updateQuery("q", searchValue.trim());
    }

    const categoryOptions = [
        { value: "all", label: "All categories" },
        ...[...new Set(policies.map((policy) => policy.category).filter(Boolean))]
            .sort()
            .map((category) => ({ value: category, label: category.replace(/[-_]/g, " ") })),
    ];

    function categoryUrl(category) {
        const next = new URLSearchParams(search);
        if (category === "all") next.delete("category");
        else next.set("category", category);
        const nextSearch = next.toString();
        return nextSearch
            ? `/municipalities/${encodeURIComponent(municipality.id)}/policies?${nextSearch}`
            : `/municipalities/${encodeURIComponent(municipality.id)}/policies`;
    }

    return (
        <div className="policy-explorer">
            <div className="explorer-toolbar">
                <div
                    className="category-tabs"
                    role="tablist"
                    aria-label="Filter by policy category"
                >
                    {categoryOptions.map((option) => (
                        <Link
                            aria-selected={activeCategory === option.value}
                            className={`category-tab${activeCategory === option.value ? " category-tab-active" : ""}`}
                            key={option.value}
                            role="tab"
                            to={categoryUrl(option.value)}
                        >
                            {option.label}
                            <span>
                                {option.value === "all"
                                    ? formatNumber(policies.length)
                                    : formatNumber(
                                          policies.filter(
                                              (policy) => policy.category === option.value,
                                          ).length,
                                      )}
                            </span>
                        </Link>
                    ))}
                </div>
                <div className="explorer-filters">
                    <SearchField
                        label="Search this local government's records"
                        name="municipality-policy-search"
                        onChange={(event) => setSearchValue(event.target.value)}
                        onSubmit={submitSearch}
                        placeholder="Search titles"
                        value={searchValue}
                    />
                    <SelectField
                        label="Filter by fiscal year"
                        name="fiscal-year-filter"
                        onChange={(event) => updateQuery("year", event.target.value)}
                        options={[
                            { value: "all", label: "All fiscal years" },
                            ...years.map((year) => ({ value: year, label: year })),
                        ]}
                        value={activeYear}
                    />
                </div>
            </div>
            <div className="explorer-result-line">
                <span>{pluralize(filteredPolicies.length, "record")} in this view</span>
                {(activeCategory !== "all" || activeYear !== "all" || urlSearch) && (
                    <Link
                        className="text-link text-link-muted"
                        to={`/municipalities/${encodeURIComponent(municipality.id)}/policies`}
                    >
                        Clear filters <Icon name="close" size={14} />
                    </Link>
                )}
            </div>
            <PolicyTable
                emptyDescription="No records match the selected category, year, or search term."
                emptyTitle="No matching records"
                policies={filteredPolicies}
                resetKey={`${activeCategory}-${activeYear}-${urlSearch}`}
            />
        </div>
    );
}

export default function MunicipalityPage({
    municipality,
    stats,
    policies,
    runs,
    municipalityById,
    municipalityByCode,
}) {
    const { pathname, search } = useRouter();
    const parts = pathname.split("/").filter(Boolean);
    const activeTab = tabs.some((tab) => tab.id === parts[2]) ? parts[2] : "overview";
    const subtitle = getMunicipalitySubtitle(municipality);
    const profile = municipality.profile || {};

    return (
        <div className="page-stack">
            <div className="detail-breadcrumb">
                <Link className="back-link" to="/municipalities">
                    <Icon name="arrow-left" size={15} /> All local governments
                </Link>
            </div>

            <PageHeader
                action={
                    profile.website ? (
                        <a
                            className="button button-secondary"
                            href={profile.website}
                            rel="noreferrer"
                            target="_blank"
                        >
                            Visit official website <Icon name="arrow-up-right" size={15} />
                        </a>
                    ) : null
                }
                description={`${municipality.province} · ${municipality.district}`}
                eyebrow="Local government record"
                title={municipality.nameEn || municipality.nameNe}
            >
                <div className="page-header-identity">
                    <span className="identity-code">{municipality.code}</span>
                    {subtitle && <span>{subtitle}</span>}
                </div>
            </PageHeader>

            <nav aria-label="Local government sections" className="detail-tabs">
                {tabs.map((tab) => {
                    const to =
                        tab.id === "overview"
                            ? `/municipalities/${encodeURIComponent(municipality.id)}`
                            : `/municipalities/${encodeURIComponent(municipality.id)}/${tab.id}`;
                    return (
                        <Link
                            aria-current={activeTab === tab.id ? "page" : undefined}
                            className={`detail-tab${activeTab === tab.id ? " detail-tab-active" : ""}`}
                            key={tab.id}
                            to={to}
                        >
                            {tab.label}
                            {tab.id === "policies" && (
                                <span>{formatNumber(stats.policyCount)}</span>
                            )}
                            {tab.id === "runs" && <span>{formatNumber(runs.length)}</span>}
                        </Link>
                    );
                })}
            </nav>

            {activeTab === "overview" && (
                <OverviewTab
                    municipality={municipality}
                    policies={policies}
                    runs={runs}
                    stats={stats}
                />
            )}
            {activeTab === "policies" && (
                <PolicyExplorer key={search} municipality={municipality} policies={policies} />
            )}
            {activeTab === "runs" && (
                <section className="panel panel-table">
                    <div className="section-heading">
                        <div>
                            <p className="eyebrow">Execution history</p>
                            <h2>Collection activity</h2>
                            <p>
                                Recorded scraper runs for{" "}
                                {municipality.nameEn || municipality.nameNe}.
                            </p>
                        </div>
                        <span className="section-count">{formatNumber(runs.length)} runs</span>
                    </div>
                    <RunTable
                        municipalityByCode={municipalityByCode}
                        municipalityById={municipalityById}
                        resetKey={municipality.id}
                        runs={runs}
                    />
                </section>
            )}
        </div>
    );
}
