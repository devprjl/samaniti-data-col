import { useEffect, useMemo, useRef } from "react";
import Icon from "./Icon";
import { formatDateTime, formatDuration, formatNumber } from "../lib/format";
import { Badge, EmptyState } from "./Primitives";

/**
 * Live output of a run started from the scraper workspace.
 *
 * The backend mirrors the scraper's console output while a run is in progress,
 * so it is visible which URLs were visited and where a run stopped, without
 * leaving the browser.
 */
export default function RunLog({ run, onRefresh, refreshing = false, onDismiss }) {
    const logRef = useRef(null);
    const logs = run?.logs || [];
    const result = run?.result || null;
    const isRunning = run?.status === "running";

    useEffect(() => {
        const element = logRef.current;
        if (element && isRunning) {
            element.scrollTop = element.scrollHeight;
        }
    }, [logs.length, isRunning]);

    const metrics = useMemo(() => {
        if (!result) return [];
        return [
            { label: "Pages", value: formatNumber(result.pagesExtracted) },
            { label: "New records", value: formatNumber(result.itemsAdded) },
            { label: "Updated", value: formatNumber(result.itemsUpdated) },
            { label: "Failed pages", value: formatNumber(result.pagesFailed) },
        ];
    }, [result]);

    if (!run) {
        return (
            <EmptyState
                description="Start a run to watch the scraper work. Output from the crawler and the loader appears here."
                icon="terminal"
                title="No run yet"
            />
        );
    }

    return (
        <div className="run-log">
            <div className="run-log-head">
                <div className="run-log-title">
                    <span className="run-log-icon">
                        <Icon name="terminal" size={16} />
                    </span>
                    <div>
                        <strong>{run.key}</strong>
                        <span>
                            {isRunning ? "Running" : "Finished"} ·{" "}
                            {formatDateTime(run.finishedAt || run.startedAt)}
                            {run.pagination ? ` · ${run.pagination.label}` : ""}
                        </span>
                    </div>
                </div>
                <div className="run-log-actions">
                    {run.status === "success" && (
                        <Badge tone="green" dot>
                            Successful
                        </Badge>
                    )}
                    {run.status === "failed" && (
                        <Badge tone="red" dot>
                            Failed
                        </Badge>
                    )}
                    {isRunning && (
                        <Badge tone="blue" dot>
                            Running
                        </Badge>
                    )}
                    {onRefresh && !isRunning && (
                        <button
                            className="button button-secondary button-small"
                            disabled={refreshing}
                            onClick={onRefresh}
                            type="button"
                        >
                            <Icon name="refresh" size={14} />
                            {refreshing ? "Refreshing" : "Reload records"}
                        </button>
                    )}
                    {onDismiss && !isRunning && (
                        <button
                            aria-label="Clear run output"
                            className="icon-button"
                            onClick={onDismiss}
                            type="button"
                        >
                            <Icon name="close" size={15} />
                        </button>
                    )}
                </div>
            </div>

            {!isRunning && run.durationMs != null && (
                <div className="run-log-metrics">
                    <div>
                        <span>Duration</span>
                        <strong>{formatDuration(run.durationMs)}</strong>
                    </div>
                    {metrics.map((metric) => (
                        <div key={metric.label}>
                            <span>{metric.label}</span>
                            <strong>{metric.value}</strong>
                        </div>
                    ))}
                </div>
            )}

            {run.error && <p className="run-log-error">{run.error}</p>}

            <div className="run-log-body" ref={logRef} role="log">
                {logs.length === 0 ? (
                    <p className="run-log-waiting">Waiting for output…</p>
                ) : (
                    logs.map((entry, index) => (
                        <div className={`run-log-line run-log-line-${entry.stream}`} key={index}>
                            {entry.message}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
