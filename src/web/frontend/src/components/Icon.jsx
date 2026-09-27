const icons = {
    overview: (
        <>
            <rect x="3" y="3" width="7" height="7" rx="1" />
            <rect x="14" y="3" width="7" height="7" rx="1" />
            <rect x="3" y="14" width="7" height="7" rx="1" />
            <rect x="14" y="14" width="7" height="7" rx="1" />
        </>
    ),
    building: (
        <>
            <path d="M4 21V5.5L12 3v18" />
            <path d="M12 8h8v13" />
            <path d="M2 21h20" />
            <path d="M7 8h2M7 12h2M7 16h2M15 12h2M15 16h2" />
        </>
    ),
    activity: (
        <>
            <path d="M3 12h4l2.2-7 4.2 14 2.2-7H21" />
            <path d="M3 4v16" />
        </>
    ),
    book: (
        <>
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5v-16Z" />
            <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
            <path d="M8 7h8M8 10h6" />
        </>
    ),
    search: (
        <>
            <circle cx="10.8" cy="10.8" r="6.8" />
            <path d="m16 16 5 5" />
        </>
    ),
    refresh: (
        <>
            <path d="M20 11a8 8 0 0 0-14.8-3L3 11" />
            <path d="M3 5v6h6" />
            <path d="M4 13a8 8 0 0 0 14.8 3L21 13" />
            <path d="M21 19v-6h-6" />
        </>
    ),
    "arrow-right": <path d="M5 12h14m-6-6 6 6-6 6" />,
    "arrow-left": <path d="M19 12H5m6 6-6-6 6-6" />,
    "arrow-up-right": <path d="M7 17 17 7M8 7h9v9" />,
    external: (
        <>
            <path d="M14 4h6v6" />
            <path d="m20 4-9 9" />
            <path d="M18 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h5" />
        </>
    ),
    file: (
        <>
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
            <path d="M14 3v6h6M8 13h8M8 17h5" />
        </>
    ),
    calendar: (
        <>
            <rect x="3" y="4.5" width="18" height="17" rx="2" />
            <path d="M16 2.5v4M8 2.5v4M3 9h18" />
            <path d="M8 13h.01M12 13h.01M16 13h.01M8 17h.01M12 17h.01" />
        </>
    ),
    database: (
        <>
            <ellipse cx="12" cy="5" rx="8" ry="3" />
            <path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
            <path d="M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7" />
        </>
    ),
    check: <path d="m5 12 4.5 4.5L19 7" />,
    alert: (
        <>
            <path d="M10.3 4.2 2.5 18a2 2 0 0 0 1.7 3h15.6a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z" />
            <path d="M12 9v4M12 17h.01" />
        </>
    ),
    info: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 11v5M12 8h.01" />
        </>
    ),
    filter: (
        <>
            <path d="M4 6h16M7 12h10M10 18h4" />
        </>
    ),
    "chevron-down": <path d="m6 9 6 6 6-6" />,
    "chevron-left": <path d="m15 18-6-6 6-6" />,
    "chevron-right": <path d="m9 18 6-6-6-6" />,
    clock: (
        <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3.5 2" />
        </>
    ),
    "map-pin": (
        <>
            <path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" />
            <circle cx="12" cy="10" r="2.5" />
        </>
    ),
    link: (
        <>
            <path d="M10 13.8a4 4 0 0 0 5.7.2l2.1-2.1a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
            <path d="M14 10.2a4 4 0 0 0-5.7-.2l-2.1 2.1a4 4 0 0 0 5.7 5.7l1.2-1.2" />
        </>
    ),
    download: (
        <>
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M4 21h16" />
        </>
    ),
    users: (
        <>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
        </>
    ),
    layers: (
        <>
            <path d="m12 3 9 5-9 5-9-5 9-5Z" />
            <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
        </>
    ),
    chart: (
        <>
            <path d="M4 19V5M4 19h17" />
            <path d="m7 15 3-4 3 2 5-7" />
        </>
    ),
    menu: (
        <>
            <path d="M4 6h16M4 12h16M4 18h16" />
        </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    mark: (
        <>
            <path d="M12 3 20 7v10l-8 4-8-4V7l8-4Z" />
            <path d="M8 10.2 12 8l4 2.2v3.6L12 16l-4-2.2v-3.6Z" />
            <path d="M12 3v5M4 7l4 3.2M20 7l-4 3.2" />
        </>
    ),
};

export default function Icon({ name, size = 18, strokeWidth = 1.8, className = "" }) {
    return (
        <svg
            aria-hidden="true"
            className={`icon ${className}`}
            fill="none"
            height={size}
            viewBox="0 0 24 24"
            width={size}
            xmlns="http://www.w3.org/2000/svg"
        >
            <g
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={strokeWidth}
            >
                {icons[name] || icons.info}
            </g>
        </svg>
    );
}
