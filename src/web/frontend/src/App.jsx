import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { getPortalData } from "./lib/api";
import { getMunicipalityName } from "./lib/format";
import Link from "./components/Link";
import { useRouter } from "./lib/router";
import AppShell from "./components/AppShell";
import { EmptyState, LoadingState } from "./components/Primitives";
import ActivityPage from "./pages/ActivityPage";
import DirectoryPage from "./pages/DirectoryPage";
import MethodologyPage from "./pages/MethodologyPage";
import MunicipalityPage from "./pages/MunicipalityPage";
import OverviewPage from "./pages/OverviewPage";
import PolicyDetailPage from "./pages/PolicyDetailPage";
import RunDetailPage from "./pages/RunDetailPage";

const emptyPortalData = {
    municipalities: [],
    policies: [],
    scraperRuns: [],
};

function decodeSegment(segment) {
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

function parseRoute(pathname) {
    const segments = pathname.split("/").filter(Boolean).map(decodeSegment);

    if (segments.length === 0) return { page: "overview" };
    if (segments[0] === "municipalities" && !segments[1]) return { page: "municipalities" };
    if (segments[0] === "municipalities" && segments[1]) {
        return { page: "municipality", id: segments[1], tab: segments[2] || "overview" };
    }
    if (segments[0] === "policies" && segments[1]) return { page: "policy", id: segments[1] };
    if (segments[0] === "activity" && segments[1]) return { page: "run", id: segments[1] };
    if (segments[0] === "activity" && segments.length === 1) return { page: "activity" };
    if (segments[0] === "methodology" && segments.length === 1) return { page: "methodology" };

    return { page: "not-found" };
}

function createStats() {
    return {
        policyCount: 0,
        documentCount: 0,
        categories: {},
        lastRun: null,
        lastPolicyAt: null,
    };
}

function isNewerDate(candidate, current) {
    if (!candidate) return false;
    if (!current) return true;
    return new Date(candidate).getTime() > new Date(current).getTime();
}

function NotFoundPage({ pathname }) {
    return (
        <div className="page-stack not-found-page">
            <div className="not-found-code">404</div>
            <h1>Page not found</h1>
            <p>The requested page is not part of the Samaniti policy portal.</p>
            <code>{pathname}</code>
            <Link className="button button-primary" to="/">
                Return to overview
            </Link>
        </div>
    );
}

function App() {
    const { pathname, search } = useRouter();
    const [portalData, setPortalData] = useState(emptyPortalData);
    const [status, setStatus] = useState("loading");
    const [error, setError] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(null);
    const hasLoaded = useRef(false);
    const requestNumber = useRef(0);
    const route = useMemo(() => parseRoute(pathname), [pathname]);

    const loadData = useCallback(async () => {
        const currentRequest = requestNumber.current + 1;
        requestNumber.current = currentRequest;
        setStatus(hasLoaded.current ? "refreshing" : "loading");
        setError(null);

        try {
            const nextData = await getPortalData();
            if (requestNumber.current !== currentRequest) return;

            setPortalData(nextData);
            setLastUpdated(new Date());
            hasLoaded.current = true;
            setStatus("ready");
        } catch (requestError) {
            if (requestNumber.current !== currentRequest) return;
            setError(
                requestError instanceof Error
                    ? requestError.message
                    : "The backend returned an unexpected response.",
            );
            setStatus(hasLoaded.current ? "ready" : "error");
        }
    }, []);

    useEffect(() => {
        loadData();
    }, [loadData]);

    const { municipalities, policies, scraperRuns: runs } = portalData;

    const municipalityById = useMemo(
        () => new Map(municipalities.map((municipality) => [municipality.id, municipality])),
        [municipalities],
    );
    const municipalityByCode = useMemo(
        () =>
            new Map(
                municipalities.map((municipality) => [
                    String(municipality.code || "").toLowerCase(),
                    municipality,
                ]),
            ),
        [municipalities],
    );
    const policyById = useMemo(
        () => new Map(policies.map((policy) => [policy.id, policy])),
        [policies],
    );
    const runById = useMemo(() => new Map(runs.map((run) => [run.id, run])), [runs]);

    const policiesByMunicipality = useMemo(() => {
        const grouped = new Map();

        for (const policy of policies) {
            const group = grouped.get(policy.municipalityId) || [];
            group.push(policy);
            grouped.set(policy.municipalityId, group);
        }

        return grouped;
    }, [policies]);

    const runsByMunicipality = useMemo(() => {
        const grouped = new Map();

        for (const run of runs) {
            const municipalityId =
                run.municipalityId ||
                municipalityByCode.get(String(run.scraperName || "").toLowerCase())?.id;
            if (!municipalityId) continue;
            const group = grouped.get(municipalityId) || [];
            group.push(run);
            grouped.set(municipalityId, group);
        }

        return grouped;
    }, [municipalityByCode, runs]);

    const directory = useMemo(() => {
        const statsByMunicipality = new Map();

        for (const municipality of municipalities) {
            statsByMunicipality.set(municipality.id, createStats());
        }

        for (const policy of policies) {
            const stats = statsByMunicipality.get(policy.municipalityId);
            if (!stats) continue;
            stats.policyCount += 1;
            stats.documentCount += policy.documents?.length || 0;
            const category = String(policy.category || "other").toLowerCase();
            stats.categories[category] = (stats.categories[category] || 0) + 1;
            if (isNewerDate(policy.createdAt, stats.lastPolicyAt))
                stats.lastPolicyAt = policy.createdAt;
        }

        for (const run of runs) {
            const municipalityId =
                run.municipalityId ||
                municipalityByCode.get(String(run.scraperName || "").toLowerCase())?.id;
            const stats = statsByMunicipality.get(municipalityId);
            if (!stats) continue;
            if (isNewerDate(run.startedAt, stats.lastRun?.startedAt)) stats.lastRun = run;
        }

        return municipalities.map((municipality) => ({
            municipality,
            stats: statsByMunicipality.get(municipality.id) || createStats(),
        }));
    }, [municipalities, municipalityByCode, policies, runs]);

    const coverage = useMemo(() => {
        const byProvince = new Map();

        for (const entry of directory) {
            const province = entry.municipality.province || "Unspecified";
            const current = byProvince.get(province) || {
                province,
                municipalityCount: 0,
                policyCount: 0,
                documentCount: 0,
            };
            current.municipalityCount += 1;
            current.policyCount += entry.stats.policyCount;
            current.documentCount += entry.stats.documentCount;
            byProvince.set(province, current);
        }

        return [...byProvince.values()].sort((first, second) =>
            first.province.localeCompare(second.province),
        );
    }, [directory]);

    const categoryCounts = useMemo(
        () =>
            policies.reduce((counts, policy) => {
                const category = String(policy.category || "other").toLowerCase();
                counts[category] = (counts[category] || 0) + 1;
                return counts;
            }, {}),
        [policies],
    );

    const documentCount = useMemo(
        () => policies.reduce((total, policy) => total + (policy.documents?.length || 0), 0),
        [policies],
    );
    const successfulRuns = useMemo(
        () => runs.filter((run) => String(run.status || "").toLowerCase() === "success").length,
        [runs],
    );

    const activeMunicipality =
        route.page === "municipality" ? municipalityById.get(route.id) : null;
    const activePolicy = route.page === "policy" ? policyById.get(route.id) : null;
    const activePolicyMunicipality = activePolicy
        ? municipalityById.get(activePolicy.municipalityId)
        : null;
    const activeRun = route.page === "run" ? runById.get(route.id) : null;
    const activeRunMunicipality = activeRun
        ? activeRun.municipality ||
          municipalityById.get(activeRun.municipalityId) ||
          municipalityByCode.get(String(activeRun.scraperName || "").toLowerCase())
        : null;
    const municipalityName = activeMunicipality
        ? getMunicipalityName(activeMunicipality)
        : activeRunMunicipality
          ? getMunicipalityName(activeRunMunicipality)
          : null;

    let page = null;

    if (status === "loading" && municipalities.length === 0 && policies.length === 0) {
        page = <LoadingState />;
    } else if (status === "error" && municipalities.length === 0 && policies.length === 0) {
        page = (
            <EmptyState
                action={
                    <button className="button button-primary" onClick={loadData} type="button">
                        Try again
                    </button>
                }
                description="Start the backend API or check its connection settings, then retry."
                icon="alert"
                title="Portal data is unavailable"
            />
        );
    } else if (route.page === "overview") {
        page = (
            <OverviewPage
                categoryCounts={categoryCounts}
                coverage={coverage}
                directory={directory}
                documentCount={documentCount}
                municipalities={municipalities}
                policies={policies}
                runs={runs}
                successfulRuns={successfulRuns}
            />
        );
    } else if (route.page === "municipalities") {
        page = (
            <DirectoryPage
                key={search}
                directory={directory}
                municipalities={municipalities}
                policies={policies}
            />
        );
    } else if (route.page === "municipality") {
        page = activeMunicipality ? (
            <MunicipalityPage
                municipality={activeMunicipality}
                municipalityByCode={municipalityByCode}
                municipalityById={municipalityById}
                policies={policiesByMunicipality.get(activeMunicipality.id) || []}
                runs={runsByMunicipality.get(activeMunicipality.id) || []}
                stats={
                    directory.find((entry) => entry.municipality.id === activeMunicipality.id)
                        ?.stats || createStats()
                }
            />
        ) : (
            <NotFoundPage pathname={pathname} />
        );
    } else if (route.page === "policy") {
        page = <PolicyDetailPage municipality={activePolicyMunicipality} policy={activePolicy} />;
    } else if (route.page === "run") {
        page = <RunDetailPage municipality={activeRunMunicipality} run={activeRun} />;
    } else if (route.page === "activity") {
        page = (
            <ActivityPage
                municipalityByCode={municipalityByCode}
                municipalityById={municipalityById}
                municipalities={municipalities}
                runs={runs}
            />
        );
    } else if (route.page === "methodology") {
        page = <MethodologyPage />;
    } else {
        page = <NotFoundPage pathname={pathname} />;
    }

    return (
        <AppShell
            error={error}
            lastUpdated={lastUpdated}
            municipalityName={municipalityName}
            onRefresh={loadData}
            onRetry={loadData}
            route={route}
            status={status}
        >
            {page}
        </AppShell>
    );
}

export default App;
