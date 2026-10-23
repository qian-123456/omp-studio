/**
 * Paced reveal of streamed text. Provider tokens arrive in bursts of several
 * characters; showing them as they land makes text jump in chunks. The hook
 * keeps a revealed-length cursor and advances it once per frame by a fraction
 * of the backlog, so a slow stream reveals character by character while a
 * burst drains within ~`DRAIN_FRAMES` frames (it never falls far behind).
 */

import { useEffect, useRef, useState } from "react";

/** A backlog is drained in roughly this many frames. */
export const DRAIN_FRAMES = 8;
/** Frame-less fallback: an occluded WKWebView suspends rAF indefinitely. */
const TIMER_FALLBACK_MS = 48;

/** Characters to reveal this frame: at least one, `ceil(backlog / 8)` otherwise. */
export function revealStepSize(backlog: number): number {
	return backlog <= 0 ? 0 : Math.max(1, Math.ceil(backlog / DRAIN_FRAMES));
}

/** Next revealed length for `target`, never splitting a surrogate pair. */
export function nextRevealLength(target: string, revealed: number): number {
	const len = target.length;
	if (revealed >= len) return len;
	let next = Math.min(len, revealed + revealStepSize(len - revealed));
	if (next < len) {
		const c = target.charCodeAt(next - 1);
		if (c >= 0xd800 && c <= 0xdbff) next += 1;
	}
	return next;
}

/**
 * Revealed length to use when the target changes from `prev` to `next`: kept
 * when `next` extends `prev`, otherwise rewound to the shared prefix so
 * replaced text is re-revealed instead of showing stale characters.
 */
export function reconcileRevealed(prev: string, next: string, revealed: number): number {
	if (next.startsWith(prev)) return Math.min(revealed, next.length);
	const max = Math.min(revealed, prev.length, next.length);
	let i = 0;
	while (i < max && prev.charCodeAt(i) === next.charCodeAt(i)) i++;
	return i;
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		typeof window.matchMedia === "function" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

/**
 * Returns the revealed prefix of `target`. Not streaming (or reduced motion):
 * the full text at once. Commits at most once per frame.
 */
export function useRevealText(target: string, streaming: boolean): string {
	const instant = !streaming || prefersReducedMotion();
	const revealedRef = useRef(target.length);
	const prevRef = useRef(target);
	const [, setTick] = useState(0);

	// Idempotent render-time reconciliation (safe under StrictMode double render).
	if (instant) {
		revealedRef.current = target.length;
	} else {
		revealedRef.current = reconcileRevealed(prevRef.current, target, revealedRef.current);
	}

	useEffect(() => {
		prevRef.current = target;
		if (instant) return;
		let raf: number | undefined;
		let timer: number | undefined;
		let stopped = false;
		const clear = () => {
			if (raf !== undefined) cancelAnimationFrame(raf);
			if (timer !== undefined) window.clearTimeout(timer);
			raf = timer = undefined;
		};
		const schedule = () => {
			raf = requestAnimationFrame(tick);
			timer = window.setTimeout(tick, TIMER_FALLBACK_MS);
		};
		const tick = () => {
			clear();
			if (stopped) return;
			const cur = revealedRef.current;
			const next = nextRevealLength(target, cur);
			if (next !== cur) {
				revealedRef.current = next;
				setTick((n) => n + 1);
			}
			if (next < target.length) schedule();
		};
		if (revealedRef.current < target.length) schedule();
		return () => {
			stopped = true;
			clear();
		};
	}, [target, instant]);

	return instant || revealedRef.current >= target.length
		? target
		: target.slice(0, revealedRef.current);
}
