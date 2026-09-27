import Link from "../components/Link";
import {
    formatBudget,
    formatDate,
    formatDateTime,
    formatNumber,
    getMunicipalityName,
    getPolicyTitle,
} from "../lib/format";
import Icon from "../components/Icon";
import { PolicyDocuments } from "../components/PolicyTable";
import { CategoryBadge, EmptyState, PageHeader } from "../components/Primitives";

function DetailMeta({ label, value }) {
    return (
        <div className="detail-meta-item">
            <span>{label}</span>
            <strong>{value || "Not listed"}</strong>
        </div>
    );
}

export default function PolicyDetailPage({ policy, municipality }) {
    if (!policy) {
        return (
            <div className="page-stack">
                <PageHeader
                    description="The requested record is not available in the current data set."
                    eyebrow="Policy record"
                    title="Record not found"
                />
                <EmptyState
                    action={
                        <Link className="button button-primary" to="/municipalities">
                            Return to directory
                        </Link>
                    }
                    description="The record may have been removed or the link may be incomplete."
                    icon="search"
                    title="We could not find that record"
                />
            </div>
        );
    }

    const backTo = municipality
        ? `/municipalities/${encodeURIComponent(municipality.id)}/policies`
        : "/municipalities";
    const content = policy.contentEn || policy.contentNe;

    return (
        <div className="page-stack">
            <div className="detail-breadcrumb">
                <Link className="back-link" to={backTo}>
                    <Icon name="arrow-left" size={15} /> Back to policy records
                </Link>
            </div>

            <PageHeader
                action={
                    policy.sourceUrl ? (
                        <a
                            className="button button-secondary"
                            href={policy.sourceUrl}
                            rel="noreferrer"
                            target="_blank"
                        >
                            Open source page <Icon name="arrow-up-right" size={15} />
                        </a>
                    ) : null
                }
                description={
                    municipality
                        ? `${getMunicipalityName(municipality)} · ${municipality.province}`
                        : undefined
                }
                eyebrow="Policy record detail"
                title={getPolicyTitle(policy)}
            >
                <div className="page-header-identity">
                    <CategoryBadge category={policy.category} />
                    {policy.type && (
                        <span className="identity-type">{policy.type.replace(/[-_]/g, " ")}</span>
                    )}
                </div>
            </PageHeader>

            <div className="policy-detail-layout">
                <div className="policy-detail-main">
                    <section className="panel detail-record-panel">
                        <div className="record-panel-heading">
                            <div>
                                <p className="eyebrow">Record information</p>
                                <h2>Published details</h2>
                            </div>
                            <span className="record-id">ID {policy.id.slice(0, 8)}</span>
                        </div>
                        <div className="detail-meta-grid">
                            <DetailMeta
                                label="Local government"
                                value={municipality ? getMunicipalityName(municipality) : null}
                            />
                            <DetailMeta
                                label="Published date"
                                value={formatDate(policy.publishedDate || policy.createdAt)}
                            />
                            <DetailMeta label="Fiscal year" value={policy.fiscalYear} />
                            <DetailMeta
                                label="Record type"
                                value={policy.type?.replace(/[-_]/g, " ")}
                            />
                            <DetailMeta
                                label="Status"
                                value={policy.status?.replace(/[-_]/g, " ")}
                            />
                            <DetailMeta
                                label="Ward"
                                value={policy.wardNo ? `Ward ${formatNumber(policy.wardNo)}` : null}
                            />
                            <DetailMeta label="Budget" value={formatBudget(policy.budgetAmount)} />
                            <DetailMeta
                                label="Source language"
                                value={
                                    policy.titleEn && policy.titleNe
                                        ? "English + Nepali"
                                        : policy.titleEn
                                          ? "English"
                                          : "Nepali"
                                }
                            />
                        </div>
                    </section>

                    <section className="panel content-panel">
                        <div className="panel-title-row">
                            <div>
                                <p className="eyebrow">Record body</p>
                                <h2>Published content</h2>
                            </div>
                            <Icon name="file" size={20} />
                        </div>
                        {content ? (
                            <div className="record-content">
                                {policy.contentEn && <p lang="en">{policy.contentEn}</p>}
                                {policy.contentNe && <p lang="ne">{policy.contentNe}</p>}
                            </div>
                        ) : (
                            <div className="panel-note panel-note-spaced">
                                <Icon name="info" size={17} />
                                <span>
                                    No body text was captured for this record. Use the source page
                                    or attached document for the full publication.
                                </span>
                            </div>
                        )}
                    </section>
                </div>

                <aside className="policy-detail-aside">
                    <section className="panel documents-panel">
                        <div className="panel-title-row">
                            <div>
                                <p className="eyebrow">Source material</p>
                                <h2>Documents</h2>
                            </div>
                            <span className="section-count">
                                {formatNumber(policy.documents?.length || 0)}
                            </span>
                        </div>
                        <PolicyDocuments documents={policy.documents} />
                    </section>

                    <section className="panel provenance-panel">
                        <div className="panel-title-row">
                            <div>
                                <p className="eyebrow">Provenance</p>
                                <h2>Record trail</h2>
                            </div>
                            <Icon name="link" size={18} />
                        </div>
                        <div className="provenance-list">
                            <div>
                                <span>Source captured</span>
                                <strong>{formatDateTime(policy.createdAt)}</strong>
                            </div>
                            <div>
                                <span>Last updated</span>
                                <strong>{formatDateTime(policy.updatedAt)}</strong>
                            </div>
                            {municipality && (
                                <div>
                                    <span>Local government code</span>
                                    <strong>{municipality.code}</strong>
                                </div>
                            )}
                        </div>
                        {policy.sourceUrl && (
                            <a
                                className="provenance-link"
                                href={policy.sourceUrl}
                                rel="noreferrer"
                                target="_blank"
                            >
                                View original source <Icon name="arrow-up-right" size={14} />
                            </a>
                        )}
                    </section>
                </aside>
            </div>
        </div>
    );
}
