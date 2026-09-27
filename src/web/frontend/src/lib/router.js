import { useCallback, useEffect, useState } from "react";

function readLocation() {
    const pathname = window.location.pathname.replace(/\/+$/, "") || "/";

    return {
        pathname,
        search: window.location.search,
    };
}

export function navigate(to, { replace = false } = {}) {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const next = typeof to === "string" ? to : `${to.pathname}${to.search}`;

    if (current === next) return;

    window.history[replace ? "replaceState" : "pushState"]({}, "", next);
    window.dispatchEvent(new Event("popstate"));
}

export function useRouter() {
    const [location, setLocation] = useState(readLocation);

    useEffect(() => {
        const handleLocationChange = () => {
            setLocation(readLocation());
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
        };

        window.addEventListener("popstate", handleLocationChange);
        return () => window.removeEventListener("popstate", handleLocationChange);
    }, []);

    const go = useCallback((to, options) => {
        navigate(to, options);
    }, []);

    return { ...location, navigate: go };
}
