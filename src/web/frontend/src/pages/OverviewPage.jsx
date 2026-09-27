import Link from "../components/Link";
import { formatNumber, pluralize } from "../lib/format";
import Icon from "../components/Icon";
import { MetricBar, PageHeader, SectionHeading, StatCard } from "../components/Primitives";
import { ActivityFeed } from "../components/RunTable";
import PolicyTable, { PolicyCategorySummary } from "../components/PolicyTable";

export default function OverviewPage({
    municipalities,
    policies,
    runs,
    directory,
    coverage,
    categoryCounts,
    documentCount,
    successfulRuns,
}) {
    const successRate = runs.length > 0 ? Math.round((successfulRuns / runs.length) * 100) : 0;
    const provinceCount = coverage.length;

    return (
        <div className="page-stack">
            <PageHeader
                action={
                    <Link className="button button-primary" to="/municipalities">
                        Browse local governments <Icon name="arrow-right" size={16} />
                    </Link>
                }
                description="A clear, read-only view of policy records and collection activity from local government portals."
                eyebrow="Public policy records"
                title="Overview"
            />

            <section className="coverage-hero">
                <div className="coverage-hero-copy">
                    <span className="section-kicker">Collection scope</span>
                    <h2>
                        Madhesh <span>+</span> Lumbini
                    </h2>
                    <p>
                        Browse the records currently available in the collection database. Every
                        entry keeps its source link, attachments, and collection lineage close at
                        hand.
                    </p>
                    <div className="coverage-hero-tags">
                        <span>
                            <Icon name="building" size={15} />{" "}
                            {pluralize(municipalities.length, "local government")}
                        </span>
                        <span>
                            <Icon name="database" size={15} />{" "}
                            {pluralize(policies.length, "policy record")}
                        </span>
                    </div>
                </div>
                <div className="coverage-hero-total">
                    <span className="coverage-total-label">Records in view</span>
                    <strong>{formatNumber(policies.length)}</strong>
                    <span className="coverage-total-detail">
                        {formatNumber(documentCount)} source documents attached
                    </span>
                    <div className="coverage-hero-rule" />
                    <span className="coverage-total-detail">
                        <span className="coverage-live-dot" /> {successRate}% of collection runs
                        successful
                    </span>
                </div>
            </section>

            <section aria-label="Portal totals" className="stats-grid">
                <StatCard
                    detail={`${provinceCount} ${provinceCount === 1 ? "province" : "provinces"} represented`}
                    icon="building"
                    label="Local governments"
                    tone="green"
                    value={formatNumber(municipalities.length)}
                />
                <StatCard
                    detail={`${formatNumber(categoryCounts.notice || 0)} notices · ${formatNumber(categoryCounts.project || 0)} projects`}
                    icon="file"
                    label="Policy records"
                    tone="blue"
                    value={formatNumber(policies.length)}
                />
                <StatCard
                    detail="Files linked to policy records"
                    icon="download"
                    label="Source documents"
                    tone="amber"
                    value={formatNumber(documentCount)}
                />
                <StatCard
                    detail={`${formatNumber(successfulRuns)} successful · ${formatNumber(runs.length - successfulRuns)} failed`}
                    icon="activity"
                    label="Collection runs"
                    tone="violet"
                    value={formatNumber(runs.length)}
                />
            </section>

            <div className="overview-grid overview-grid-primary">
                <section className="panel panel-table">
                    <SectionHeading
                        action={
                            <Link className="text-link" to="/municipalities">
                                View directory <Icon name="arrow-right" size={15} />
                            </Link>
                        }
                        description="The newest records across the connected local government portals."
                        eyebrow="Latest additions"
                        title="Policy records"
                    />
                    <PolicyTable
                        emptyDescription="No policy records have been collected yet."
                        emptyTitle="No policy records yet"
                        pageSize={6}
                        policies={policies.slice(0, 6)}
                        showMunicipality
                    />
                </section>

                <section className="panel activity-panel">
                    <SectionHeading
                        action={
                            <Link className="text-link" to="/activity">
                                All runs <Icon name="arrow-right" size={15} />
                            </Link>
                        }
                        description="Latest recorded scraper executions."
                        eyebrow="Collection log"
                        title="Recent activity"
                    />
                    <ActivityFeed
                        municipalityByCode={
                            new Map(
                                directory.map(({ municipality }) => [
                                    municipality.code.toLowerCase(),
                                    municipality,
                                ]),
                            )
                        }
                        municipalityById={
                            new Map(
                                directory.map(({ municipality }) => [
                                    municipality.id,
                                    municipality,
                                ]),
                            )
                        }
                        runs={runs}
                    />
                </section>
            </div>

            <div className="overview-grid overview-grid-secondary">
                <section className="panel coverage-panel">
                    <SectionHeading
                        description="Records grouped by the province stored on each municipality."
                        eyebrow="Data coverage"
                        title="Provincial view"
                    />
                    {coverage.length > 0 ? (
                        <div className="coverage-list">
                            {coverage.map((item) => (
                                <div className="coverage-row" key={item.province}>
                                    <div className="coverage-row-heading">
                                        <div>
                                            <strong>{item.province}</strong>
                                            <span>
                                                {pluralize(
                                                    item.municipalityCount,
                                                    "local government",
                                                )}
                                            </span>
                                        </div>
                                        <strong>{formatNumber(item.policyCount)}</strong>
                                    </div>
                                    <MetricBar
                                        label="Policy records"
                                        total={policies.length}
                                        tone={item.province === "Madhesh" ? "rose" : "green"}
                                        value={item.policyCount}
                                    />
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="panel-note">
                            <Icon name="info" size={17} />
                            <span>No provincial coverage has been recorded yet.</span>
                        </div>
                    )}
                </section>

                <section className="panel mix-panel">
                    <SectionHeading
                        description="A quick view of the record types held in the portal."
                        eyebrow="Record mix"
                        title="Policy categories"
                    />
                    <PolicyCategorySummary policies={policies} />
                    <div className="mix-panel-footer">
                        <span>Source records remain linked to their original portal pages.</span>
                        <Link className="text-link" to="/municipalities">
                            Explore directory <Icon name="arrow-right" size={15} />
                        </Link>
                    </div>
                </section>
            </div>
        </div>
    );
}
