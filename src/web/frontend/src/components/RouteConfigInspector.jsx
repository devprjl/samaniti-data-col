import CopyButton from "./CopyButton";
import Icon from "./Icon";
import { CategoryBadge } from "./Primitives";
import { selectorEntries, toConfigJson } from "../lib/workspace";

/**
 * One route's extraction configuration, exactly as declared in `extract.ts`.
 *
 * Only the extraction settings are shown — the transformer and the crawler stay
 * out of this view, because checking a route only requires the listing and detail
 * selectors that produced its records.
 */
function ConfigurationBlock({ route }) {
    const selectors = selectorEntries(route);
    const { extraction } = route;

    return (
        <div className="route-config">
            <div className="route-config-grid">
                <div className="route-config-cell">
                    <span>Listing page</span>
                    <a href={extraction.live} rel="noreferrer" target="_blank">
                        {extraction.live}
                        <Icon name="arrow-up-right" size={13} />
                    </a>
                </div>
                <div className="route-config-cell">
                    <span>Entity type</span>
                    <strong>{extraction.type}</strong>
                </div>
                {extraction.detailType && (
                    <div className="route-config-cell">
                        <span>Detail type</span>
                        <strong>{extraction.detailType}</strong>
                    </div>
                )}
                {extraction.baseUrl && (
                    <div className="route-config-cell">
                        <span>Base URL</span>
                        <strong>{extraction.baseUrl}</strong>
                    </div>
                )}
            </div>

            <div className="route-selector-list">
                {selectors.length === 0 ? (
                    <p className="muted-copy">This route has no CSS selectors configured.</p>
                ) : (
                    selectors.map((entry) => (
                        <div className="route-selector" key={entry.field}>
                            <div className="route-selector-label">
                                <span>{entry.label}</span>
                                <code>{entry.field}</code>
                            </div>
                            <div className="route-selector-value">
                                <code>{entry.value}</code>
                                <CopyButton
                                    label="Copy"
                                    title={`Copy ${entry.label.toLowerCase()}`}
                                    value={entry.value}
                                />
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div className="route-config-footer">
                <span className="route-config-source">
                    <Icon name="code" size={14} />
                    {route.sourceFile} · entry {route.position}
                </span>
                <CopyButton
                    label="Copy config as JSON"
                    title="Copy this route configuration as JSON"
                    value={toConfigJson(route)}
                />
            </div>
        </div>
    );
}

export default function RouteConfigInspector({ routeGroup }) {
    const { routeName, type, configurations } = routeGroup;

    return (
        <div className="route-inspector">
            <div className="route-inspector-head">
                <div className="route-inspector-title">
                    <h3>{routeName}</h3>
                    <CategoryBadge category={type} />
                    {configurations.length > 1 && (
                        <span className="route-config-count">
                            {configurations.length} configurations
                        </span>
                    )}
                </div>
            </div>

            {configurations.length > 1 && (
                <p className="route-inspector-note">
                    This route is declared more than once in the same file. Running the route
                    executes every configuration below.
                </p>
            )}

            <div className="route-inspector-configs">
                {configurations.map((route) => (
                    <ConfigurationBlock
                        key={`${route.position}-${route.extraction.detailSelector || ""}`}
                        route={route}
                    />
                ))}
            </div>
        </div>
    );
}
