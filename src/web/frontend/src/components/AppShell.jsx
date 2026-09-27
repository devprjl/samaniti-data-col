import { useEffect, useRef, useState } from "react";
import Link from "./Link";
import { useRouter } from "../lib/router";
import { formatDateTime } from "../lib/format";
import Icon from "./Icon";
import { Brand, ErrorBanner } from "./Primitives";

const primaryNavigation = [
    { to: "/", label: "Overview", icon: "overview" },
    { to: "/municipalities", label: "Local governments", icon: "building" },
    { to: "/activity", label: "Collection activity", icon: "activity" },
    { to: "/methodology", label: "Data guide", icon: "book" },
];

function getBreadcrumbs(route, municipalityName) {
    switch (route.page) {
        case "municipality":
            return [
                { label: "Local governments", to: "/municipalities" },
                { label: municipalityName || "Municipality" },
            ];
        case "policy":
            return [{ label: "Policy records", to: "/municipalities" }, { label: "Record detail" }];
        case "activity":
            return [{ label: "Collection activity" }];
        case "run":
            return [{ label: "Collection activity", to: "/activity" }, { label: "Run detail" }];
        case "methodology":
            return [{ label: "Data guide" }];
        default:
            return [{ label: "Overview" }];
    }
}

export default function AppShell({
    route,
    municipalityName,
    status,
    lastUpdated,
    error,
    onRetry,
    onRefresh,
    children,
}) {
    const { navigate } = useRouter();
    const [searchValue, setSearchValue] = useState("");
    const searchInputRef = useRef(null);
    const breadcrumbs = getBreadcrumbs(route, municipalityName);

    useEffect(() => {
        function focusSearch(event) {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                searchInputRef.current?.focus();
            }
        }

        window.addEventListener("keydown", focusSearch);
        return () => window.removeEventListener("keydown", focusSearch);
    }, []);

    function submitSearch(event) {
        event.preventDefault();
        const query = searchValue.trim();
        navigate(query ? `/municipalities?q=${encodeURIComponent(query)}` : "/municipalities");
    }

    return (
        <div className="app-shell">
            <aside className="sidebar">
                <div className="sidebar-top">
                    <Link aria-label="Samaniti policy portal home" className="brand-link" to="/">
                        <Brand />
                    </Link>
                    <div className="sidebar-rule" />
                    <p className="sidebar-kicker">Public records workspace</p>
                    <nav aria-label="Primary navigation" className="primary-nav">
                        {primaryNavigation.map((item) => {
                            const isActive =
                                item.to === "/"
                                    ? route.page === "overview"
                                    : route.page === item.to.slice(1) ||
                                      (item.to === "/municipalities" &&
                                          ["municipality", "policy"].includes(route.page)) ||
                                      (item.to === "/activity" && route.page === "run");

                            return (
                                <Link
                                    aria-current={isActive ? "page" : undefined}
                                    className={`nav-item${isActive ? " nav-item-active" : ""}`}
                                    key={item.to}
                                    to={item.to}
                                >
                                    <Icon name={item.icon} size={18} />
                                    <span>{item.label}</span>
                                    {item.to === "/activity" && (
                                        <span
                                            className="nav-indicator"
                                            aria-label="Activity available"
                                        />
                                    )}
                                </Link>
                            );
                        })}
                    </nav>
                </div>

                <div className="sidebar-bottom">
                    <div className="coverage-note">
                        <span className="coverage-note-mark">
                            <Icon name="layers" size={16} />
                        </span>
                        <div>
                            <strong>Madhesh + Lumbini</strong>
                            <span>Provincial collection scope</span>
                        </div>
                    </div>
                    <div className="sidebar-meta">
                        <span>Samaniti data portal</span>
                        <span>v1.0 · Read-only</span>
                    </div>
                </div>
            </aside>

            <div className="app-body">
                <header className="topbar">
                    <div className="topbar-mobile-brand">
                        <Brand compact />
                    </div>
                    <nav aria-label="Breadcrumb" className="breadcrumbs">
                        {breadcrumbs.map((crumb, index) => (
                            <span className="breadcrumb-item" key={`${crumb.label}-${index}`}>
                                {index > 0 && <Icon name="chevron-right" size={14} />}
                                {crumb.to ? (
                                    <Link to={crumb.to}>{crumb.label}</Link>
                                ) : (
                                    <span>{crumb.label}</span>
                                )}
                            </span>
                        ))}
                    </nav>
                    <form className="global-search" onSubmit={submitSearch} role="search">
                        <Icon name="search" size={17} />
                        <label className="sr-only" htmlFor="global-search">
                            Search policy records
                        </label>
                        <input
                            autoComplete="off"
                            id="global-search"
                            onChange={(event) => setSearchValue(event.target.value)}
                            placeholder="Search records or local governments"
                            ref={searchInputRef}
                            type="search"
                            value={searchValue}
                        />
                        <kbd>⌘ K</kbd>
                    </form>
                    <div className="topbar-actions">
                        <span className={`connection-status connection-status-${status}`}>
                            <span className="connection-dot" />
                            {status === "loading"
                                ? "Connecting"
                                : status === "refreshing"
                                  ? "Refreshing"
                                  : status === "error"
                                    ? "Unavailable"
                                    : "Live data"}
                        </span>
                        <button
                            aria-label="Refresh portal data"
                            className="icon-button"
                            disabled={status === "loading" || status === "refreshing"}
                            onClick={onRefresh}
                            title="Refresh data"
                            type="button"
                        >
                            <Icon name="refresh" size={17} />
                        </button>
                    </div>
                </header>

                <main className="page-content">
                    {error && <ErrorBanner message={error} onRetry={onRetry} />}
                    {lastUpdated && status !== "loading" && (
                        <div className="sync-line">
                            <span>Last synced {formatDateTime(lastUpdated)}</span>
                            <span className="sync-separator">·</span>
                            <span>Source: collection database</span>
                        </div>
                    )}
                    {children}
                </main>

                <footer className="site-footer">
                    <span>Samaniti Policy Portal</span>
                    <span>Public data, clearly presented.</span>
                </footer>
            </div>
        </div>
    );
}
