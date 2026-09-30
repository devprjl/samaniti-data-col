import { Redis } from "ioredis";

let redisClient: Redis | null = null;

export const OCR_QUEUE_NAME = process.env.OCR_QUEUE_NAME || "ocr:jobs";

export function getRedisClient(): Redis {
    if (!redisClient) {
        const url = process.env.REDIS_URL || "redis://localhost:6379/0";
        redisClient = new Redis(url, {
            maxRetriesPerRequest: 3,
            enableReadyCheck: true,
            lazyConnect: true,
        });

        redisClient.on("error", (err) => {
            console.warn(`[redis] Redis connection warning: ${err.message}`);
        });
    }
    return redisClient;
}

/**
 * Closes the shared connection.
 *
 * The connection keeps the Node event loop alive, so every entry point that
 * queues OCR work has to end with this or the process prints its last line and
 * then hangs until it is killed. ioredis 6 dropped `unref()`, so the client
 * cannot be told to stop holding the loop open and must be closed explicitly.
 * The next call to {@link getRedisClient} opens a fresh one.
 */
export async function closeRedisClient(): Promise<void> {
    if (redisClient) {
        const client = redisClient;
        redisClient = null;
        try {
            await client.quit();
        } catch {
            client.disconnect();
        }
    }
}
