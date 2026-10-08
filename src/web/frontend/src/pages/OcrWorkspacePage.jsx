import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CopyButton from "../components/CopyButton";
import Icon from "../components/Icon";
import Link from "../components/Link";
import {
    ActionButton,
    Badge,
    EmptyState,
    LoadingState,
    MetricBar,
    NumberField,
    PageHeader,
    SectionHeading,
    SelectField,
    StatCard,
} from "../components/Primitives";
import {
    enqueueOcrJobs,
    getDocumentDownloadUrl,
    getOcrDocuments,
    getOcrWorkspace,
    SCRAPER_WORKSPACE_DISABLED,
} from "../lib/api";
import { formatDateTime, formatNumber, pluralize } from "../lib/format";

/** How often the backlog is re-read. The worker drains a batch in minutes, not hours. */
const POLL_INTERVAL_MS = 5000;

/** Batch sizes offered next to the free-text field, so the common case is one click. */
const BATCH_PRESETS = [10, 50, 100, 500];

/** Ceiling the backend clamps to; the field is capped to match so the two agree. */
const MAX_BATCH = 5000;

const DEFAULT_BATCH = 50;

/** Every status, in pipeline order, so the breakdown reads as a progression. */
const STATUS_META = [
    { key: "pending", label: "Pending", tone: "slate" },
    { key: "queued", label: "Queued", tone: "blue" },
    { key: "processing", label: "Processing", tone: "amber" },
    { key: "completed", label: "Completed", tone: "green" },
    { key: "failed", label: "Failed", tone: "rose" },
    { key: "skipped", label: "Skipped", tone: "slate" },
];

function readBatch(value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_BATCH;
    return Math.min(Math.max(1, parsed), MAX_BATCH);
}

/** "1 document" / "12 documents", for text where the count is not the whole phrase. */
function documents(count) {
    return count === 1 ? "document" : "documents";
}

/** Feedback for the last enqueue, so the batch size on screen is not the only result. */
function enqueueTone(count) {
    if (count === 0) return "amber";
    return "green";
}

/**
 * Where a document can actually be opened.
 *
 * A stored copy is served by the API and the browser cannot know where on the
 * scraper's disk it lives, so that case goes through the download route. With no
 * local copy the original portal URL is the only thing there is.
 */
function documentHref(document) {
    return document.hasLocalCopy ? getDocumentDownloadUrl(document.id) : document.originalUrl;
}

/**
 * A list of documents with their source URLs.
 *
 * The URL is the point: the operator wants to open the file and judge whether it
 * is worth converting before committing a batch, and a filename alone does not
 * tell them that. It is shown in full rather than truncated, wrapping instead,
 * because a clipped URL is a URL that cannot be read or copied.
 */
