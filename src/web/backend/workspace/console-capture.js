import { format } from "node:util";

// Crawlee colours its log output; the browser renders plain text.
const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

function stripAnsi(value) {
    return String(value).replace(ANSI_PATTERN, "");
}

/**
 * Scoped console capture.
 *
 * A scraper run reports its progress through `console.log` (the crawler, the
 * loader and Crawlee itself all do). For a one-click run started from the UI we
 * need that output in the browser, so the console is redirected into a sink for
 * the duration of the run and then restored. Output still reaches the terminal
 * of whoever started the server.
 */
export function captureConsoleLogs(sink) {
    const streams = ["log", "warn", "error"];
    const originals = new Map(streams.map((stream) => [stream, console[stream]]));

    for (const stream of streams) {
        console[stream] = (...args) => {
            originals.get(stream)(...args);
            try {
                sink(stream, stripAnsi(format(...args)));
            } catch {
                // Never let log plumbing break a run.
            }
        };
    }

    return function restoreConsoleLogs() {
        for (const stream of streams) {
            console[stream] = originals.get(stream);
        }
    };
}
