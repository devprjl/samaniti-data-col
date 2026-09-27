import { useMemo, useState } from "react";
import { formatDateTime, formatDuration, formatNumber, getMunicipalityName } from "../lib/format";
import Link from "./Link";
import Icon from "./Icon";
import { EmptyState, StatusBadge } from "./Primitives";

function RunTarget({ run, municipalityById, municipalityByCode }) {
    const municipality =
        run.municipality ||
        municipalityById.get(run.municipalityId) ||
        municipalityByCode.get(String(run.scraperName || "").toLowerCase());

    if (!municipality) {
        return (
            <span className="table-primary">
                Unlinked run <span className="table-secondary">{run.scraperName}</span>
            </span>
        );
    }

    return (
        <span className="run-target">
            <span className="run-target-name">{getMunicipalityName(municipality)}</span>
            <span className="table-secondary">{run.scraperName}</span>
        </span>
    );
}

export default function RunTable({
    runs,
    municipalityById,
    municipalityByCode,
    pageSize = 8,
    resetKey = "all",
    emptyTitle = "No collection activity found",
    emptyDescription = "There are no scraper runs matching the current view.",
}) {
    const [pagination, setPagination] = useState({ key: resetKey, page: 1 });
    const page = pagination.key === resetKey ? pagination.page : 1;
    const totalPages = Math.max(1, Math.ceil(runs.length / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageItems = useMemo(
        () => runs.slice((safePage - 1) * pageSize, safePage * pageSize),
        [runs, pageSize, safePage],
    );

    function setPage(nextPage) {
        setPagination({
            key: resetKey,
            page: typeof nextPage === "function" ? nextPage(page) : nextPage,
        });
    }

    if (runs.length === 0) {
        return <EmptyState description={emptyDescription} icon="activity" title={emptyTitle} />;
    }

    return (
        <div className="table-component">
            <div className="table-scroll">
                <table className="data-table run-table">
                    <caption className="sr-only">Scraper collection activity</caption>
                    <thead>
                        <tr>
                            <th scope="col">Target</th>
                            <th scope="col">Status</th>
                            <th scope="col">Started</th>
                            <th scope="col">Duration</th>
                            <th scope="col">Added</th>
                            <th scope="col">Updated</th>
                            <th scope="col">Run ID</th>
                        </tr>
                    </thead>
                    <tbody>
                        {pageItems.map((run) => (
                            <tr key={run.id}>
                                <td>
                                    <RunTarget
                                        municipalityByCode={municipalityByCode}
                                        municipalityById={municipalityById}
                                        run={run}
                                    />
                                </td>
                                <td>
                                    <StatusBadge status={run.status} />
                                    {run.error && (
                                        <span className="table-secondary table-error">
                                            Error recorded
                                        </span>
                                    )}
                                </td>
                                <td>
                                    <span className="table-primary">
                                        {formatDateTime(run.startedAt)}
                                    </span>
                                </td>
                                <td>
                                    <span className="table-primary table-mono">
                                        {formatDuration(run.durationMs)}
                                    </span>
                                </td>
                                <td>
                                    <span className="table-number">
                                        {formatNumber(run.itemsAdded)}
                                    </span>
                                </td>
                                <td>
                                    <span className="table-number">
                                        {formatNumber(run.itemsUpdated)}
                                    </span>
                                </td>
                                <td>
                                    <Link
                                        className="run-id"
                                        title={run.id}
                                        to={`/activity/${encodeURIComponent(run.id)}`}
                                    >
                                        {run.id.slice(0, 8)}
                                    </Link>
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
                        {formatNumber(Math.min(safePage * pageSize, runs.length))} of{" "}
                        {formatNumber(runs.length)}
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

export function ActivityFeed({ runs, municipalityById, municipalityByCode }) {
    if (runs.length === 0) {
        return (
            <EmptyState
                description="No scraper runs have been recorded yet."
                icon="activity"
                title="No activity yet"
            />
        );
    }

    return (
        <div className="activity-feed">
            {runs.slice(0, 5).map((run) => {
                const municipality =
                    run.municipality ||
                    municipalityById.get(run.municipalityId) ||
                    municipalityByCode.get(String(run.scraperName || "").toLowerCase());

                return (
                    <div className="activity-item" key={run.id}>
                        <span
                            className={`activity-status activity-status-${run.status === "success" ? "success" : "failed"}`}
                        >
                            <Icon name={run.status === "success" ? "check" : "alert"} size={14} />
                        </span>
                        <div className="activity-item-copy">
                            <strong>
                                {municipality
                                    ? getMunicipalityName(municipality)
                                    : run.scraperName || "Unknown target"}
                            </strong>
                            <span>
                                {formatNumber(run.itemsAdded)} added ·{" "}
                                {formatDateTime(run.startedAt)}
                            </span>
                        </div>
                        <StatusBadge status={run.status} />
                    </div>
                );
            })}
            <Link className="text-link activity-view-all" to="/activity">
                View all activity <Icon name="arrow-right" size={15} />
            </Link>
        </div>
    );
}
