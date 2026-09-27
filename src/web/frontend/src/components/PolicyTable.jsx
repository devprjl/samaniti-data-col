import { useMemo, useState } from "react";
import { getDocumentDownloadUrl } from "../lib/api";
import {
    formatDate,
    formatNumber,
    getCategoryMeta,
    getMunicipalityName,
    getPolicySubtitle,
    getPolicyTitle,
} from "../lib/format";
import Link from "./Link";
import Icon from "./Icon";
import { CategoryBadge, EmptyState } from "./Primitives";

function DocumentCount({ documents }) {
    const count = documents?.length || 0;

    if (count === 0) return <span className="muted-value">None</span>;

    return (
        <span className="document-count">
            <Icon name="file" size={15} />
            {formatNumber(count)}
        </span>
    );
}

function SourceLink({ policy }) {
    if (!policy.sourceUrl) return <span className="muted-value">Unavailable</span>;

    return (
        <a
            className="source-link"
            href={policy.sourceUrl}
            onClick={(event) => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
        >
            View source
            <Icon name="arrow-up-right" size={14} />
        </a>
    );
}

function PolicyTitle({ policy }) {
    const subtitle = getPolicySubtitle(policy);

    return (
        <div className="policy-title-cell">
            <Link className="policy-title-link" to={`/policies/${encodeURIComponent(policy.id)}`}>
                <span>{getPolicyTitle(policy)}</span>
            </Link>
            {subtitle && <span className="policy-subtitle">{subtitle}</span>}
        </div>
    );
}

export function PolicyDocuments({ documents, compact = false }) {
    const files = documents || [];

    if (files.length === 0) {
        return <span className="muted-value">No attached documents</span>;
    }

    return (
        <div className={`document-list${compact ? " document-list-compact" : ""}`}>
            {files.map((document) => (
                <a
                    className="document-link"
                    href={getDocumentDownloadUrl(document.id)}
                    key={document.id}
                    rel="noreferrer"
                    target="_blank"
                >
                    <span className="document-link-icon">
                        <Icon name="download" size={14} />
                    </span>
                    <span className="document-link-copy">
                        <strong>{document.fileName || "Download document"}</strong>
                        <span>
                            {document.downloadStatus === "ok" ? "Stored file" : "Open source file"}
                        </span>
                    </span>
                    <Icon name="arrow-up-right" size={14} />
                </a>
            ))}
        </div>
    );
}

export default function PolicyTable({
    policies,
    pageSize = 8,
    showMunicipality = false,
    resetKey = "all",
    emptyTitle = "No policy records found",
    emptyDescription = "There are no records matching the current view.",
    emptyIcon = "file",
}) {
    const [pagination, setPagination] = useState({ key: resetKey, page: 1 });
    const page = pagination.key === resetKey ? pagination.page : 1;
    const totalPages = Math.max(1, Math.ceil(policies.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageItems = useMemo(
        () => policies.slice((safePage - 1) * pageSize, safePage * pageSize),
        [policies, pageSize, safePage],
    );

    function setPage(nextPage) {
        setPagination({
            key: resetKey,
            page: typeof nextPage === "function" ? nextPage(page) : nextPage,
        });
    }

    if (policies.length === 0) {
        return <EmptyState description={emptyDescription} icon={emptyIcon} title={emptyTitle} />;
    }

    return (
        <div className="table-component">
            <div className="table-scroll">
                <table className="data-table policy-table">
                    <caption className="sr-only">Policy records</caption>
                    <thead>
                        <tr>
                            <th scope="col">Record</th>
                            {showMunicipality && <th scope="col">Local government</th>}
                            <th scope="col">Category</th>
                            <th scope="col">Published</th>
                            <th scope="col">Fiscal year</th>
                            <th scope="col">Documents</th>
                            <th scope="col">Source</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageItems.map((policy) => (
                            <tr key={policy.id}>
                                <td>
                                    <PolicyTitle policy={policy} />
                                </td>
                                {showMunicipality && (
                                    <td>
                                        <span className="table-primary">
                                            {getMunicipalityName(policy.municipality)}
                                        </span>
                                    </td>
                                )}
                                <td>
                                    <CategoryBadge category={policy.category} />
                                    {policy.type && (
                                        <span className="table-secondary">
                                            {policy.type.replace(/[-_]/g, " ")}
                                        </span>
                                    )}
                                </td>
                                <td>
                                    <span className="table-primary">
                                        {formatDate(policy.publishedDate || policy.createdAt)}
                                    </span>
                                </td>
                                <td>
                                    <span className="table-primary">
                                        {policy.fiscalYear || "—"}
                                    </span>
                                </td>
                                <td>
                                    <DocumentCount documents={policy.documents} />
                                </td>
                                <td>
                                    <SourceLink policy={policy} />
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {totalPages > 1 && (
                <div className="table-footer">
                    <span>
                        Showing {formatNumber((safePage - 1) * pageSize + 1)}–
                        {formatNumber(Math.min(safePage * pageSize, policies.length))} of{" "}
                        {formatNumber(policies.length)}
                    </span>
                    <div className="pagination-controls">
                        <button
                            aria-label="Previous page"
                            className="pagination-button"
                            disabled={safePage === 1}
                            onClick={() => setPage((current) => Math.max(1, current - 1))}
                            type="button"
                        >
                            <Icon name="chevron-left" size={15} />
                        </button>
                        <span>
                            Page {safePage} of {totalPages}
                        </span>
                        <button
                            aria-label="Next page"
                            className="pagination-button"
                            disabled={safePage === totalPages}
                            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                            type="button"
                        >
                            <Icon name="chevron-right" size={15} />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export function PolicyCategorySummary({ policies }) {
    const counts = policies.reduce((summary, policy) => {
        const key = String(policy.category || "other").toLowerCase();
        summary[key] = (summary[key] || 0) + 1;
        return summary;
    }, {});

    const entries = Object.entries(counts).sort(([, first], [, second]) => second - first);

    if (entries.length === 0) {
        return <p className="muted-copy">No record mix available.</p>;
    }

    return (
        <div className="category-summary">
            {entries.map(([category, count]) => {
                const meta = getCategoryMeta(category);
                return (
                    <div className="category-summary-row" key={category}>
                        <span className={`category-summary-mark category-summary-${meta.tone}`} />
                        <span>{meta.label}</span>
                        <strong>{formatNumber(count)}</strong>
                    </div>
                );
            })}
        </div>
    );
}
