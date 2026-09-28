import "dotenv/config";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { getAvailableScrapers, matchTargets, ScraperTarget } from "./src/core/scraper/registry.js";

export type { ScraperTarget } from "./src/core/scraper/registry.js";
export { getAvailableScrapers } from "./src/core/scraper/registry.js";

export interface ScraperResult {
    target: ScraperTarget;
    success: boolean;
    durationMs: number;
    exitCode: number | null;
    error?: string;
}

/**
 * Resolves a CLI target to the scrapers it should run.
 *
 * Route level keys (`<province>:<municipality>:<route>`) are served by the
 * scraper workspace in the web UI, which runs a single route in-process; the
 * CLI covers whole provinces and municipalities.
 */
export function resolveTargets(
    allScrapers: ScraperTarget[],
    targetArg?: string,
): { targets: ScraperTarget[]; isSingle: boolean; scopeDesc: string } {
    if (allScrapers.length === 0) {
        return { targets: [], isSingle: false, scopeDesc: "No scrapers available" };
    }

    const match = matchTargets(targetArg);

    if (match.targets.length === 0) {
        return { targets: [], isSingle: false, scopeDesc: `No matches for '${targetArg ?? ""}'` };
    }

    const scopeDesc =
        match.scope === "province"
            ? `Province '${match.requested}' (${match.targets.length} municipalities)`
            : match.scope === "all"
              ? "All provinces & municipalities"
              : `Single scraper (${match.targets[0].key})`;

    return {
        targets: match.targets,
        isSingle: match.targets.length === 1,
        scopeDesc,
    };
}

function executeSingle(target: ScraperTarget): Promise<number> {
    console.log(`[Runner] Executing scraper for '${target.key}'...\n`);
    return new Promise((resolve) => {
        const child = spawn("npx", ["tsx", target.indexPath], {
            stdio: "inherit",
            env: process.env,
        });

        child.on("close", (code) => {
            resolve(code ?? 0);
        });

        child.on("error", (err) => {
            console.error(`[Runner] Failed to start process for '${target.key}':`, err);
            resolve(1);
        });
    });
}

async function executeParallel(
    targets: ScraperTarget[],
    concurrency: number,
): Promise<ScraperResult[]> {
    console.log(`\n[Runner] 🚀 Starting parallel execution of ${targets.length} scraper(s)...`);
    console.log(
        `[Runner] Concurrency: ${concurrency} parallel workers (Available CPU cores: ${os.cpus().length})\n`,
    );

    const results: ScraperResult[] = [];
    let completedCount = 0;
    const startTime = Date.now();

    let currentIndex = 0;

    async function worker(workerId: number): Promise<void> {
        while (currentIndex < targets.length) {
            const index = currentIndex++;
            const target = targets[index];
            const prefix = `[${target.key}]`;
            const itemStartTime = Date.now();

            console.log(`[Runner] [Worker ${workerId}] Starting ${target.key}`);

            const result = await new Promise<ScraperResult>((resolve) => {
                const child = spawn("npx", ["tsx", target.indexPath], {
                    stdio: ["ignore", "pipe", "pipe"],
                    env: process.env,
                });

                if (child.stdout) {
                    const rlOut = readline.createInterface({ input: child.stdout });
                    rlOut.on("line", (line) => {
                        console.log(`${prefix} ${line}`);
                    });
                }

                if (child.stderr) {
                    const rlErr = readline.createInterface({ input: child.stderr });
                    rlErr.on("line", (line) => {
                        console.error(`${prefix} [stderr] ${line}`);
                    });
                }

                child.on("close", (code) => {
                    const durationMs = Date.now() - itemStartTime;
                    const success = code === 0;
                    completedCount++;
                    if (success) {
                        console.log(
                            `[Runner] ✅ ${target.key} completed successfully in ${(durationMs / 1000).toFixed(1)}s (${completedCount}/${targets.length})`,
                        );
                    } else {
                        console.error(
                            `[Runner] ❌ ${target.key} failed with code ${code} in ${(durationMs / 1000).toFixed(1)}s (${completedCount}/${targets.length})`,
                        );
                    }
                    resolve({
                        target,
                        success,
                        durationMs,
                        exitCode: code,
                    });
                });

                child.on("error", (err) => {
                    const durationMs = Date.now() - itemStartTime;
                    completedCount++;
                    console.error(
                        `[Runner] ❌ ${target.key} encountered process error: ${err.message}`,
                    );
                    resolve({
                        target,
                        success: false,
                        durationMs,
                        exitCode: 1,
                        error: err.message,
                    });
                });
            });

            results.push(result);
        }
    }

    const workerCount = Math.min(concurrency, targets.length);
    const workers = Array.from({ length: workerCount }, (_, i) => worker(i + 1));
    await Promise.all(workers);

    const totalDurationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log(`\n============================================================`);
    console.log(`[Runner] 📊 Execution Summary`);
    console.log(`============================================================`);
    for (const r of results) {
        const icon = r.success ? "✅" : "❌";
        const dur = (r.durationMs / 1000).toFixed(1) + "s";
        console.log(
            `  ${icon} ${r.target.key.padEnd(25)} Duration: ${dur.padStart(6)}${r.success ? "" : ` (Exit Code: ${r.exitCode})`}`,
        );
    }
    console.log(`------------------------------------------------------------`);
    console.log(`Total: ${results.length} | Succeeded: ${successful} | Failed: ${failed}`);
    console.log(`Total Elapsed Time: ${totalDurationSec}s`);
    console.log(`============================================================\n`);

    return results;
}

