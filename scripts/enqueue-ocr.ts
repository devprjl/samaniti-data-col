import "dotenv/config";
import { enqueuePendingDocuments, OCR_ENQUEUE_MAX } from "../src/core/queue/ocr-producer.js";
import { closeRedisClient } from "../src/core/queue/redis.js";

async function main() {
    const args = process.argv.slice(2);
    let limit = 50;
    let enqueueAll = false;
    let municipalityCode: string | undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--all") {
            enqueueAll = true;
        } else if (args[i] === "--limit" && args[i + 1]) {
            const parsed = Number.parseInt(args[i + 1], 10);
            if (!Number.isFinite(parsed)) {
                console.error(`[enqueue-ocr] --limit needs a whole number, got '${args[i + 1]}'.`);
                process.exit(1);
            }
            limit = Math.min(Math.max(1, parsed), OCR_ENQUEUE_MAX);
            i++;
        } else if (args[i] === "--municipality" && args[i + 1]) {
            municipalityCode = args[i + 1];
            i++;
        }
    }

    const scope = municipalityCode ? ` for municipality ${municipalityCode}` : "";
    console.log(
        enqueueAll
            ? `[enqueue-ocr] Enqueueing every pending document${scope}...`
            : `[enqueue-ocr] Enqueueing up to ${limit} pending document(s)${scope}...`,
    );

    // `null` is the unbounded claim, the same thing the workspace's "enqueue all"
    // control sends.
    const { count, documents } = await enqueuePendingDocuments({
        limit: enqueueAll ? null : limit,
        municipalityCode,
    });
    console.log(`[enqueue-ocr] Done. Enqueued ${count} job(s).`);

    // The URLs are the audit trail: they say exactly what a run put on the queue,
    // which matters most for `--all` where the number alone tells you nothing.
    for (const document of documents) {
        console.log(`[enqueue-ocr]   ${document.original_url}`);
    }

    await closeRedisClient();
    process.exit(0);
}

main().catch((err) => {
    console.error("[enqueue-ocr] Error:", err);
    process.exit(1);
});