function DocumentList({
    countLabel,
    documents,
    emptyDescription,
    emptyTitle,
    error,
    onRetry,
    scopeName,
    statusLabels,
}) {
    return (
        <div className="ocr-documents">
            <div className="ocr-documents-head">
                <div>
                    <span className="ocr-documents-count">{countLabel}</span>
                    <span className="ocr-documents-scope">{scopeName}</span>
                </div>
                {documents.length > 0 && (
                    <CopyButton
                        label={`Copy ${documents.length} URLs`}
                        title="Copy every source URL in this list, one per line"
                        value={documents.map((document) => document.originalUrl).join("\n")}
                    />
                )}
            </div>

            {error ? (
                <div className="ocr-documents-error" role="alert">
                    <Icon name="alert" size={16} />
                    <span>{error}</span>
                    {onRetry && (
                        <button
                            className="button button-small button-light"
                            onClick={onRetry}
                            type="button"
                        >
                            Retry
                        </button>
                    )}
                </div>
            ) : documents.length === 0 ? (
                <EmptyState description={emptyDescription} icon="file" title={emptyTitle} />
            ) : (
                <ul className="ocr-document-list">
                    {documents.map((document) => (
                        <li className="ocr-document-row" key={document.id}>
                            <div className="ocr-document-copy">
                                <strong title={document.fileName}>{document.fileName}</strong>
                                <a
                                    className="ocr-document-url"
                                    href={document.originalUrl}
                                    rel="noreferrer"
                                    target="_blank"
                                    title={document.originalUrl}
                                >
                                    {document.originalUrl}
                                </a>
                            </div>
                            <div className="ocr-document-tags">
                                {document.previousStatus &&
                                    document.previousStatus !== "pending" && (
                                        <Badge tone="amber">
                                            retry of {document.previousStatus}
                                        </Badge>
                                    )}
                                {statusLabels?.get(document.id) && (
                                    <Badge tone="slate">was {statusLabels.get(document.id)}</Badge>
                                )}
                                <a
                                    className="text-link ocr-document-open"
                                    href={documentHref(document)}
                                    rel="noreferrer"
                                    target="_blank"
                                >
                                    {document.hasLocalCopy ? "Stored copy" : "Open source"}
                                    <Icon name="external" size={13} />
                                </a>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

export default function OcrWorkspacePage() {
    const [status, setStatus] = useState(null);
    const [pageState, setPageState] = useState("loading");
    const [loadError, setLoadError] = useState(null);
    const [errorCode, setErrorCode] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [pendingAction, setPendingAction] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [batchInput, setBatchInput] = useState(String(DEFAULT_BATCH));
    const [municipalityCode, setMunicipalityCode] = useState("");
    const [history, setHistory] = useState([]);
    const [notice, setNotice] = useState(null);
    const [preview, setPreview] = useState(null);
    const [previewError, setPreviewError] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [lastQueued, setLastQueued] = useState(null);

    const enqueueingRef = useRef(false);

    const loadStatus = useCallback(async () => {
        try {
            const data = await getOcrWorkspace();
            setStatus(data);
            setPageState("ready");
            setLoadError(null);
            setErrorCode(null);
        } catch (requestError) {
            setErrorCode(requestError?.code ?? null);
            // The status is kept because "the API could not be reached" and "the API
            // answered and failed" are different problems with different fixes, and
            // collapsing them into one sentence is what makes a schema fault look
            // like a dead server.
            setLoadError({
                message:
                    requestError instanceof Error
                        ? requestError.message
                        : "The OCR workspace could not be loaded.",
                status: typeof requestError?.status === "number" ? requestError.status : null,
            });
            setPageState((current) => (current === "ready" ? "ready" : "error"));
        }
    }, []);

    useEffect(() => {
        loadStatus();
    }, [loadStatus]);

    // The worker is a separate process, so the only way to watch it drain the
    // queue is to re-read the backlog. Polling is paused while an enqueue is in
    // flight so the response that reports its own result is the last one applied.
    useEffect(() => {
        if (pendingAction !== null) return undefined;
        const timer = setInterval(() => {
            loadStatus().catch(() => {});
        }, POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [pendingAction, loadStatus]);

    const batch = readBatch(batchInput);

    /**
     * The documents the current scope and batch size would queue.
     *
     * Re-read whenever either changes, so the list an operator is looking at is
     * always the list the buttons beside it would act on. A failure here is kept
     * separate from the backlog's: the counts can still be perfectly good while
     * the preview fails, and replacing the whole page with an error would throw
     * away information the operator can act on.
     */
    const loadPreview = useCallback(async () => {
        setPreviewing(true);
        try {
            const data = await getOcrDocuments({
                limit: batch,
                municipalityCode: municipalityCode || null,
            });
            setPreview(data);
            setPreviewError(null);
        } catch (requestError) {
            setPreview(null);
            setPreviewError(
                requestError instanceof Error
                    ? requestError.message
                    : "The document list could not be loaded.",
            );
        } finally {
            setPreviewing(false);
        }
    }, [batch, municipalityCode]);

    useEffect(() => {
        loadPreview();
    }, [loadPreview, pageState]);

    const counts = status?.counts || {};
    const total = status?.total ?? 0;
    const municipalities = useMemo(() => status?.municipalities || [], [status]);

    const scope = useMemo(() => {
        const selected = municipalities.find((item) => item.code === municipalityCode);
        return {
            code: selected?.code || null,
            name: selected?.name || "All municipalities",
            pending: selected ? selected.pending : (counts.pending ?? 0),
        };
    }, [municipalities, municipalityCode, counts.pending]);

    // A reclaimed document is worth flagging: the operator queued something that
    // was already `failed` or stuck, and that is not obvious from a filename.
    const previewStatusLabels = useMemo(() => {
        const labels = new Map();
        for (const document of preview?.documents || []) {
            if (document.ocrStatus && document.ocrStatus !== "pending") {
                labels.set(document.id, document.ocrStatus);
            }
        }
        return labels;
    }, [preview]);

    const queueLength = status?.queueLength ?? null;
    const queueReachable = queueLength !== null;
    const isBusy = pendingAction !== null;

    async function runEnqueue(all) {
        if (enqueueingRef.current) return;

        const action = all ? "all" : "batch";
        setPendingAction(action);
        setActionError(null);
        setNotice(null);
        enqueueingRef.current = true;

        try {
            const result = await enqueueOcrJobs({
                all,
                limit: batch,
                municipalityCode: scope.code,
            });

            setStatus(result);
            setNotice({
                tone: enqueueTone(result.enqueuedCount),
                title:
                    result.enqueuedCount === 0
                        ? "Nothing left to queue"
                        : `${formatNumber(result.enqueuedCount)} ${documents(result.enqueuedCount)} queued`,
                detail:
                    result.enqueuedCount === 0
                        ? "Every eligible document in this scope already has a job. Documents stranded by an earlier run come back after the stale-queued window passes."
                        : `Pushed onto ${result.queueName} for ${result.scope}. ${
                              result.queueLength === null
                                  ? "Queue depth is unknown; Redis did not answer."
                                  : `${formatNumber(result.queueLength)} now waiting on the worker.`
                          } The exact files are listed below.`,
            });
            // What actually went on the queue, straight from the claim, so it can be
            // checked against the preview that preceded it.
            setLastQueued({
                at: new Date().toISOString(),
                documents: result.documents || [],
                scope: result.scope,
            });
            setHistory((entries) =>
                [
                    {
                        id: `${Date.now()}-${entries.length}`,
                        at: new Date().toISOString(),
                        scope: result.scope,
                        requested: all ? "all pending" : pluralize(batch, "document"),
                        enqueuedCount: result.enqueuedCount,
                        queueLength: result.queueLength,
                    },
                    ...entries,
                ].slice(0, 12),
            );
        } catch (requestError) {
            setActionError(
                requestError instanceof Error
                    ? requestError.message
                    : "The documents could not be queued.",
            );
        } finally {
            enqueueingRef.current = false;
            setPendingAction(null);
            // Read the backlog again: on a failure the producer rolls the claim
            // back, and the numbers on screen have to say so.
            loadStatus().catch(() => {});
            loadPreview().catch(() => {});
        }
    }

    async function refresh() {
        setRefreshing(true);
        try {
            await loadStatus();
        } finally {
            setRefreshing(false);
        }
    }

    if (pageState === "loading") return <LoadingState label="Loading OCR backlog" />;

    // Production refuses this route on purpose, with a 403. That is a different
    // situation from the backend being unreachable, and saying so beats an alert
    // that blames a database which is in fact working: the records on every other
    // page are being served from it.
    if (errorCode === SCRAPER_WORKSPACE_DISABLED) {
        return (
            <div className="page-stack">
                <PageHeader
                    description="This deployment serves the collected records only. Document OCR runs on a maintainer's machine, never from the site itself."
                    eyebrow="OCR control"
                    title="Document OCR"
                >
                    <div className="workspace-environment">
                        <Badge className="badge-sentence" dot tone="slate">
                            Queue controls unavailable
                        </Badge>
                        <span>Read-only deployment</span>
                    </div>
                </PageHeader>
                <section className="panel workspace-guide-panel">
                    <EmptyState
                        description="Queuing documents is a write operation and text extraction is processor-heavy, so both are disabled in production. Documents are processed and stored locally in development."
                        icon="terminal"
                        title="Forbidden: OCR is disabled in production"
                    />
                    <div className="panel-note">
                        <Icon name="info" size={17} />
                        <span>
                            To process documents locally, start the docker containers for postgres,
                            redis and ocr-service, then run the app in development mode. From the
                            terminal, <code>npm run ocr:enqueue</code> does the same thing this page
                            does.
                        </span>
                    </div>
                    <div className="workspace-guide-actions">
                        <Link className="button button-secondary" to="/">
                            Back to overview <Icon name="arrow-right" size={15} />
                        </Link>
                        <Link className="button button-secondary" to="/methodology">
                            How documents are processed
                        </Link>
                    </div>
                </section>
            </div>
        );
    }

    if (pageState === "error") {
        // A 5xx means the API is running and refused to answer this query, which
        // for a fresh checkout is almost always a database that predates the OCR
        // columns rather than anything to do with the workspace guard.
        const serverFailed = loadError?.status >= 500;

        return (
            <div className="page-stack">
                <PageHeader
                    description={
                        serverFailed
                            ? "The API is up and refused the request. This is a fault in the database or the OCR service, not the workspace being turned off."
                            : "The portal could not reach the API that reports the OCR backlog."
                    }
                    eyebrow="OCR control"
                    title="Document OCR"
                />
                <section className="panel workspace-guide-panel">
                    <EmptyState
                        action={
                            <button
                                className="button button-primary"
                                onClick={loadStatus}
                                type="button"
                            >
                                Try again
                            </button>
                        }
                        description={
                            serverFailed
                                ? "The API answered with an error instead of the backlog. The reason is in its log: docker logs lgwebscraper-app. If it names a missing documents column, the database is behind prisma/schema.prisma and npm run db:push brings it up to date."
                                : "Start the backend API or check its connection settings, then retry."
                        }
                        icon="alert"
                        title={
                            serverFailed
                                ? "The API could not read the OCR backlog"
                                : "The OCR workspace is unreachable"
                        }
                    />
                    {serverFailed && (
                        <div className="panel-note">
                            <Icon name="info" size={17} />
                            <span>
                                This is not the production guard. That one answers 403 with the code{" "}
                                <code>scraper_workspace_disabled</code> and is explained on the
                                page; a 500 means the workspace is served and the query behind it
                                failed.
                            </span>
                        </div>
                    )}
                    <div className="workspace-guide-actions">
                        <Link className="button button-secondary" to="/workspace">
                            Scraper workspace <Icon name="arrow-right" size={15} />
                        </Link>
                        <Link className="button button-secondary" to="/">
                            Back to overview
                        </Link>
                    </div>
                </section>
            </div>
        );
    }

    return (
        <div className="page-stack workspace-page">
            <PageHeader
                description="Watch the backlog left by the scraper, push a chosen number of documents onto the Redis job queue, and see what the OCR worker has made of them so far."
                eyebrow="OCR control"
                title="Document OCR"
            >
                <div className="workspace-environment">
                    <Badge className="badge-sentence" dot tone={queueReachable ? "green" : "red"}>
                        {queueReachable
                            ? `${formatNumber(queueLength)} waiting in Redis`
                            : "Redis unreachable"}
                    </Badge>
                    <span>
                        Queue: <code>{status?.queueName || "ocr:jobs"}</code> in{" "}
                        <code>REDIS_URL</code>
                    </span>
                </div>
            </PageHeader>

            {loadError && (
                <div className="error-banner" role="alert">
                    <span className="error-banner-icon">
                        <Icon name="alert" size={17} />
                    </span>
                    <div>
                        <strong>The backlog could not be re-read</strong>
                        <p>
                            {loadError.message} The numbers below are from the last successful read.
                        </p>
                    </div>
                    <button
                        className="button button-small button-light"
                        onClick={refresh}
                        type="button"
                    >
                        Retry
                    </button>
                </div>
            )}

            <section className="panel">
                <div className="ocr-panel-heading">
                    <SectionHeading
                        description="Counts per status the documents table can be in, and the share of the collection each one holds. A document is only counted once."
                        eyebrow="Backlog"
                        title="Queue status"
                    />
                    <div className="ocr-panel-actions">
                        <ActionButton
                            busyLabel="Refreshing…"
                            className="button button-secondary"
                            disabled={isBusy || refreshing}
                            iconName="refresh"
                            label="Refresh"
                            onClick={refresh}
                            phase={refreshing ? "running" : null}
                        />
                    </div>
                </div>

                <div className="ocr-stats-grid stats-grid stats-grid-detail">
                    <StatCard
                        detail={
                            queueReachable ? "Jobs waiting for the worker" : "Redis did not answer"
                        }
                        icon="layers"
                        label="Redis queue"
                        tone="blue"
                        value={queueReachable ? formatNumber(queueLength) : "—"}
                    />
                    <StatCard
                        detail="Eligible to be queued now"
                        icon="clock"
                        label="Pending"
                        tone="amber"
                        value={formatNumber(counts.pending)}
                    />
                    <StatCard
                        detail="Waiting for a worker"
                        icon="download"
                        label="Queued"
                        tone="blue"
                        value={formatNumber(counts.queued)}
                    />
                    <StatCard
                        detail="Being converted right now"
                        icon="activity"
                        label="Processing"
                        tone="amber"
                        value={formatNumber(counts.processing)}
                    />
                    <StatCard
                        detail="Text extracted and stored"
                        icon="check"
                        label="Completed"
                        tone="green"
                        value={formatNumber(counts.completed)}
                    />
                    <StatCard
                        detail="Needs a retry or a manual decision"
                        icon="alert"
                        label="Failed"
                        tone="rose"
                        value={formatNumber(counts.failed)}
                    />
                </div>

                <div className="ocr-breakdown">
                    <p className="ocr-breakdown-label">
                        Share of the collection by status, out of {pluralize(total, "document")}.
                    </p>
                    {STATUS_META.map((entry) => (
                        <MetricBar
                            key={entry.key}
                            label={entry.label}
                            tone={entry.tone}
                            total={total}
                            value={counts[entry.key] || 0}
                        />
                    ))}
                    {status?.unlinked > 0 && (
                        <p className="ocr-unlinked-note">
                            <Icon name="info" size={14} />
                            <span>
                                {pluralize(status.unlinked, "document")} cannot be attributed to a
                                municipality, so the filter cannot reach them.
                            </span>
                        </p>
                    )}
                </div>
            </section>

            <section className="panel workspace-target-panel">
                <SectionHeading
                    description="Queueing claims each document before pushing it, so nothing is sent twice and a failed push is rolled back."
                    eyebrow="Queue control"
                    title="Enqueue documents"
                />

                <div className="workspace-target-filters">
                    <SelectField
                        label="Municipality"
                        name="ocr-municipality"
                        onChange={(event) => setMunicipalityCode(event.target.value)}
                        options={[
                            { value: "", label: "All municipalities" },
                            ...municipalities.map((item) => ({
                                value: item.code,
                                label: `${item.name} (${formatNumber(item.pending)} pending)`,
                            })),
                        ]}
                        value={municipalityCode}
                    />
                    <div className="ocr-batch-field">
                        <label htmlFor="ocr-batch-size">Batch size</label>
                        <div className="ocr-batch-input">
                            <NumberField
                                label="Batch size"
                                max={MAX_BATCH}
                                name="ocr-batch-size"
                                onChange={(event) => setBatchInput(event.target.value)}
                                value={batchInput}
                            />
                            <div className="ocr-batch-presets">
                                {BATCH_PRESETS.map((preset) => (
                                    <button
                                        aria-label={`${formatNumber(preset)} documents per batch`}
                                        aria-pressed={batch === preset}
                                        className="ocr-batch-preset"
                                        key={preset}
                                        onClick={() => setBatchInput(String(preset))}
                                        type="button"
                                    >
                                        {formatNumber(preset)}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="workspace-target-summary">
                    <div>
                        <span className="workspace-target-name">{scope.name}</span>
                        <span className="ocr-scope-meta">
                            {pluralize(scope.pending, "document")} pending ·{" "}
                            {pluralize(total, "document")} tracked in total
                        </span>
                    </div>
                    <div className="workspace-target-actions">
                        <ActionButton
                            busyLabel="Queueing…"
                            className="button button-primary"
                            context={`${formatNumber(batch)} documents for ${scope.name}`}
                            disabled={isBusy || !queueReachable || scope.pending === 0}
                            iconName="play"
                            label={`Enqueue ${formatNumber(batch)} documents`}
                            onClick={() => runEnqueue(false)}
                            phase={pendingAction === "batch" ? "queueing" : null}
                            title={
                                queueReachable
                                    ? `Push the next ${formatNumber(batch)} pending documents onto ${status?.queueName}`
                                    : "Redis is unreachable, so nothing can be queued"
                            }
                        />
                        <ActionButton
                            busyLabel="Queueing everything…"
                            className="button button-secondary"
                            context={`every pending document for ${scope.name}`}
                            disabled={isBusy || !queueReachable || scope.pending === 0}
                            iconName="layers"
                            label={`Enqueue all ${formatNumber(scope.pending)}`}
                            onClick={() => runEnqueue(true)}
                            phase={pendingAction === "all" ? "queueing" : null}
                            title={
                                queueReachable
                                    ? `Push every pending document for ${scope.name} in one request`
                                    : "Redis is unreachable, so nothing can be queued"
                            }
                        />
                    </div>
                </div>

                {scope.pending === 0 && (
                    <div className="panel-note">
                        <Icon name="info" size={17} />
                        <span>
                            Nothing is pending in this scope. A document that was claimed but never
                            processed becomes eligible again once it has sat in <code>queued</code>{" "}
                            or <code>processing</code> past the stale window, and the ETL re-queues
                            new documents as it loads them.
                        </span>
                    </div>
                )}

                {actionError && (
                    <div className="error-banner" role="alert">
                        <span className="error-banner-icon">
                            <Icon name="alert" size={17} />
                        </span>
                        <div>
                            <strong>The documents could not be queued</strong>
                            <p>{actionError}</p>
                        </div>
                        <button
                            className="button button-small button-light"
                            onClick={() => setActionError(null)}
                            type="button"
                        >
                            Dismiss
                        </button>
                    </div>
                )}

                {notice && (
                    <div className={`ocr-notice ocr-notice-${notice.tone}`} role="status">
                        <span className="ocr-notice-icon">
                            <Icon name={notice.tone === "green" ? "check" : "info"} size={17} />
                        </span>
                        <div>
                            <strong>{notice.title}</strong>
                            <p>{notice.detail}</p>
                        </div>
                        <button
                            aria-label="Dismiss enqueue result"
                            className="icon-button"
                            onClick={() => setNotice(null)}
                            type="button"
                        >
                            <Icon name="close" size={15} />
                        </button>
                    </div>
                )}
            </section>

            {isBusy && (
                <div className="workspace-busy-note">
                    <span className="workspace-busy-pulse" />
                    <span>
                        Pushing documents onto <strong>{status?.queueName}</strong> for{" "}
                        <strong>{scope.name}</strong>. This claims every document in the batch at
                        once, so a large sweep takes a moment.
                    </span>
                </div>
            )}

            {lastQueued && lastQueued.documents.length > 0 && (
                <section className="panel workspace-log-panel">
                    <SectionHeading
                        description="Reported by the claim itself, so this is exactly what went onto the queue rather than a re-read that might have moved since."
                        eyebrow="Last enqueue"
                        title={`What was queued · ${lastQueued.scope}`}
                    />
                    <DocumentList
                        countLabel={`${pluralize(lastQueued.documents.length, "document")} pushed at ${formatDateTime(lastQueued.at)}`}
                        documents={lastQueued.documents}
                        scopeName={lastQueued.scope}
                    />
                </section>
            )}

            <section className="panel workspace-log-panel">
                <SectionHeading
                    description={`The documents the buttons above would queue right now, in the order the claim takes them. Open any of them to check it is worth converting.${
                        previewing ? " Re-reading as the scope changes…" : ""
                    }`}
                    eyebrow="Queue order"
                    title="Up next"
                />
                <DocumentList
                    countLabel={
                        preview && preview.total > preview.shown
                            ? `First ${formatNumber(preview.shown)} of ${formatNumber(preview.total)} eligible`
                            : preview
                              ? pluralize(preview.total, "eligible document")
                              : "Reading the queue order…"
                    }
                    documents={preview?.documents || []}
                    emptyDescription={
                        scope.pending === 0
                            ? "Nothing in this scope is eligible. Documents stranded by an earlier run reappear once they have sat in queued or processing past the stale window."
                            : "No document in this scope is eligible to be queued."
                    }
                    emptyTitle="Nothing queued from this scope"
                    error={previewError}
                    onRetry={loadPreview}
                    scopeName={scope.name}
                    statusLabels={previewStatusLabels}
                />
            </section>

            <section className="panel workspace-log-panel">
                <SectionHeading
                    description="Batches queued from this page. The claim is idempotent, so re-running one never doubles up a document."
                    eyebrow="Enqueue output"
                    title="History"
                />
                {history.length === 0 ? (
                    <EmptyState
                        description="Queue a batch to see what was sent, how deep the queue got, and which scope it came from."
                        icon="terminal"
                        title="No batches queued yet"
                    />
                ) : (
                    <ul className="ocr-history">
                        {history.map((entry) => (
                            <li className="ocr-history-row" key={entry.id}>
                                <span
                                    className={`activity-status activity-status-${
                                        entry.enqueuedCount > 0 ? "success" : "failed"
                                    }`}
                                >
                                    <Icon
                                        name={entry.enqueuedCount > 0 ? "check" : "info"}
                                        size={14}
                                    />
                                </span>
                                <div className="ocr-history-copy">
                                    <strong>
                                        {entry.enqueuedCount > 0
                                            ? `${formatNumber(entry.enqueuedCount)} ${documents(entry.enqueuedCount)}`
                                            : "Nothing eligible"}
                                    </strong>
                                    <span>
                                        {entry.scope} · asked for {entry.requested} ·{" "}
                                        {formatDateTime(entry.at)}
                                    </span>
                                </div>
                                <span className="ocr-history-queue">
                                    {entry.queueLength === null
                                        ? "Queue unknown"
                                        : `${formatNumber(entry.queueLength)} waiting`}
                                </span>
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
