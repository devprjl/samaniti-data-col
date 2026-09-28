/**
 * Checks a deployment the way Vercel will, before Vercel does it.
 *
 * Every step here mirrors something the platform does for real, and every step is
 * one that has failed on a deploy that the local test suite was perfectly happy
 * about. A Vercel build is not `npm start`: it installs from the lock file into a
 * directory with no node_modules, runs one build command, traces the function
 * with the platform's own file tracer, and hands the result to a runtime with no
 * repository checkout and no working directory. None of that is exercised
 * otherwise, which is why the same mistake can pass every local check and still
 * fail a deploy.
 *
 * The stages, in order:
 *
 *   1. vercel.json is valid against Vercel's published JSON schema, so a mistyped
 *      key or a wrongly typed value cannot reach a deploy.
 *   2. `installCommand` succeeds from the lock file in a clean directory, in a
 *      production environment. A build needs its devDependencies: esbuild, vite,
 *      the Prisma CLI and TypeScript are all of them, and a host that omits them
 *      either dies at 127 with "command not found" or builds with missing tools.
 *   3. `buildCommand` produces the bundle and the static output.
 *   4. The generated Prisma client exists, which `postinstall` is responsible for.
 *   5. Tracing `api/[...path].js` with @vercel/nft resolves the entrypoint, the
 *      bundle and the generated client, with no help from `includeFiles`.
 *   6. The traced result, copied into a directory containing nothing else, boots
 *      and answers every route. A missing file here is the difference between a
 *      working deploy and FUNCTION_INVOCATION_FAILED.
 *
 * Stages 2 to 4 run in the clean directory rather than in the repository, so the
 * build is proved against the install that will actually produce it. A build that
 * succeeds because of a developer's existing node_modules proves nothing.
 *
 * Run with `npm run verify:deploy`. `--skip-install` reuses the current
 * node_modules and skips stages 2 to 4, which is fast and still covers the
 * packaging and runtime failures, which are the ones that reach users.
 *
 * Needs a reachable DATABASE_URL, because stage 6 makes real queries. A 200 from
 * a route that returned nothing because it could not connect is not a pass.
 */

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeFileTrace } from "@vercel/nft";
import Ajv from "ajv";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaUrl = "https://openapi.vercel.sh/vercel.json";
const skipInstall = process.argv.includes("--skip-install");

/** Where the build runs. Stages 2 to 6 all read from here, never from the repo. */
let buildRoot = repositoryRoot;
let scratch = null;

const failures = [];
let stage = 0;

function heading(text) {
    stage += 1;
    console.log(`\n${stage}. ${text}`);
}

function pass(text) {
    console.log(`   ok    ${text}`);
}

function fail(text, detail) {
    failures.push({ text, detail });
    console.log(`   FAIL  ${text}`);
    if (detail) console.log(`         ${String(detail).split("\n").join("\n         ")}`);
}

function check(condition, text, detail) {
    if (condition) pass(text);
    else fail(text, detail);
    return Boolean(condition);
}

function run(command, args, options = {}) {
    return execFileSync(command, args, {
        cwd: buildRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        ...options,
    });
}

/** Verbatim from vercel.json, so this can never drift from what the platform runs. */
function readBuildConfig() {
    const config = JSON.parse(fs.readFileSync(path.join(repositoryRoot, "vercel.json"), "utf8"));
    const [command, ...args] = config.installCommand.trim().split(/\s+/);
    return { install: { command, args }, build: config.buildCommand.trim().split(/\s+/) };
}

/**
 * Copies the working tree, minus everything git ignores, into `destination`.
 *
 * `git ls-files --cached --others --exclude-standard` is the file set a deploy is
 * built from, and it keeps two things honest that a plain copy does not:
 * node_modules and stale build output cannot be carried over to mask a missing
 * dependency, and uncommitted changes are tested rather than silently skipped in
 * favour of whatever the last commit happened to contain.
 */
function copyWorkingTree(destination) {
    const listed = run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
        cwd: repositoryRoot,
    })
        .split("\n")
        .filter(Boolean);

    for (const relative of listed) {
        const source = path.join(repositoryRoot, relative);
        if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
        const target = path.join(destination, relative);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(source, target);
    }

    return listed.length;
}

