import { useEffect, useRef, useState } from "react";
import { getDocumentDownloadUrl } from "../lib/api";
import { formatNumber } from "../lib/format";
import { copyToClipboard } from "../lib/workspace";
import Icon from "./Icon";
import { Popover } from "./Primitives";

const COPY_FEEDBACK_MS = 1600;

/** How a document ended up in storage, shown next to its name. */
const DOWNLOAD_STATUS = {
    ok: ["Stored copy", "green"],
    failed: ["Download failed", "red"],
    pending: ["Not downloaded", "slate"],
    skipped: ["Download skipped", "slate"],
};

function statusMeta(status) {
    return DOWNLOAD_STATUS[status] || ["Source file only", "slate"];
}

/**
 * Document count of a record, doubling as the trigger for the attached-file menu.
 *
 * A record can carry a long list of attachments, so the table only has room for the
 * count. Opening it reveals the file names, the portal URL each file came from, a
 * one-click way to copy the stored copy's public URL (storagePath), and a link that
 * opens the portal URL the file was scraped from.
 */
export default function DocumentMenu({ documents }) {
    const [anchor, setAnchor] = useState(null);
    const [copiedId, setCopiedId] = useState(null);
    const [allCopied, setAllCopied] = useState(false);
    const resetTimer = useRef(null);

    const files = documents || [];
    const count = files.length;
    const isOpen = Boolean(anchor);

    useEffect(() => () => clearTimeout(resetTimer.current), []);

    function close() {
        clearTimeout(resetTimer.current);
        setAnchor(null);
        setCopiedId(null);
        setAllCopied(false);
    }

    function scheduleReset() {
        clearTimeout(resetTimer.current);
        resetTimer.current = setTimeout(() => {
            setCopiedId(null);
            setAllCopied(false);
        }, COPY_FEEDBACK_MS);
    }

    async function copyStorageUrl(document) {
        const storageUrl = document.storagePath || "";
        if (!storageUrl || !(await copyToClipboard(storageUrl))) return;

        setCopiedId(document.id);
        scheduleReset();
    }

    async function copyEveryStorageUrl() {
        const links = files.map((file) => file.storagePath).filter(Boolean);
        if (links.length === 0 || !(await copyToClipboard(links.join("\n")))) return;

        setAllCopied(true);
        scheduleReset();
    }

    if (count === 0) return <span className="muted-value">None</span>;

    return (
        <>
            <button
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                className="document-count document-count-trigger"
                onClick={(event) => setAnchor(isOpen ? null : event.currentTarget)}
                title={`${formatNumber(count)} attached ${count === 1 ? "document" : "documents"}`}
                type="button"
            >
                <Icon name="file" size={15} />
                {formatNumber(count)}
                <Icon name="chevron-down" size={11} />
            </button>

            {isOpen && (
                <Popover anchor={anchor} label="Attached documents" onClose={close} width={360}>
                    <div className="document-menu">
                        <div className="document-menu-head">
                            <span className="document-menu-title">
                                <Icon name="file" size={14} />
                                {count === 1
                                    ? "1 attached document"
                                    : `${formatNumber(count)} attached documents`}
                            </span>
                            {count > 1 && (
                                <button
                                    className="document-menu-all"
                                    onClick={copyEveryStorageUrl}
                                    type="button"
                                >
                                    <Icon name={allCopied ? "check" : "copy"} size={12} />
                                    {allCopied ? "Copied" : "Copy all stored URLs"}
                                </button>
                            )}
                        </div>

                        <ul className="document-menu-list">
                            {files.map((document) => {
                                const fileName = document.fileName || "Unnamed document";
                                const [statusLabel, statusTone] = statusMeta(
                                    document.downloadStatus,
                                );
                                const sourceUrl = document.originalUrl || "";
                                const storageUrl = document.storagePath || "";

                                return (
                                    <li className="document-menu-item" key={document.id}>
                                        <div className="document-menu-copy">
                                            <div className="document-menu-name">
                                                <strong title={fileName}>{fileName}</strong>
                                                <span
                                                    className={`document-menu-status document-menu-status-${statusTone}`}
                                                >
                                                    {statusLabel}
                                                </span>
                                            </div>
                                            {sourceUrl ? (
                                                <span
                                                    className="document-menu-url"
                                                    title={sourceUrl}
                                                >
                                                    {sourceUrl}
                                                </span>
                                            ) : (
                                                <span className="document-menu-url">
                                                    No source URL recorded
                                                </span>
                                            )}
                                        </div>
                                        <div className="document-menu-actions">
                                            <button
                                                aria-label={`Copy the stored file URL of ${fileName}`}
                                                className="document-menu-action"
                                                disabled={!storageUrl}
                                                onClick={() => copyStorageUrl(document)}
                                                title="Copy the stored file URL (AWS)"
                                                type="button"
                                            >
                                                <Icon
                                                    name={
                                                        copiedId === document.id ? "check" : "copy"
                                                    }
                                                    size={13}
                                                />
                                            </button>
                                            <a
                                                aria-label={`Open ${fileName} on the source portal`}
                                                className="document-menu-action"
                                                href={
                                                    sourceUrl || getDocumentDownloadUrl(document.id)
                                                }
                                                rel="noreferrer"
                                                target="_blank"
                                                title="Open the source document on the portal"
                                            >
                                                <Icon name="arrow-up-right" size={13} />
                                            </a>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </Popover>
            )}
        </>
    );
}
