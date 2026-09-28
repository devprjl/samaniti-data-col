import { useEffect, useState } from "react";
import Link from "../components/Link";
import {
    formatBudget,
    formatDate,
    formatDateTime,
    formatNumber,
    getMunicipalityName,
    getPolicyTitle,
} from "../lib/format";
import { getPolicy } from "../lib/api";
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
    // The list endpoint leaves out record bodies so a whole collection fits in a
    // single response, so the body is fetched here. The list copy renders
    // immediately and this fills it in.
    const [full, setFull] = useState(policy);
    const [bodyPending, setBodyPending] = useState(false);

    useEffect(() => {
        setFull(policy);
    }, [policy]);

    useEffect(() => {
        if (!policy?.id || policy.contentNe || policy.contentEn) return undefined;

        let active = true;
        setBodyPending(true);

        getPolicy(policy.id)
            .then((record) => {
                if (active) setFull(record);
            })
            .catch(() => {
                // Keep the list copy; the body panel explains what is missing.
            })
            .finally(() => {
                if (active) setBodyPending(false);
            });

        return () => {
            active = false;
        };
    }, [policy?.id, policy?.contentNe, policy?.contentEn]);

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

    const record = full || policy;
    const backTo = municipality
        ? `/municipalities/${encodeURIComponent(municipality.id)}/policies`
        : "/municipalities";
    const content = record.contentEn || record.contentNe;

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
                                value={formatDate(record.publishedDate || record.createdAt)}
                            />
                            <DetailMeta label="Fiscal year" value={record.fiscalYear} />
                            <DetailMeta
                                label="Record type"
                                value={policy.type?.replace(/[-_]/g, " ")}
                            />
                            {/* Served only by the detail endpoint, so they stay blank
                                until it answers rather than flashing "Not listed". */}
                            <DetailMeta
                                label="Status"
                                value={bodyPending ? null : record.status?.replace(/[-_]/g, " ")}
                            />
                            <DetailMeta
                                label="Ward"
                                value={
                                    bodyPending
                                        ? null
                                        : record.wardNo
                                          ? `Ward ${formatNumber(record.wardNo)}`
                                          : null
                                }
                            />
                            <DetailMeta
                                label="Budget"
                                value={bodyPending ? null : formatBudget(record.budgetAmount)}
                            />
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
                        {bodyPending ? (
                            <div className="panel-note panel-note-spaced" role="status">
                                <Icon name="info" size={17} />
                                <span>Loading the published content…</span>
                            </div>
                        ) : content ? (
                            <div className="record-content">
                                {record.contentEn && <p lang="en">{record.contentEn}</p>}
                                {record.contentNe && <p lang="ne">{record.contentNe}</p>}
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
                                {formatNumber(record.documents?.length || 0)}
                            </span>
                        </div>
                        <PolicyDocuments documents={record.documents} />
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
                                <strong>
                                    {bodyPending ? "—" : formatDateTime(record.updatedAt)}
                                </strong>
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
