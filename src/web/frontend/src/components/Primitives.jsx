import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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

export function Badge({ children, className = "", tone = "slate", dot = false }) {
    return (
        <span className={`badge badge-${tone} ${className}`.trim()}>
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

/** Inline activity indicator for controls that wait on a request. */
export function Spinner({ size = 14 }) {
    return <span aria-hidden="true" className="spinner" style={{ height: size, width: size }} />;
}

const POPOVER_MARGIN = 10;
const POPOVER_GAP = 6;
const POPOVER_MIN_HEIGHT = 140;
const POPOVER_FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Resolves where the panel goes and how tall it may grow. The side with more room
 * wins, and the returned `maxHeight` keeps a long list inside the viewport.
 */
function placePopover(anchorRect, height, width) {
    const spaceBelow = window.innerHeight - anchorRect.bottom - POPOVER_GAP - POPOVER_MARGIN;
    const spaceAbove = anchorRect.top - POPOVER_GAP - POPOVER_MARGIN;
    const opensAbove = spaceAbove > spaceBelow;
    const maxHeight = Math.max(POPOVER_MIN_HEIGHT, opensAbove ? spaceAbove : spaceBelow);
    const top = opensAbove
        ? anchorRect.top - POPOVER_GAP - Math.min(height, maxHeight)
        : anchorRect.bottom + POPOVER_GAP;
    const furthestLeft = Math.max(POPOVER_MARGIN, window.innerWidth - width - POPOVER_MARGIN);

    return {
        left: Math.min(Math.max(anchorRect.left, POPOVER_MARGIN), furthestLeft),
        maxHeight,
        top: Math.max(top, POPOVER_MARGIN),
    };
}

/**
 * Panel anchored to a trigger element.
 *
 * It renders into a portal because the tables it is used from scroll horizontally,
 * which would clip anything positioned inside a cell. Dismissal follows the usual
 * menu conventions: outside pointer press, Escape and arrow-key traversal.
 */
export function Popover({ anchor, onClose, label, width = 340, children }) {
    const panelRef = useRef(null);
    const closeRef = useRef(onClose);
    const [position, setPosition] = useState(null);

    // The listeners below live for as long as the panel is open, so the latest
    // callback is kept in a ref instead of resubscribing on every parent render.
    useEffect(() => {
        closeRef.current = onClose;
    }, [onClose]);

    useLayoutEffect(() => {
        if (!anchor) return undefined;

        function update() {
            const rect = anchor.getBoundingClientRect();
            const offscreen =
                rect.bottom < 0 ||
                rect.top > window.innerHeight ||
                rect.right < 0 ||
                rect.left > window.innerWidth;

            // A panel anchored to a row that scrolled away is just noise.
            if (offscreen) {
                closeRef.current();
                return;
            }

            const height = panelRef.current ? panelRef.current.offsetHeight : 0;
            setPosition(placePopover(rect, height, width));
        }

        update();
        panelRef.current?.focus();
        window.addEventListener("resize", update);
        window.addEventListener("scroll", update, true);
        return () => {
            window.removeEventListener("resize", update);
            window.removeEventListener("scroll", update, true);
        };
    }, [anchor, width]);

    useEffect(() => {
        if (!anchor) return undefined;

        function handlePointerDown(event) {
            if (panelRef.current?.contains(event.target) || anchor.contains(event.target)) return;
            onClose();
        }

        function handleKeyDown(event) {
            if (event.key === "Escape") {
                onClose();
                anchor.focus();
                return;
            }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;

            const items = [...(panelRef.current?.querySelectorAll(POPOVER_FOCUSABLE) || [])];
            if (items.length === 0) return;

            event.preventDefault();
            const step = event.key === "ArrowDown" ? 1 : -1;
            const current = items.indexOf(document.activeElement);
            const next =
                current === -1
                    ? step === 1
                        ? 0
                        : items.length - 1
                    : (current + step + items.length) % items.length;
            items[next].focus();
        }

        document.addEventListener("keydown", handleKeyDown);
        document.addEventListener("pointerdown", handlePointerDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            document.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [anchor, onClose]);

    if (!anchor) return null;

    return createPortal(
        <div
            aria-label={label}
            className="popover"
            ref={panelRef}
            role="dialog"
            style={{
                left: position?.left ?? 0,
                maxHeight: position?.maxHeight,
                // Hidden until measured, but still focusable so the panel can take
                // focus on open.
                opacity: position ? 1 : 0,
                pointerEvents: position ? "auto" : "none",
                top: position?.top ?? 0,
                width,
            }}
            tabIndex={-1}
        >
            {children}
        </div>,
        document.body,
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

const ACTION_PHASE_LABEL = {
    starting: "Starting…",
    running: "Running…",
    queueing: "Queueing…",
};

/**
 * Action control that doubles as the progress indicator for the request it started.
 *
 * The phase turns the label into a spinner, so the operator can see which of the
 * competing controls is already busy instead of guessing from a disabled button.
 * `context` names the target for assistive technology, since several of these
 * buttons share the same label.
 */
export function ActionButton({
    busyLabel,
    className,
    context,
    disabled,
    iconName = "play",
    iconSize = 14,
    label,
    onClick,
    phase = null,
    title,
}) {
    const text = phase ? busyLabel || ACTION_PHASE_LABEL[phase] || "Working…" : label;

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
            {phase ? <Spinner size={iconSize} /> : <Icon name={iconName} size={iconSize} />}
            {text}
        </button>
    );
}

export function NumberField({ label, max, min = 1, name, onChange, value }) {
    return (
        <label className="field-control field-control-number" htmlFor={name}>
            <span className="sr-only">{label}</span>
            <input
                id={name}
                inputMode="numeric"
                max={max}
                min={min}
                name={name}
                onChange={onChange}
                step={1}
                type="number"
                value={value}
            />
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
