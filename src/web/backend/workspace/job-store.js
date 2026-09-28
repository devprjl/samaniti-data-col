import { randomUUID } from "node:crypto";

/**
 * In-memory registry of scraper runs started from the UI.
 *
 * Runs deliberately stay out of the database: the existing `scraper_runs` table
 * already records the official telemetry (items added/updated, duration, status)
 * per municipality. This registry only exists so a run started from the browser
 * can be watched while it happens, and it is intentionally lost on restart.
 */

const MAX_JOBS = 25;
const MAX_LOG_LINES = 400;

const jobs = new Map();
let activeJobId = null;

function prune() {
    while (jobs.size > MAX_JOBS) {
        const oldest = [...jobs.values()].sort(
            (first, second) => new Date(first.startedAt) - new Date(second.startedAt),
        )[0];
        if (!oldest || oldest.id === activeJobId) break;
        jobs.delete(oldest.id);
    }
}

export function getActiveJob() {
    return activeJobId ? (jobs.get(activeJobId) ?? null) : null;
}

export function getJob(id) {
    return jobs.get(id) ?? null;
}

export function listJobs() {
    return [...jobs.values()].sort(
        (first, second) => new Date(second.startedAt) - new Date(first.startedAt),
    );
}

export function createJob({ key, targetKey, routeName, label, pagination }) {
    const job = {
        id: randomUUID(),
        key,
        targetKey,
        routeName: routeName ?? null,
        label,
        status: "running",
        pagination,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        durationMs: null,
        result: null,
        error: null,
        logs: [],
    };

    jobs.set(job.id, job);
    activeJobId = job.id;
    prune();
    return job;
}

export function appendLog(job, stream, message) {
    for (const line of String(message).split("\n")) {
        if (job.logs.length >= MAX_LOG_LINES) {
            job.logs.push({
                at: new Date().toISOString(),
                stream: "warn",
                message: "... log truncated, too many lines ...",
            });
            break;
        }
        job.logs.push({ at: new Date().toISOString(), stream, message: line });
    }
}

export function finishJob(job, { status, result = null, error = null }) {
    job.status = status;
    job.result = result;
    job.error = error;
    job.finishedAt = new Date().toISOString();
    job.durationMs = new Date(job.finishedAt) - new Date(job.startedAt);
    if (activeJobId === job.id) activeJobId = null;
    return job;
}
