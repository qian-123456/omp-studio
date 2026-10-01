import { useSyncExternalStore } from "react";

/**
 * Shared minute tick timer: single module-level interval driving all session rows
 * (R3). Avoids hundreds of individual intervals while ensuring "刚刚" / "3分钟"
 * increments accurately as time passes.
 */
let currentMinute = Math.floor(Date.now() / 60_000);
const listeners = new Set<() => void>();
let intervalId: number | null = null;

function subscribe(callback: () => void): () => void {
	listeners.add(callback);
	if (listeners.size === 1 && typeof window !== "undefined") {
		// Check every 10 seconds to catch minute boundaries promptly
		intervalId = window.setInterval(() => {
			const nextMinute = Math.floor(Date.now() / 60_000);
			if (nextMinute !== currentMinute) {
				currentMinute = nextMinute;
				listeners.forEach((listener) => listener());
			}
		}, 10_000);
	}
	return () => {
		listeners.delete(callback);
		if (listeners.size === 0 && intervalId !== null) {
			clearInterval(intervalId);
			intervalId = null;
		}
	};
}

function getSnapshot(): number {
	return currentMinute;
}

export function useMinuteTick(): number {
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
