import Link from "../components/Link";
import { formatDateTime, formatDuration, formatNumber, getMunicipalityName } from "../lib/format";
import Icon from "../components/Icon";
import { EmptyState, PageHeader, StatusBadge } from "../components/Primitives";

function RunMeta({ label, value }) {
    return (
        <div className="detail-meta-item">
            <span>{label}</span>
            <strong>{value || "Not recorded"}</strong>
        </div>
    );
}

export default function RunDetailPage({ run, municipality }) {
    if (!run) {
        return (
            <div className="page-stack">
                <PageHeader
                    description="The requested collection run is not available."
                    eyebrow="Collection run"
                    title="Run not found"
                />
                <EmptyState
                    action={
                        <Link className="button button-primary" to="/activity">
                            Return to activity
                        </Link>
                    }
                    description="The run may have been removed or the link may be incomplete."
                    icon="activity"
                    title="We could not find that run"
                />
            </div>
        );
    }

    return (
        <div className="page-stack">
            <div className="detail-breadcrumb">
                <Link className="back-link" to="/activity">
                    <Icon name="arrow-left" size={15} /> Back to collection activity
                </Link>
            </div>

            <PageHeader
                action={<StatusBadge status={run.status} />}
                description={
                    municipality
                        ? getMunicipalityName(municipality)
                        : run.scraperName || "Unlinked collection target"
                }
                eyebrow="Collection run detail"
                title={`Run ${run.id.slice(0, 8)}`}
            >
                <div className="page-header-identity">
                    <span className="identity-code">{run.scraperName || "UNLINKED"}</span>
                    <span>
                        {municipality
                            ? `${municipality.province} · ${municipality.district}`
                            : "No municipality relationship"}
                    </span>
                </div>
            </PageHeader>

            <section className="panel detail-record-panel">
                <div className="record-panel-heading">
                    <div>
                        <p className="eyebrow">Execution record</p>
                        <h2>Run telemetry</h2>
                    </div>
                    <span className="record-id">{run.id}</span>
                </div>
                <div className="detail-meta-grid">
                    <RunMeta label="Status" value={run.status} />
                    <RunMeta label="Scraper" value={run.scraperName} />
                    <RunMeta label="Started" value={formatDateTime(run.startedAt)} />
                    <RunMeta label="Ended" value={formatDateTime(run.endedAt)} />
                    <RunMeta label="Duration" value={formatDuration(run.durationMs)} />
                    <RunMeta label="Items added" value={formatNumber(run.itemsAdded)} />
                    <RunMeta label="Items updated" value={formatNumber(run.itemsUpdated)} />
                    <RunMeta
                        label="Municipality"
                        value={municipality ? getMunicipalityName(municipality) : "Not linked"}
                    />
                </div>
            </section>

            {run.error ? (
                <section className="panel run-error-panel">
                    <div className="panel-title-row">
                        <div>
                            <p className="eyebrow">Failure detail</p>
                            <h2>Recorded error</h2>
                        </div>
                        <Icon name="alert" size={19} />
                    </div>
                    <pre className="run-error-detail">{run.error}</pre>
                </section>
            ) : (
                <section className="panel run-success-panel">
                    <span className="run-success-icon">
                        <Icon name="check" size={19} />
                    </span>
                    <div>
                        <p className="eyebrow">Execution result</p>
                        <h2>No error was recorded for this run.</h2>
                        <p>The collection process completed according to the stored run status.</p>
                    </div>
                </section>
            )}
        </div>
    );
}
