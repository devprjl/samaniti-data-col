import Icon from "./Icon";

export function Brand({ compact = false }) {
    return (
        <span className={`brand-lockup${compact ? " brand-lockup-compact" : ""}`}>
            <span className="brand-mark">
                <Icon name="mark" size={compact ? 22 : 24} strokeWidth={1.65} />
            </span>
            <span className="brand-copy">
                <strong>Samaniti</strong>
                {!compact && <span>Policy portal</span>}
            </span>
        </span>
    );
}

export function PageHeader({ eyebrow, title, description, action, children }) {
    return (
        <header className="page-header">
            <div className="page-header-copy">
                {eyebrow && <p className="eyebrow">{eyebrow}</p>}
                <h1>{title}</h1>
                {description && <p className="page-description">{description}</p>}
                {children}
            </div>
            {action && <div className="page-header-action">{action}</div>}
        </header>
    );
}

export function StatCard({ icon, label, value, detail, tone = "green" }) {
    return (
        <article className={`stat-card stat-card-${tone}`}>
            <div className="stat-card-topline">
                <span className="stat-label">{label}</span>
                <span className="stat-icon">
                    <Icon name={icon} size={17} />
                </span>
            </div>
            <strong className="stat-value">{value}</strong>
            <span className="stat-detail">{detail}</span>
        </article>
    );
}

export function Badge({ children, tone = "slate", dot = false }) {
    return (
        <span className={`badge badge-${tone}`}>
            {dot && <span className="badge-dot" />}
            {children}
        </span>
    );
}

export function StatusBadge({ status }) {
    const normalized = String(status || "unknown").toLowerCase();
    const tone =
        normalized === "success" || normalized === "completed"
            ? "green"
            : normalized === "failed" || normalized === "error"
              ? "red"
              : "slate";
    const label =
        normalized === "success"
            ? "Successful"
            : normalized === "failed"
              ? "Failed"
              : normalized || "Unknown";

    return (
        <Badge tone={tone} dot>
            {label}
        </Badge>
    );
}

export function CategoryBadge({ category }) {
    const meta = categoryMeta(category);
    return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

function categoryMeta(category) {
    const normalized = String(category || "other").toLowerCase();
    const labels = {
        notice: ["Notice", "blue"],
        project: ["Project", "green"],
        report: ["Report", "amber"],
        budget: ["Budget", "violet"],
        tender: ["Tender", "slate"],
        decision: ["Decision", "rose"],
    };
    const [label, tone] = labels[normalized] || [
        String(category || "Other").replace(/[-_]/g, " "),
        "slate",
    ];

    return { label, tone };
}

export function EmptyState({ icon = "file", title, description, action }) {
    return (
        <div className="empty-state">
            <span className="empty-state-icon">
                <Icon name={icon} size={22} />
            </span>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
            {action}
        </div>
    );
}

export function LoadingState({ label = "Loading portal data" }) {
    return (
        <div className="loading-state" role="status" aria-live="polite">
            <span className="loading-mark">
                <span />
                <span />
                <span />
            </span>
            <span>{label}</span>
        </div>
    );
}

export function ErrorBanner({ message, onRetry }) {
    return (
        <div className="error-banner" role="alert">
            <span className="error-banner-icon">
                <Icon name="alert" size={17} />
            </span>
            <div>
                <strong>Data connection unavailable</strong>
                <p>
                    {message ||
                        "The portal could not reach the backend. Start the API and try again."}
                </p>
            </div>
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
    );
}

export function SelectField({ label, value, onChange, options, name }) {
    return (
        <label className="field-control" htmlFor={name}>
            <span className="sr-only">{label}</span>
            <select id={name} name={name} onChange={onChange} value={value}>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>
                        {option.label}
                    </option>
                ))}
            </select>
            <Icon name="chevron-down" size={15} />
        </label>
    );
}

export function SearchField({
    label = "Search",
    value,
    onChange,
    onSubmit,
    placeholder,
    name = "search",
}) {
    return (
        <form className="search-field" onSubmit={onSubmit} role="search">
            <Icon name="search" size={17} />
            <label className="sr-only" htmlFor={name}>
                {label}
            </label>
            <input
                autoComplete="off"
                id={name}
                name={name}
                onChange={onChange}
                placeholder={placeholder || label}
                type="search"
                value={value}
            />
            {value && (
                <button
                    aria-label="Clear search"
                    className="search-clear"
                    onClick={() => onChange({ target: { value: "" } })}
                    type="button"
                >
                    <Icon name="close" size={14} />
                </button>
            )}
        </form>
    );
}

export function SectionHeading({ eyebrow, title, description, action }) {
    return (
        <div className="section-heading">
            <div>
                {eyebrow && <p className="eyebrow">{eyebrow}</p>}
                <h2>{title}</h2>
                {description && <p>{description}</p>}
            </div>
            {action}
        </div>
    );
}

export function MetricBar({ label, value, total, tone = "green" }) {
    const percentage = total > 0 ? Math.round((value / total) * 100) : 0;

    return (
        <div className="metric-bar-row">
            <div className="metric-bar-label">
                <span>{label}</span>
                <strong>{value}</strong>
            </div>
            <div className="metric-bar-track">
                <span
                    className={`metric-bar-fill metric-bar-${tone}`}
                    style={{ width: `${percentage}%` }}
                />
            </div>
        </div>
    );
}