const { install, build } = readBuildConfig();

try {
    heading("vercel.json validates against Vercel's schema");

    const response = await fetch(schemaUrl);
    if (!response.ok) {
        fail("fetched Vercel's schema", `HTTP ${response.status} from ${schemaUrl}`);
    } else {
        const schema = await response.json();
        // The published schema declares draft-04 and uses its `example`
        // annotation, which ajv 8 rejects in strict mode, and its draft-04 pointer
        // would need a metchema that is not worth carrying. Relaxing strictness
        // and dropping the pointer lets the real rules be enforced, which is the
        // point of checking against the published schema rather than a
        // hand-written approximation of it.
        delete schema.$schema;
        const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
        const config = JSON.parse(
            fs.readFileSync(path.join(repositoryRoot, "vercel.json"), "utf8"),
        );
        check(validate(config), "vercel.json is valid", JSON.stringify(validate.errors, null, 2));
    }

    if (skipInstall) {
        heading("install, build and Prisma client generation skipped (--skip-install)");
        console.log(
            "   --    stages 2 to 4 not run; build-time dependency availability is unverified",
        );
    } else {
        // One clean directory for the install, the build, and the packaging, so
        // each stage is proved against the output of the previous one.
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-verify-"));
        buildRoot = scratch;
        const copied = copyWorkingTree(scratch);
        pass(`staged ${copied} files into a clean directory, with no node_modules`);

        heading("installCommand runs from the lock file, in production");

        // Vercel runs the install with NODE_ENV=production, which makes npm omit
        // devDependencies unless the command asks for them.
        //
        // PATH is sanitised as well. `npm run` puts the repository's
        // node_modules/.bin at the front of PATH, and that is inherited by every
        // lifecycle script the install runs, so without this the scratch install
        // can resolve binaries out of the developer's own checkout and pass a
        // build it has no tools for. That is the exact failure being guarded
        // against, so it must not be able to hide here either.
        const sanitisedPath = (process.env.PATH ?? "")
            .split(path.delimiter)
            .filter((entry) => !entry.includes(`${path.sep}node_modules${path.sep}.bin`))
            .join(path.delimiter);

        let installOk = true;
        try {
            run(install.command, install.args, {
                env: { ...process.env, NODE_ENV: "production", PATH: sanitisedPath },
            });
            pass(`\`${install.command} ${install.args.join(" ")}\` succeeded`);
        } catch (error) {
            installOk = false;
            const stderr = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
            // 127 is the "command not found" exit status. A build reports it when a
            // lifecycle script calls a binary from a package the install skipped,
            // so name that case explicitly rather than leaving a bare number.
            fail(
                `\`${install.command} ${install.args.join(" ")}\` failed with ${error.status}` +
                    (error.status === 127 ? " (command not found)" : ""),
                stderr,
            );
        }

        if (installOk) {
            // Checked by name, not inferred from the lock file. A workspace
            // dependency installs its binary into that workspace's .bin rather
            // than the root one, so both are searched: vite belongs to the
            // frontend workspace and never appears in the root.
            const binDirectories = [
                path.join(buildRoot, "node_modules", ".bin"),
                path.join(buildRoot, "src", "web", "frontend", "node_modules", ".bin"),
                path.join(buildRoot, "src", "web", "backend", "node_modules", ".bin"),
            ];
            const installed = (binary) =>
                binDirectories.some((directory) => fs.existsSync(path.join(directory, binary)));

            for (const binary of ["esbuild", "vite", "tsc", "prisma"]) {
                check(
                    installed(binary),
                    `\`${binary}\` is installed`,
                    "the build command invokes it",
                );
            }

            heading("buildCommand produces the bundle and the static output");
            try {
                run(build[0], build.slice(1));
                pass(`\`${build.join(" ")}\` succeeded`);
            } catch (error) {
                fail(
                    `\`${build.join(" ")}\` failed`,
                    `${error.stdout ?? ""}${error.stderr ?? ""}`.trim(),
                );
            }

            heading("the Prisma client was generated");
            const generated = path.join(buildRoot, "node_modules", ".prisma", "client", "index.js");
            check(
                fs.existsSync(generated),
                "node_modules/.prisma/client/index.js exists",
                "run npm run db:generate",
            );
        }
    }

    heading("the function traces without includeFiles");

    const entrypoint = path.join(buildRoot, "api", "[...path].js");
    const packaged = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-pkg-"));
    let traceOk = false;

    try {
        const { fileList } = await nodeFileTrace([entrypoint], {
            base: buildRoot,
            processCwd: buildRoot,
        });
        const files = [...fileList].map((file) =>
            path.isAbsolute(file) ? file : path.join(buildRoot, file),
        );

        const includes = (needle) => files.some((file) => file.includes(needle));

        check(includes("dist/backend.mjs"), "the traced set contains the backend bundle");
        check(
            includes("node_modules/.prisma/client/index.js"),
            "the traced set contains the generated Prisma client",
        );
        check(
            includes("node_modules/.prisma/client/query_compiler_fast_bg.wasm-base64.js"),
            "the traced set contains the query compiler",
        );
        check(includes("node_modules/express"), "the traced set contains express");

        let bytes = 0;
        for (const file of files) {
            const relative = path.relative(buildRoot, file);
            if (!relative || relative.startsWith("..")) continue;
            const destination = path.join(packaged, relative);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.copyFileSync(file, destination);
            bytes += fs.statSync(file).size;
        }
        // The runtime reads this to decide the module system, so it has to travel
        // with the function even though nothing imports it.
        fs.cpSync(path.join(buildRoot, "package.json"), path.join(packaged, "package.json"));

        pass(
            `packaged ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, with no includeFiles`,
        );
        traceOk = true;
    } catch (error) {
        fail("tracing the function entrypoint failed", error.stack ?? error.message);
    }

    if (traceOk) {
        heading("the packaged function answers every route, in a production environment");

        // A separate process, from inside the packaged directory, in a production
        // environment. The environment is part of what is under test: NODE_ENV and
        // the host variable decide whether the scraper workspace is mounted, and
        // importing the entrypoint from the repository rather than from the package
        // would let a file that failed to be packaged resolve by accident.
        fs.cpSync(
            path.join(repositoryRoot, "scripts", "deploy-probe.mjs"),
            path.join(packaged, "deploy-probe.mjs"),
        );

        const port = 5000 + (process.pid % 1000);
        const child = spawn(process.execPath, ["deploy-probe.mjs", String(port)], {
            cwd: packaged,
            env: { ...process.env, NODE_ENV: "production", VERCEL: "1" },
            stdio: ["ignore", "pipe", "pipe"],
        });

        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk) => (stdout += chunk));
        child.stderr.on("data", (chunk) => (stderr += chunk));

        const exitCode = await new Promise((resolve) => {
            const timer = setTimeout(() => {
                child.kill("SIGKILL");
                resolve(-1);
            }, 60_000);
            child.on("exit", (code) => {
                clearTimeout(timer);
                resolve(code);
            });
        });

        let report = null;
        try {
            report = JSON.parse(stdout.trim().split("\n").pop());
        } catch {
            report = null;
        }

        if (!report) {
            fail(
                "the packaged function boots and serves requests",
                stderr.trim() || stdout.trim() || `the probe exited with ${exitCode} and no output`,
            );
        } else {
            pass("the packaged function boots and serves requests");

            for (const result of report.results) {
                check(
                    result.passed,
                    `${result.label} -> ${result.status}`,
                    result.passed
                        ? ""
                        : `expected ${result.expected.join(" or ")}, got ${result.detail}`,
                );
            }

            if (!process.env.DATABASE_URL) {
                fail(
                    "DATABASE_URL is set",
                    "the read-only probes above made real queries, so a 200 there means nothing without one",
                );
            } else {
                pass("DATABASE_URL is set, so the data routes were real queries");
            }
        }

        fs.rmSync(packaged, { recursive: true, force: true });
    }
} finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
}

console.log();
if (failures.length === 0) {
    console.log(`All ${stage} stages passed. The build is ready to deploy.`);
    process.exit(0);
}

console.log(`${failures.length} of ${stage} stages failed:`);
for (const failure of failures) console.log(`  - ${failure.text}`);
process.exit(1);
