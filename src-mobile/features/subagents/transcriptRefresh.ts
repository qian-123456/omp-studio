/** Visible detail refreshes share one request; event bursts never postpone an already queued read. */
const EVENT_INTERVAL_MS = 600;
const FALLBACK_MS = 5_000;

interface RefreshDeps {
	fetch: (signal: AbortSignal) => Promise<{ running: boolean }>;
}

export interface TranscriptRefresh {
	refresh: () => Promise<void>;
	notify: () => void;
	setVisible: (visible: boolean) => void;
	dispose: () => void;
}

export function createTranscriptRefresh(deps: RefreshDeps): TranscriptRefresh {
	let visible = false;
	let disposed = false;
	let running = false;
	let pending = false;
	let lastStart = -Infinity;
	let eventTimer: number | undefined;
	let fallbackTimer: number | undefined;
	let inflight: { controller: AbortController; promise: Promise<void> } | null = null;

	const clearTimers = () => {
		window.clearTimeout(eventTimer);
		window.clearTimeout(fallbackTimer);
		eventTimer = undefined;
		fallbackTimer = undefined;
	};

	const scheduleFallback = () => {
		window.clearTimeout(fallbackTimer);
		fallbackTimer = undefined;
		if (disposed || !visible || !running) return;
		fallbackTimer = window.setTimeout(() => {
			fallbackTimer = undefined;
			notify();
		}, FALLBACK_MS);
	};

	const run = (): Promise<void> => {
		if (disposed || !visible) return Promise.resolve();
		if (inflight) {
			pending = true;
			return inflight.promise;
		}
		clearTimers();
		pending = false;
		lastStart = Date.now();
		const request = { controller: new AbortController(), promise: Promise.resolve() };
		inflight = request;
		request.promise = Promise.resolve()
			.then(() => {
				if (request.controller.signal.aborted) return undefined;
				return deps.fetch(request.controller.signal);
			})
			.then((result) => {
				if (inflight !== request || request.controller.signal.aborted || !result) return;
				// A terminal status can precede the last persisted output: take one final incremental read.
				if (running && !result.running) pending = true;
				running = result.running;
			})
			.catch(() => {
				// The fetch owner presents errors; keep the last known running state for fallback retry.
			})
			.finally(() => {
				if (inflight !== request) return;
				inflight = null;
				if (pending) notify();
				else scheduleFallback();
			});
		return request.promise;
	};

	function notify(): void {
		if (disposed || !visible) return;
		pending = true;
		window.clearTimeout(fallbackTimer);
		fallbackTimer = undefined;
		if (inflight || eventTimer !== undefined) return;
		const delay = Math.max(0, lastStart + EVENT_INTERVAL_MS - Date.now());
		if (delay === 0) {
			void run();
			return;
		}
		eventTimer = window.setTimeout(() => {
			eventTimer = undefined;
			void run();
		}, delay);
	}

	return {
		refresh: run,
		notify,
		setVisible(next) {
			if (disposed || next === visible) return;
			visible = next;
			if (visible) {
				// Resume immediately from the retained byte cursor, not from the start of the file.
				void run();
				return;
			}
			clearTimers();
			pending = false;
			inflight?.controller.abort();
			inflight = null;
		},
		dispose() {
			disposed = true;
			visible = false;
			pending = false;
			clearTimers();
			inflight?.controller.abort();
			inflight = null;
		},
	};
}
