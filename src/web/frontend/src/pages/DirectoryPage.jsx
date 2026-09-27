import { useMemo, useState } from "react";
import Link from "../components/Link";
import { useRouter } from "../lib/router";
import { formatNumber, getMunicipalityName, pluralize } from "../lib/format";
import Icon from "../components/Icon";
import MunicipalityCard from "../components/MunicipalityCard";
import { EmptyState, PageHeader, SearchField, SelectField } from "../components/Primitives";

const provinceOptions = [
    { value: "all", label: "All provinces" },
    { value: "Madhesh", label: "Madhesh" },
    { value: "Lumbini", label: "Lumbini" },
];

export default function DirectoryPage({ municipalities, policies, directory }) {
    const { search, navigate } = useRouter();
    const query = new URLSearchParams(search);
    const querySearch = query.get("q") || "";
    const queryProvince = query.get("province") || "all";
    const sortValue = query.get("sort") || "name";
    const [searchValue, setSearchValue] = useState(querySearch);

    const policyMatches = useMemo(() => {
        const normalized = querySearch.trim().toLowerCase();
        if (!normalized) return null;

        const matchingIds = new Set();
        for (const policy of policies) {
            const searchable = [policy.titleEn, policy.titleNe, policy.type, policy.category]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            if (searchable.includes(normalized)) matchingIds.add(policy.municipalityId);
        }
        return matchingIds;
    }, [policies, querySearch]);

    const filteredDirectory = useMemo(() => {
        const normalized = querySearch.trim().toLowerCase();
        const filtered = directory.filter(({ municipality }) => {
            const matchesProvince =
                queryProvince === "all" || municipality.province === queryProvince;
            const matchesMetadata =
                !normalized ||
                [
                    municipality.nameEn,
                    municipality.nameNe,
                    municipality.code,
                    municipality.district,
                    municipality.province,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
                    .includes(normalized);
            const matchesPolicy = !policyMatches || policyMatches.has(municipality.id);
            return matchesProvince && (matchesMetadata || matchesPolicy);
        });

        return [...filtered].sort((first, second) => {
            if (sortValue === "records") {
                return (second.stats?.policyCount || 0) - (first.stats?.policyCount || 0);
            }
            if (sortValue === "recent") {
                return (
                    new Date(second.stats?.lastRun?.startedAt || 0) -
                    new Date(first.stats?.lastRun?.startedAt || 0)
                );
            }
            return getMunicipalityName(first.municipality).localeCompare(
                getMunicipalityName(second.municipality),
            );
        });
    }, [directory, policyMatches, queryProvince, querySearch, sortValue]);

    function updateQuery(key, value) {
        const next = new URLSearchParams(search);
        if (value && value !== "all" && value !== "name") next.set(key, value);
        else next.delete(key);
        const nextSearch = next.toString();
        navigate(nextSearch ? `/municipalities?${nextSearch}` : "/municipalities");
    }

    function submitSearch(event) {
        event.preventDefault();
        updateQuery("q", searchValue.trim());
    }

    return (
        <div className="page-stack">
            <PageHeader
                description="Find a local government, inspect its record mix, and open the source material behind every entry."
                eyebrow="Directory"
                title="Local governments"
            />

            <section className="directory-summary" aria-label="Directory summary">
                <div>
                    <span className="summary-label">Connected records</span>
                    <strong>{formatNumber(municipalities.length)}</strong>
                    <span>local governments</span>
                </div>
                <div>
                    <span className="summary-label">Policy records</span>
                    <strong>{formatNumber(policies.length)}</strong>
                    <span>across the directory</span>
                </div>
                <div>
                    <span className="summary-label">Coverage</span>
                    <strong>
                        {new Set(municipalities.map((municipality) => municipality.province)).size}
                    </strong>
                    <span>provinces represented</span>
                </div>
            </section>

            <section className="directory-toolbar">
                <SearchField
                    label="Search local governments and policy records"
                    name="directory-search"
                    onChange={(event) => setSearchValue(event.target.value)}
                    onSubmit={submitSearch}
                    placeholder="Search by name, district, code, or record title"
                    value={searchValue}
                />
                <div className="directory-toolbar-filters">
                    <SelectField
                        label="Filter by province"
                        name="province-filter"
                        onChange={(event) => updateQuery("province", event.target.value)}
                        options={provinceOptions}
                        value={queryProvince}
                    />
                    <SelectField
                        label="Sort directory"
                        name="sort-directory"
                        onChange={(event) => updateQuery("sort", event.target.value)}
                        options={[
                            { value: "name", label: "Sort: Name" },
                            { value: "records", label: "Sort: Record count" },
                            { value: "recent", label: "Sort: Recent activity" },
                        ]}
                        value={sortValue}
                    />
                </div>
            </section>

            <div className="directory-result-line">
                <span>
                    {filteredDirectory.length === directory.length
                        ? `Showing ${pluralize(filteredDirectory.length, "local government")}`
                        : `${formatNumber(filteredDirectory.length)} matching ${filteredDirectory.length === 1 ? "government" : "governments"}`}
                </span>
                {(querySearch || queryProvince !== "all" || sortValue !== "name") && (
                    <Link className="text-link text-link-muted" to="/municipalities">
                        Clear filters <Icon name="close" size={14} />
                    </Link>
                )}
            </div>

            {filteredDirectory.length > 0 ? (
                <div className="municipality-grid">
                    {filteredDirectory.map((entry) => (
                        <MunicipalityCard key={entry.municipality.id} {...entry} />
                    ))}
                </div>
            ) : (
                <EmptyState
                    action={
                        <Link className="button button-secondary" to="/municipalities">
                            Reset directory
                        </Link>
                    }
                    description="Try a different name, district, province, or policy title."
                    icon="search"
                    title="No local governments match"
                />
            )}

            <section className="directory-footnote">
                <Icon name="info" size={16} />
                <p>
                    The directory reflects municipalities currently present in the collection
                    database. New targets appear here as soon as their records are loaded.
                </p>
            </section>
        </div>
    );
}