function printUsageAndList(available: ScraperTarget[]) {
    console.log("Usage:");
    console.log(
        "  npm run scraper                            # Run all municipalities in all provinces (Parallel)",
    );
    console.log(
        "  npm run scraper <province>                 # Run all municipalities in that province (Parallel)",
    );
    console.log(
        "  npm run scraper <province>:<municipality>  # Run a specific municipality (Sequential)\n",
    );
    console.log("Options:");
    console.log(
        "  --concurrency=<N>, -c <N>                  # Set max parallel workers (Default: CPU count)\n",
    );
    console.log("Examples:");
    console.log("  npm run scraper");
    console.log("  npm run scraper lumbini");
    console.log("  npm run scraper lumbini:banganga");
    console.log(
        "\nSingle route runs (<province>:<municipality>:<route>) are done from the UI:\n  npm start  ->  http://localhost:5173/workspace\n",
    );

    if (available.length > 0) {
        console.log("Available Scrapers:");
        for (const s of available) {
            console.log(
                `  - ${s.key.padEnd(25)} (Path: src/scrapers/${s.province}/${s.municipality}/index.ts)`,
            );
        }
    } else {
        console.log("No scrapers found in src/scrapers.");
    }
}

export async function runScraper(targetArg?: string): Promise<void> {
    const rawArgs = process.argv.slice(2);

    let customConcurrency: number | null = null;
    const positionalArgs: string[] = [];

    for (let i = 0; i < rawArgs.length; i++) {
        const arg = rawArgs[i];
        if (arg === "--help" || arg === "-h") {
            const all = getAvailableScrapers();
            printUsageAndList(all);
            process.exit(0);
        } else if (arg.startsWith("--concurrency=")) {
            const val = parseInt(arg.split("=")[1], 10);
            if (!isNaN(val) && val > 0) customConcurrency = val;
        } else if (arg === "-c" && i + 1 < rawArgs.length) {
            const val = parseInt(rawArgs[++i], 10);
            if (!isNaN(val) && val > 0) customConcurrency = val;
        } else if (!arg.startsWith("-")) {
            positionalArgs.push(arg);
        }
    }

    let finalTarget: string | undefined = targetArg;
    if (!finalTarget) {
        if (positionalArgs.length === 1) {
            finalTarget = positionalArgs[0];
        } else if (positionalArgs.length >= 2) {
            finalTarget = positionalArgs[0].includes(":")
                ? positionalArgs[0]
                : `${positionalArgs[0]}:${positionalArgs[1]}`;
        }
    }

    const allScrapers = getAvailableScrapers();
    const { targets, isSingle, scopeDesc } = resolveTargets(allScrapers, finalTarget);

    if (targets.length === 0) {
        console.error(`\n[Runner] Error: No scrapers found for target '${finalTarget ?? ""}'.\n`);
        printUsageAndList(allScrapers);
        process.exit(1);
    }

    if (isSingle) {
        const exitCode = await executeSingle(targets[0]);
        process.exit(exitCode);
    } else {
        const cpus = os.cpus().length || 4;
        const concurrency = customConcurrency || cpus;
        console.log(`[Runner] Target Scope: ${scopeDesc}`);
        const results = await executeParallel(targets, concurrency);
        const hasFailure = results.some((r) => !r.success);
        process.exit(hasFailure ? 1 : 0);
    }
}

// CLI execution handling
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    runScraper().catch((err) => {
        console.error("[Runner] Error:", err.message);
        process.exit(1);
    });
}
