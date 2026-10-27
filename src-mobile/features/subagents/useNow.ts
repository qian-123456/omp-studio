/** One shared 1 s ticker for every live elapsed label; it runs only while some consumer is `active`. */
import { useSyncExternalStore } from "react";

let now = Date.now();
let timer: number | undefined;
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
	listeners.add(fn);
	if (listeners.size === 1) {
		now = Date.now();
		timer = window.setInterval(() => {
			now = Date.now();
			for (const l of listeners) l();
		}, 1000);
	}
	return () => {
		listeners.delete(fn);
		if (listeners.size === 0) clearInterval(timer);
	};
}

const noopSubscribe = (): (() => void) => () => {};
const getNow = (): number => now;

/** Current time in ms, re-rendering every second while `active`; static otherwise. */
export function useNow(active: boolean): number {
	return useSyncExternalStore(active ? subscribe : noopSubscribe, getNow, getNow);
}
