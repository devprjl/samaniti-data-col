import { useCallback, useEffect, useMemo, useState } from "react";
import CopyButton from "../components/CopyButton";
import Icon from "../components/Icon";
import Link from "../components/Link";
import PolicyTable from "../components/PolicyTable";
import RouteConfigInspector from "../components/RouteConfigInspector";
import RunLog from "../components/RunLog";
import { SCRAPER_WORKSPACE_DISABLED } from "../lib/api";
import {
    Badge,
    CategoryBadge,
    EmptyState,
    LoadingState,
    PageHeader,
    SearchField,
    SectionHeading,
    SelectField,
    Spinner,
} from "../components/Primitives";
import { getScraperRun, getScraperWorkspace, startScraperRun } from "../lib/api";
import { formatNumber, pluralize } from "../lib/format";
import { collectRouteRecords, groupRoutesByName, normalizeRouteKey } from "../lib/workspace";
import { useRouter } from "../lib/router";

const POLL_INTERVAL_MS = 1500;
const RUN_PHASE_LABEL = { starting: "Starting…", running: "Running…" };

function parseWorkspacePath(pathname) {
    const segments = pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (segments[0] !== "workspace") return {};

    return {
        province: segments[1] || null,
        municipality: segments[2] || null,
        route: segments[3] || null,
    };
}

function targetPath(target, routeName) {
    if (!target) return "/workspace";
    const base = `/workspace/${encodeURIComponent(target.province)}/${encodeURIComponent(target.cleanMun)}`;
    return routeName ? `${base}/${encodeURIComponent(routeName)}` : base;
}

function RunStatusDot({ run }) {
    if (!run) return null;

    const tone = run.status === "success" ? "green" : run.status === "failed" ? "red" : "blue";

    return (
        <span
            className={`route-status-dot route-status-${tone}`}
            title={`Last run: ${run.status}`}
        />
    );
}

/**
 * Launch control for the scraper CLI. The phase turns the same button into the
 * progress indicator for the request it triggered, so the operator can see which
 * of the competing run controls is already busy. `context` names the target for
 * assistive technology, since several of these buttons share the same label.
 */
function RunButton({ className, context, disabled, iconSize = 14, label, onClick, phase, title }) {
    const text = phase ? RUN_PHASE_LABEL[phase] : label;

    return (
        <button
            aria-busy={phase ? true : undefined}
            aria-label={context ? `${text} ${context}` : undefined}
            className={className}
            disabled={disabled}
            onClick={onClick}
            title={phase ? text : title}
            type="button"
        >
            {phase ? <Spinner size={iconSize} /> : <Icon name="play" size={iconSize} />}
            {text}
        </button>
    );
}

function RouteRow({ routeGroup, records, run, isSelected, onSelect, onRun, disabled, phase }) {
    return (
        <li className={`route-row${isSelected ? " route-row-active" : ""}`}>
            <button className="route-row-main" onClick={onSelect} type="button">
                <RunStatusDot run={run} />
                <span className="route-row-copy">
                    <strong>{routeGroup.routeName}</strong>
                    <span className="route-row-meta">
                        <CategoryBadge category={routeGroup.type} />
                        <span className="route-row-count">
                            {formatNumber(records.length)}{" "}
                            {records.length === 1 ? "record" : "records"}
                        </span>
                    </span>
                </span>
            </button>
            <RunButton
                className="button button-secondary button-small route-row-run"
                context={`route ${routeGroup.routeName}`}
                disabled={disabled}
                iconSize={13}
                label="Run"
                onClick={onRun}
                phase={phase}
                title={`Run ${routeGroup.key}`}
            />
        </li>
    );
}

