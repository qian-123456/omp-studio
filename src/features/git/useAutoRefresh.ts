import { useEffect, useRef } from "react";

/**
 * Calls the latest `refresh` every `ms` while the window is visible; pauses while
 * document.visibilityState === "hidden", refreshes immediately on un-hide and on
 * window focus, and skips overlapping runs.
 */
export function useAutoRefresh(refresh: () => void | Promise<unknown>, ms: number) {
	const latest = useRef(refresh);
	latest.current = refresh;

	useEffect(() => {
		let timer: number | null = null;
		let inFlight = false;
		let cancelled = false;

		const clear = () => {
			if (timer !== null) {
				window.clearTimeout(timer);
				timer = null;
			}
		};

		const scheduleNext = () => {
			clear();
			if (cancelled || document.visibilityState === "hidden") return;
			timer = window.setTimeout(() => {
				void run();
			}, ms);
		};

		const run = async () => {
			if (cancelled || document.visibilityState === "hidden") return;
			if (inFlight) return;
			inFlight = true;
			try {
				await latest.current();
			} finally {
				inFlight = false;
				scheduleNext();
			}
		};

		const onVisibility = () => {
			clear();
			if (document.visibilityState === "visible") void run();
		};

		const onFocus = () => {
			if (document.visibilityState === "visible") {
				clear();
				void run();
			}
		};

		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("focus", onFocus);
		scheduleNext();

		return () => {
			cancelled = true;
			clear();
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("focus", onFocus);
		};
	}, [ms]);
}

/** Returns `prev` when `next` is structurally identical, so setState bails out of a re-render. */
export function keepIfEqual<T>(prev: T, next: T): T {
	return prev === next || JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}
