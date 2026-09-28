import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { copyToClipboard } from "../lib/workspace";

/**
 * Copy-to-clipboard control. Route keys and selectors are long, so the workspace
 * always offers a one-click way to get them out of the browser.
 */
export default function CopyButton({
    value,
    label = "Copy",
    title,
    className = "button button-secondary button-small copy-button",
}) {
    const [copied, setCopied] = useState(false);
    const timeoutRef = useRef(null);

    useEffect(() => () => clearTimeout(timeoutRef.current), []);

    async function handleCopy() {
        const copiedOk = await copyToClipboard(String(value ?? ""));
        if (!copiedOk) return;

        setCopied(true);
        clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setCopied(false), 1600);
    }

    return (
        <button
            className={className}
            onClick={handleCopy}
            title={title || `Copy ${label.toLowerCase()}`}
            type="button"
        >
            <Icon name={copied ? "check" : "copy"} size={14} />
            {copied ? "Copied" : label}
        </button>
    );
}
