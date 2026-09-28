/**
 * Probes a packaged function the way the Vercel runtime will run it.
 *
 * This is a separate process on purpose. The environment is part of what is being
 * tested: NODE_ENV and the host variable are what decide whether the scraper
 * workspace is mounted, so probing from a process that happens to be in
 * development mode would answer a different question than the one that matters.
 * The entrypoint is imported from the current directory, which is the packaged
 * function and nothing else, so a file that failed to be packaged cannot be
 * quietly resolved from the repository it was packaged from.
 *
 * Prints one JSON object to stdout and exits 0 when every probe matched, 1
 * otherwise. Run by `npm run verify:deploy`; not useful on its own.
 *
 * Usage: node deploy-probe.mjs <port>
 */

import http from "node:http";

const port = Number(process.argv[2]);

const { default: handler } = await import("./api/[...path].js");

if (typeof handler !== "function") {
    console.log(JSON.stringify({ loaded: false, reason: "no callable default export" }));
    process.exit(1);
}

const server = http.createServer((request, response) => handler(request, response));
await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

const origin = `http://127.0.0.1:${port}`;

// The workspace is expected to be refused here, with 403 and a stable code. A 404
// would mean the route is missing rather than deliberately closed, and a 500
// would mean the refusal is not happening before something tries to run.
const probes = [
    { method: "GET", route: "/api/health", expect: [200] },
    { method: "GET", route: "/api/municipalities", expect: [200] },
    { method: "GET", route: "/api/policies", expect: [200] },
    { method: "GET", route: "/api/scraper-runs", expect: [200] },
    {
        method: "GET",
        route: "/api/workspace/routes",
        expect: [403],
        code: "scraper_workspace_disabled",
    },
    { method: "POST", route: "/api/workspace/runs", body: { key: "madesh:ekdara" }, expect: [403] },
];

const results = [];

for (const probe of probes) {
    try {
        const response = await fetch(origin + probe.route, {
            method: probe.method,
            headers: { "Content-Type": "application/json" },
            body: probe.body ? JSON.stringify(probe.body) : undefined,
        });
        const text = await response.text();

        let code = null;
        try {
            code = JSON.parse(text)?.error?.code ?? null;
        } catch {
            code = null;
        }

        results.push({
            label: `${probe.method} ${probe.route}`,
            status: response.status,
            expected: probe.expect,
            passed:
                probe.expect.includes(response.status) &&
                (probe.code === undefined || code === probe.code),
            detail: `status ${response.status}${code ? `, code ${code}` : ""}: ${text.slice(0, 200)}`,
        });
    } catch (error) {
        results.push({
            label: `${probe.method} ${probe.route}`,
            status: 0,
            expected: probe.expect,
            passed: false,
            detail: error.message,
        });
    }
}

server.close();

const passed = results.every((result) => result.passed);
console.log(JSON.stringify({ loaded: true, passed, results }));
process.exit(passed ? 0 : 1);
