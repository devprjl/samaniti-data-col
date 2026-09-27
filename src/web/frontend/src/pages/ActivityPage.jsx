import { useMemo, useState } from "react";
import Link from "../components/Link";
import { formatDuration, formatNumber, pluralize } from "../lib/format";
import Icon from "../components/Icon";
import RunTable from "../components/RunTable";
import { PageHeader, SearchField, SelectField, StatCard } from "../components/Primitives";

export default function ActivityPage({
    runs,
    municipalities,
    municipalityById,
    municipalityByCode,
}) {
    const [searchValue, setSearchValue] = useState("");
    const [status, setStatus] = useState("all");
    const [province, setProvince] = useState("all");

    const filteredRuns = useMemo(() => {
        const normalized = searchValue.trim().toLowerCase();
        return runs.filter((run) => {
            const municipality =
                run.municipality ||
                municipalityById.get(run.municipalityId) ||
                municipalityByCode.get(String(run.scraperName || "").toLowerCase());
            const matchesStatus = status === "all" || run.status === status;
            const matchesProvince = province === "all" || municipality?.province === province;
            const matchesSearch =
                !normalized ||
                [
                    run.scraperName,
                    run.status,
                    run.id,
                    municipality?.nameEn,
                    municipality?.nameNe,
                    municipality?.code,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
                    .includes(normalized);
            return matchesStatus && matchesProvince && matchesSearch;
        });
    }, [municipalityByCode, municipalityById, province, runs, searchValue, status]);

    const successfulRuns = runs.filter((run) => run.status === "success").length;
    const totalItems = runs.reduce(
        (total, run) => total + Number(run.itemsAdded || 0) + Number(run.itemsUpdated || 0),
        0,
    );
    const averageDuration =
        runs.length > 0
            ? Math.round(
                  runs.reduce((total, run) => total + Number(run.durationMs || 0), 0) / runs.length,
              )
            : 0;
    const provinceOptions = [
        { value: "all", label: "All provinces" },
        ...[
            ...new Set(municipalities.map((municipality) => municipality.province).filter(Boolean)),
        ].map((value) => ({
            value,
            label: value,
        })),
    ];

    return (
        <div className="page-stack">
            <PageHeader
                description="A complete, auditable view of scraper executions, record counts, and collection outcomes."
                eyebrow="Collection telemetry"
                title="Collection activity"
            />

            <section className="stats-grid stats-grid-detail">
                <StatCard
                    detail="All recorded executions"
                    icon="activity"
                    label="Total runs"
                    tone="violet"
                    value={formatNumber(runs.length)}
                />
                <StatCard
                    detail="Successful collection runs"
                    icon="check"
                    label="Successful"
                    tone="green"
                    value={formatNumber(successfulRuns)}
                />
                <StatCard
                    detail="Added and updated records"
                    icon="layers"
                    label="Items touched"
                    tone="blue"
                    value={formatNumber(totalItems)}
                />
                <StatCard
                    detail="Average execution time"
                    icon="clock"
                    label="Average duration"
                    tone="amber"
                    value={formatDuration(averageDuration)}
                />
            </section>

            <section className="panel panel-table">
                <div className="activity-toolbar">
                    <div>
                        <p className="eyebrow">Execution log</p>
                        <h2>All scraper runs</h2>
                        <p>{pluralize(filteredRuns.length, "run")} shown in the current view.</p>
                    </div>
                    <div className="activity-filters">
                        <SearchField
                            label="Search collection activity"
                            name="activity-search"
                            onChange={(event) => setSearchValue(event.target.value)}
                            placeholder="Search target or run ID"
                            value={searchValue}
                        />
                        <SelectField
                            label="Filter by run status"
                            name="run-status-filter"
                            onChange={(event) => setStatus(event.target.value)}
                            options={[
                                { value: "all", label: "All statuses" },
                                { value: "success", label: "Successful" },
                                { value: "failed", label: "Failed" },
                            ]}
                            value={status}
                        />
                        <SelectField
                            label="Filter by province"
                            name="activity-province-filter"
                            onChange={(event) => setProvince(event.target.value)}
                            options={provinceOptions}
                            value={province}
                        />
                    </div>
                </div>
                <div className="activity-table-label">
                    <span>
                        Showing {formatNumber(filteredRuns.length)} of {formatNumber(runs.length)}{" "}
                        recorded runs
                    </span>
                    <span>Newest first</span>
                </div>
                <RunTable
                    emptyDescription="No runs match the selected filters."
                    emptyTitle="No matching activity"
                    municipalityByCode={municipalityByCode}
                    municipalityById={municipalityById}
                    resetKey={`${searchValue}-${status}-${province}`}
                    runs={filteredRuns}
                />
            </section>

            <section className="activity-note-grid">
                <div className="activity-note">
                    <Icon name="database" size={18} />
                    <div>
                        <strong>Source of truth</strong>
                        <span>Every row is read from the ScraperRun collection.</span>
                    </div>
                </div>
                <div className="activity-note">
                    <Icon name="clock" size={18} />
                    <div>
                        <strong>Execution timing</strong>
                        <span>Durations are reported as recorded by the collection process.</span>
                    </div>
                </div>
                <Link className="activity-note activity-note-link" to="/methodology">
                    <Icon name="book" size={18} />
                    <div>
                        <strong>How collection works</strong>
                        <span>Read the data guide for field definitions.</span>
                    </div>
                    <Icon name="arrow-right" size={15} />
                </Link>
            </section>
        </div>
    );
}
