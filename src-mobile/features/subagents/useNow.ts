/** One shared 1 s ticker for live elapsed labels, paused whenever the document is hidden. */
import { useSyncExternalStore } from "react";

let now = Date.now();
let timer: number | undefined;
const listeners = new Set<() => void>();

function tick(): void {
	now = Date.now();
	for (const listener of listeners) listener();
}

function updateVisibility(): void {
	window.clearInterval(timer);
	timer = undefined;
	if (document.visibilityState === "hidden" || listeners.size === 0) return;
	tick();
	timer = window.setInterval(tick, 1000);
}

function subscribe(fn: () => void): () => void {
	listeners.add(fn);
	if (listeners.size === 1) {
		document.addEventListener("visibilitychange", updateVisibility);
		updateVisibility();
	}
	return () => {
		listeners.delete(fn);
		if (listeners.size === 0) {
			window.clearInterval(timer);
			timer = undefined;
			document.removeEventListener("visibilitychange", updateVisibility);
		}
	};
}

const noopSubscribe = (): (() => void) => () => {};
const getNow = (): number => now;

/** Current time in ms, re-rendering every second while `active`; static otherwise. */
export function useNow(active: boolean): number {
	return useSyncExternalStore(active ? subscribe : noopSubscribe, getNow, getNow);
}
