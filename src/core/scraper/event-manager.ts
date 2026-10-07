import { Configuration } from "crawlee";

/** The slice of Crawlee's event manager this module needs. */
interface EventManagerLike {
    listeners(event: string): unknown[];
    off(event: string, listener: unknown): void;
}

const MANAGER_EVENTS = ["migrating", "aborting"];

/**
 * Tracks the listeners a crawl adds to Crawlee's shared event manager, so they can
 * be handed back when the crawl finishes.
 *
 * `RequestQueue` subscribes to `migrating` in its constructor and `BasicCrawler`
 * subscribes to `migrating`/`aborting` on every run, and neither unsubscribes on
 * every path — `queue.drop()` does not release them either. The manager allows
 * only 50 listeners per event and the backend is a long-lived process, so without
 * this a handful of municipality-wide runs makes Node print
 * "Possible AsyncEventEmitter memory leak detected".
 */
export function trackEventManagerListeners(): () => void {
    const manager = Configuration.getGlobalConfig().getEventManager() as EventManagerLike;
    const before = new Set(MANAGER_EVENTS.flatMap((event) => manager.listeners(event)));

    return function release() {
        for (const event of MANAGER_EVENTS) {
            for (const listener of manager.listeners(event)) {
                if (!before.has(listener)) {
                    manager.off(event, listener);
                }
            }
        }
    };
}
