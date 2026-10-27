/**
 * Polling controller for per-session subagent lists. Pure of React/zustand so
 * the start/stop rules are testable with fake timers:
 * - a session is polled only while at least one watcher exists;
 * - `watch` triggers an immediate fetch; the next poll is scheduled only while
 *   `isRunning(id)` is true after a fetch settles (all terminal → polling stops);
 * - ticks while the page is hidden skip the request (a resync on visibility refetches);
 * - concurrent refreshes of one session share one in-flight request.
 */

export const POLL_MS = 15_000;

export interface PollerDeps {
	/** Fetch and store the list for a session. */
	fetch: (sessionId: string) => Promise<void>;
	/** Does the stored list of this session have a non-terminal subagent? */
	isRunning: (sessionId: string) => boolean;
	visible?: () => boolean;
	intervalMs?: number;
}

export interface Poller {
	watch: (sessionId: string) => () => void;
	/** Refetch now (SSE event / manual); no-op when nobody watches. Returns the shared in-flight promise. */
	refresh: (sessionId: string) => Promise<void>;
	/** Refetch every watched session (visibility / reconnect resync). */
	refreshAll: () => void;
	isPolling: (sessionId: string) => boolean;
}

export function createPoller(deps: PollerDeps): Poller {
	const interval = deps.intervalMs ?? POLL_MS;
	const visible = deps.visible ?? (() => typeof document === "undefined" || document.visibilityState !== "hidden");
	const watchers = new Map<string, number>();
	const timers = new Map<string, number>();
	const inflight = new Map<string, Promise<void>>();

	const clearTimer = (id: string) => {
		clearTimeout(timers.get(id));
		timers.delete(id);
	};

	const schedule = (id: string) => {
		clearTimer(id);
		if (!watchers.has(id) || !deps.isRunning(id)) return;
		timers.set(
			id,
			window.setTimeout(() => {
				timers.delete(id);
				if (!watchers.has(id)) return;
				if (!visible()) return schedule(id);
				void run(id);
			}, interval),
		);
	};

	const run = (id: string): Promise<void> => {
		const existing = inflight.get(id);
		if (existing) return existing;
		const p = deps
			.fetch(id)
			.catch(() => {})
			.finally(() => {
				inflight.delete(id);
				schedule(id);
			});
		inflight.set(id, p);
		return p;
	};

	return {
		watch(id) {
			watchers.set(id, (watchers.get(id) ?? 0) + 1);
			void run(id);
			let released = false;
			return () => {
				if (released) return;
				released = true;
				const n = (watchers.get(id) ?? 1) - 1;
				if (n > 0) {
					watchers.set(id, n);
					return;
				}
				watchers.delete(id);
				clearTimer(id);
			};
		},
		refresh(id) {
			return watchers.has(id) ? run(id) : Promise.resolve();
		},
		refreshAll() {
			for (const id of watchers.keys()) void run(id);
		},
		isPolling: (id) => timers.has(id),
	};
}