export default function WorkspacePage({ policies, onDataChanged }) {
    const { pathname, navigate } = useRouter();
    const requested = useMemo(() => parseWorkspacePath(pathname), [pathname]);

    const [workspace, setWorkspace] = useState(null);
    const [status, setStatus] = useState("loading");
    const [error, setError] = useState(null);
    const [errorCode, setErrorCode] = useState(null);
    const [run, setRun] = useState(null);
    const [runError, setRunError] = useState(null);
    const [startingKey, setStartingKey] = useState(null);
    const [refreshing, setRefreshing] = useState(false);
    const [paginationMode, setPaginationMode] = useState("default");
    const [filter, setFilter] = useState("");

    const loadWorkspace = useCallback(async () => {
        try {
            const data = await getScraperWorkspace();
            setWorkspace(data);
            setStatus("ready");
            setError(null);
            setErrorCode(null);

            // Re-attach to a run that is already in flight (e.g. after a reload).
            if (data.running?.id) {
                const { job } = await getScraperRun(data.running.id);
                setRun((current) => (current?.id === job.id ? current : job));
            }
        } catch (requestError) {
            setStatus("error");
            setErrorCode(requestError?.code ?? null);
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "The scraper workspace could not be loaded.",
            );
        }
    }, []);

    useEffect(() => {
        loadWorkspace();
    }, [loadWorkspace]);

    // Poll the running job until it finishes.
    useEffect(() => {
        if (!run || run.status !== "running") return undefined;
        const runId = run.id;

        const timer = setInterval(async () => {
            try {
                const { job } = await getScraperRun(runId);
                setRun((current) => (current?.id === job.id ? job : current));

                if (job.status !== "running") {
                    onDataChanged?.();
                    loadWorkspace();
                }
            } catch {
                // Keep polling; a transient error should not stop the run.
            }
        }, POLL_INTERVAL_MS);

        return () => clearInterval(timer);
    }, [run, onDataChanged, loadWorkspace]);

    const targets = useMemo(() => workspace?.targets || [], [workspace]);
    const allRoutes = useMemo(() => workspace?.routes || [], [workspace]);

    /**
     * Resolves the municipality in view. The URL always carries a province and a
     * municipality once a selection has been made, but the lookup degrades
     * gracefully so a hand-edited or partially cleared URL still shows content.
     */
    const target = useMemo(() => {
        if (targets.length === 0) return null;
        if (!requested.province && !requested.municipality) return targets[0];

        const matchesMunicipality = (item) =>
            !requested.municipality ||
            normalizeRouteKey(item.cleanMun) === normalizeRouteKey(requested.municipality) ||
            normalizeRouteKey(item.municipality) === normalizeRouteKey(requested.municipality);
        const matchesProvince = (item) =>
            !requested.province ||
            normalizeRouteKey(item.province) === normalizeRouteKey(requested.province);

        // A single URL segment may name either a province or a municipality.
        if (requested.province && !requested.municipality) {
            const byName = targets.find(
                (item) =>
                    normalizeRouteKey(item.cleanMun) === normalizeRouteKey(requested.province) ||
                    normalizeRouteKey(item.municipality) === normalizeRouteKey(requested.province),
            );
            if (byName) return byName;
        }

        return (
            targets.find((item) => matchesProvince(item) && matchesMunicipality(item)) ||
            targets.find(matchesMunicipality) ||
            targets.find(matchesProvince) ||
            null
        );
    }, [requested, targets]);

    const provinces = useMemo(() => {
        const names = new Set(targets.map((item) => item.province));
        return [...names].sort();
    }, [targets]);

    const municipalities = useMemo(
        () => targets.filter((item) => !target || item.province === target.province),
        [target, targets],
    );

    const routeGroups = useMemo(
        () => groupRoutesByName(allRoutes.filter((route) => route.targetKey === target?.key)),
        [allRoutes, target],
    );

    const activeRouteGroup = useMemo(() => {
        if (!requested.route) return null;
        return (
            routeGroups.find((group) => group.routeName === requested.route) ||
            routeGroups.find(
                (group) =>
                    normalizeRouteKey(group.routeName) === normalizeRouteKey(requested.route),
            ) ||
            null
        );
    }, [requested.route, routeGroups]);

    const recordsByRoute = useMemo(
        () => collectRouteRecords(policies, routeGroups, target),
        [policies, routeGroups, target],
    );

    const municipalityRecordCount = useMemo(
        () => [...recordsByRoute.values()].reduce((total, records) => total + records.length, 0),
        [recordsByRoute],
    );

    const visibleRouteGroups = useMemo(() => {
        const query = filter.trim().toLowerCase();
        if (!query) return routeGroups;
        return routeGroups.filter((group) =>
            [group.routeName, group.key, group.type].join(" ").toLowerCase().includes(query),
        );
    }, [filter, routeGroups]);

    const recentRuns = workspace?.recentRuns || {};
    const activeRun = run?.status === "running" ? run : null;
    const pagination = workspace?.environment?.pagination;

    async function startRun(key) {
        setRunError(null);
        setStartingKey(key);
        try {
            const { job } = await startScraperRun(
                key,
                paginationMode === "default" ? undefined : paginationMode === "all",
            );
            setRun(job);
        } catch (requestError) {
            setRunError(
                requestError instanceof Error
                    ? requestError.message
                    : "The run could not be started.",
            );
        } finally {
            setStartingKey(null);
        }
    }

    /** Phase of the run control that owns `key`, so only that button reports progress. */
    function runPhase(key) {
        if (startingKey === key) return "starting";
        if (activeRun?.key === key) return "running";
        return null;
    }

    function selectRoute(routeName) {
        navigate(targetPath(target, routeName));
    }

    function selectProvince(province) {
        const next = province ? targets.find((item) => item.province === province) : targets[0];
        navigate(targetPath(next));
    }

    function selectMunicipality(cleanMun) {
        const next = targets.find((item) => item.cleanMun === cleanMun) || target;
        navigate(targetPath(next));
    }

    async function reloadRecords() {
        setRefreshing(true);
        try {
            await onDataChanged?.();
        } finally {
            setRefreshing(false);
        }
    }

    if (status === "loading") return <LoadingState label="Loading route configurations" />;

    // A read-only deployment refuses this route on purpose. That is a different
    // situation from the backend being unreachable, and saying so beats an alert
    // that blames a database which is in fact working: the records on every other
    // page are being served from it.
    if (errorCode === SCRAPER_WORKSPACE_DISABLED) {
        return (
            <div className="page-stack">
                <PageHeader
                    description="This deployment serves the collected records only. Scraping runs on a maintainer's machine against the portal, never from the site itself."
                    eyebrow="Scraper control"
                    title="Route workspace"
                />
                <section className="panel workspace-guide-panel">
                    <EmptyState
                        description="Starting a run is a write operation that sends requests to live government portals from this host's address, so it is switched off on a public instance. Everything collected so far is still browsable in the directory, the overview and the record pages."
                        icon="terminal"
                        title="Scraping is disabled on this deployment"
                    />
                    <div className="panel-note">
                        <Icon name="info" size={17} />
                        <span>
                            To collect new records, clone the repository and run{" "}
                            <code>npm run scraper &lt;province&gt;</code> from a machine with
                            database access. The portal picks up the results on its next sync.
                        </span>
                    </div>
                    <div className="workspace-guide-actions">
                        <Link className="button button-secondary" to="/">
                            Back to overview <Icon name="arrow-right" size={15} />
                        </Link>
                        <Link className="button button-secondary" to="/activity">
                            View collection activity
                        </Link>
                    </div>
                </section>
            </div>
        );
    }

    if (status === "error") {
        return (
            <EmptyState
                action={
                    <button className="button button-primary" onClick={loadWorkspace} type="button">
                        Try again
                    </button>
                }
                description={error || "The backend did not answer."}
                icon="alert"
                title="Scraper workspace unavailable"
            />
        );
    }

    if (targets.length === 0) {
        return (
            <EmptyState
                description="No scraper folders were found under src/scrapers."
                icon="alert"
                title="No scrapers discovered"
            />
        );
    }

    const selectedRecords = activeRouteGroup
        ? recordsByRoute.get(activeRouteGroup.routeName) || []
        : [];
    const isBusy = Boolean(activeRun) || Boolean(startingKey);

    return (
        <div className="page-stack workspace-page">
            <PageHeader
                description="Inspect the extraction configuration of every route, run a single route without touching the terminal, and check the records it produced against the live portal."
                eyebrow="Scraper control"
                title="Route workspace"
            >
                <div className="workspace-environment">
                    <Badge tone={pagination?.enabled ? "amber" : "slate"} dot>
                        {pagination?.label || "Pagination setting unavailable"}
                    </Badge>
                    <span>
                        Source: <code>{workspace?.environment?.paginationEnvVar}</code> in{" "}
                        <code>.env</code>
                    </span>
                </div>
            </PageHeader>

            <section className="panel workspace-target-panel">
                <div className="workspace-target-filters">
                    <SelectField
                        label="Province"
                        name="workspace-province"
                        onChange={(event) => selectProvince(event.target.value)}
                        options={[
                            { value: "", label: "All provinces" },
                            ...provinces.map((province) => ({ value: province, label: province })),
                        ]}
                        value={target?.province || ""}
                    />
                    <SelectField
                        label="Municipality"
                        name="workspace-municipality"
                        onChange={(event) => selectMunicipality(event.target.value)}
                        options={[
                            { value: "", label: "All municipalities" },
                            ...municipalities.map((item) => ({
                                value: item.cleanMun,
                                label: item.municipalityName || item.municipality,
                            })),
                        ]}
                        value={target?.cleanMun || ""}
                    />
                    <div className="workspace-key-field">
                        <label htmlFor="workspace-target-key">Target key</label>
                        <div className="workspace-key-input">
                            <code id="workspace-target-key">
                                {target
                                    ? `${target.key}${activeRouteGroup ? `:${activeRouteGroup.routeName}` : ""}`
                                    : "—"}
                            </code>
                            <CopyButton
                                label="Copy"
                                title="Copy the structured target key"
                                value={
                                    target
                                        ? `${target.key}${activeRouteGroup ? `:${activeRouteGroup.routeName}` : ""}`
                                        : ""
                                }
                            />
                        </div>
                    </div>
                </div>

                {!target && (
                    <p className="workspace-target-empty">
                        Select a municipality to list its routes.
                    </p>
                )}

                {target && (
                    <div className="workspace-target-summary">
                        <div>
                            <span className="workspace-target-name">
                                {target.municipalityName || target.municipality}
                            </span>
                            <span className="workspace-target-meta">
                                {target.province} · {pluralize(target.routeCount, "route")} ·{" "}
                                {pluralize(municipalityRecordCount, "record")}
                            </span>
                        </div>
                        <div className="workspace-target-actions">
                            {target.municipalityId && (
                                <a
                                    className="text-link"
                                    href={`/municipalities/${encodeURIComponent(target.municipalityId)}`}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        navigate(
                                            `/municipalities/${encodeURIComponent(target.municipalityId)}`,
                                        );
                                    }}
                                >
                                    Open public page <Icon name="arrow-right" size={15} />
                                </a>
                            )}
                            <RunButton
                                className="button button-secondary"
                                context={`every route of ${target.key}`}
                                disabled={isBusy || !target.runnable}
                                label={`Run all ${routeGroups.length} routes`}
                                onClick={() => startRun(target.key)}
                                phase={runPhase(target.key)}
                            />
                        </div>
                    </div>
                )}
            </section>

            {runError && (
                <div className="error-banner" role="alert">
                    <span className="error-banner-icon">
                        <Icon name="alert" size={17} />
                    </span>
                    <div>
                        <strong>The run could not be started</strong>
                        <p>{runError}</p>
                    </div>
                    <button
                        className="button button-small button-light"
                        onClick={() => setRunError(null)}
                        type="button"
                    >
                        Dismiss
                    </button>
                </div>
            )}

            {(activeRun || startingKey) && (
                <div className="workspace-busy-note">
                    <span className="workspace-busy-pulse" />
                    <span>
                        {activeRun ? "A run is in progress" : "A run is starting"} for{" "}
                        <strong>{activeRun?.key || startingKey}</strong>. Only one run can use the
                        pipeline at a time.
                    </span>
                </div>
            )}

            <div className="workspace-layout">
                <section className="panel workspace-route-panel">
                    <SectionHeading
                        description="Every route declared in this municipality's extract.ts."
                        eyebrow="Routes"
                        title={target ? target.key : "Select a municipality"}
                    />

                    <div className="workspace-route-toolbar">
                        <SearchField
                            label="Filter routes"
                            name="workspace-route-filter"
                            onChange={(event) => setFilter(event.target.value)}
                            placeholder="Filter routes"
                            value={filter}
                        />
                        <span className="workspace-route-total">
                            {formatNumber(visibleRouteGroups.length)} /{" "}
                            {formatNumber(routeGroups.length)}
                        </span>
                    </div>

                    {!target ? (
                        <EmptyState
                            description="Pick a province and municipality to see its routes."
                            icon="layers"
                            title="No municipality selected"
                        />
                    ) : visibleRouteGroups.length === 0 ? (
                        <EmptyState
                            description="No route matches the current filter."
                            icon="search"
                            title="No matching routes"
                        />
                    ) : (
                        <ul className="route-list">
                            {visibleRouteGroups.map((group) => (
                                <RouteRow
                                    disabled={isBusy}
                                    isSelected={activeRouteGroup?.routeName === group.routeName}
                                    key={group.routeName}
                                    onRun={() => startRun(group.key)}
                                    onSelect={() => selectRoute(group.routeName)}
                                    phase={runPhase(group.key)}
                                    records={recordsByRoute.get(group.routeName) || []}
                                    routeGroup={group}
                                    run={recentRuns[group.key]}
                                />
                            ))}
                        </ul>
                    )}
                </section>

                <div className="workspace-detail-stack">
                    {activeRouteGroup ? (
                        <>
                            <section className="panel workspace-config-panel">
                                <div className="section-heading">
                                    <div>
                                        <p className="eyebrow">Extraction configuration</p>
                                        <h2>{activeRouteGroup.routeName}</h2>
                                        <p>
                                            {activeRouteGroup.key} ·{" "}
                                            {pluralize(selectedRecords.length, "collected record")}
                                        </p>
                                    </div>
                                    <div className="workspace-run-controls">
                                        <SelectField
                                            label="Pagination for this run"
                                            name="workspace-pagination-mode"
                                            onChange={(event) =>
                                                setPaginationMode(event.target.value)
                                            }
                                            options={[
                                                {
                                                    value: "default",
                                                    label: `Default (${pagination?.label || "env"})`,
                                                },
                                                {
                                                    value: "first",
                                                    label: "First listing page only",
                                                },
                                                { value: "all", label: "All listing pages" },
                                            ]}
                                            value={paginationMode}
                                        />
                                        <RunButton
                                            className="button button-primary"
                                            context={activeRouteGroup.key}
                                            disabled={isBusy}
                                            label="Run this route"
                                            onClick={() => startRun(activeRouteGroup.key)}
                                            phase={runPhase(activeRouteGroup.key)}
                                        />
                                    </div>
                                </div>

                                <RouteConfigInspector routeGroup={activeRouteGroup} />
                            </section>

                            <section className="panel panel-table">
                                <div className="section-heading">
                                    <div>
                                        <p className="eyebrow">Collected records</p>
                                        <h2>Verify against the portal</h2>
                                        <p>
                                            Records tagged with this route, or collected from its
                                            listing URL. Open a source link to compare with the live
                                            page.
                                        </p>
                                    </div>
                                    <span className="section-count">
                                        {formatNumber(selectedRecords.length)} records
                                    </span>
                                </div>
                                <PolicyTable
                                    emptyDescription="This route has not produced any records yet. Run it to collect the first batch."
                                    emptyIcon="terminal"
                                    emptyTitle="No records for this route"
                                    pageSize={10}
                                    policies={selectedRecords}
                                    resetKey={activeRouteGroup.key}
                                />
                            </section>
                        </>
                    ) : (
                        <section className="panel workspace-guide-panel">
                            <EmptyState
                                description="Choose a route on the left to see the selectors it uses, run it, and inspect the records it produced."
                                icon="layers"
                                title="Select a route"
                            />
                        </section>
                    )}

                    <section className="panel workspace-log-panel">
                        <SectionHeading
                            description="Live output of the most recent run started from this workspace."
                            eyebrow="Run output"
                            title="Console"
                        />
                        <RunLog
                            onDismiss={() => setRun(null)}
                            onRefresh={reloadRecords}
                            refreshing={refreshing}
                            run={run}
                        />
                    </section>
                </div>
            </div>
        </div>
    );
}
