import "dotenv/config";
import { enqueuePendingDocuments } from "../src/core/queue/ocr-producer.js";
import { closeRedisClient } from "../src/core/queue/redis.js";

async function main() {
    const args = process.argv.slice(2);
    let limit = 50;
    let municipalityCode: string | undefined;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--limit" && args[i + 1]) {
            limit = parseInt(args[i + 1], 10);
            i++;
        } else if (args[i] === "--municipality" && args[i + 1]) {
            municipalityCode = args[i + 1];
            i++;
        }
    }

    console.log(
        `[enqueue-ocr] Enqueueing up to ${limit} pending documents${municipalityCode ? ` for municipality ${municipalityCode}` : ""}...`,
    );

    const count = await enqueuePendingDocuments({ limit, municipalityCode });
    console.log(`[enqueue-ocr] Done. Enqueued ${count} job(s).`);

    await closeRedisClient();
    process.exit(0);
}

main().catch((err) => {
    console.error("[enqueue-ocr] Error:", err);
    process.exit(1);
});
