import { formatNumber, getInitials, getMunicipalitySubtitle } from "../lib/format";
import Link from "./Link";
import Icon from "./Icon";
import { Badge, StatusBadge } from "./Primitives";

export default function MunicipalityCard({ municipality, stats }) {
    const subtitle = getMunicipalitySubtitle(municipality);
    const lastRun = stats?.lastRun;
    const categoryEntries = Object.entries(stats?.categories || {}).filter(
        ([, count]) => count > 0,
    );

    return (
        <Link
            className="municipality-card"
            to={`/municipalities/${encodeURIComponent(municipality.id)}`}
        >
            <div className="municipality-card-header">
                <span className="municipality-avatar">
                    {getInitials(municipality.nameEn || municipality.code)}
                </span>
                <div className="municipality-card-heading">
                    <span className="municipality-code">{municipality.code}</span>
                    <h3>{municipality.nameEn || municipality.nameNe}</h3>
                </div>
                <Icon className="card-arrow" name="arrow-up-right" size={17} />
            </div>
            {subtitle && <p className="municipality-card-subtitle">{subtitle}</p>}
            <div className="municipality-location">
                <Icon name="map-pin" size={14} />
                <span>{municipality.district || "District not listed"}</span>
                <span className="location-divider">·</span>
                <span>{municipality.province || "Province not listed"}</span>
            </div>
            <div className="municipality-card-rule" />
            <div className="municipality-card-stats">
                <div>
                    <strong>{formatNumber(stats?.policyCount || 0)}</strong>
                    <span>Records</span>
                </div>
                <div>
                    <strong>{formatNumber(stats?.documentCount || 0)}</strong>
                    <span>Documents</span>
                </div>
                <div className="municipality-card-status">
                    {lastRun ? (
                        <StatusBadge status={lastRun.status} />
                    ) : (
                        <Badge tone="slate">No run data</Badge>
                    )}
                </div>
            </div>
            {categoryEntries.length > 0 && (
                <div className="municipality-card-categories">
                    {categoryEntries.slice(0, 3).map(([category, count]) => (
                        <span key={category}>
                            {category} <strong>{count}</strong>
                        </span>
                    ))}
                </div>
            )}
        </Link>
    );
}
