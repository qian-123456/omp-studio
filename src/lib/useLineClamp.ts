import { type RefObject, useLayoutEffect, useState } from "react";

/** Fraction of a line the natural height may exceed the clamp by before text counts as hidden. */
const SLACK_LINES = 0.5;

/** True when `naturalHeight` needs more than `lines` lines (inline chips make line boxes slightly taller). */
export function exceedsLines(naturalHeight: number, lineHeight: number, lines: number): boolean {
	return naturalHeight > lineHeight * (lines + SLACK_LINES);
}

function lineHeightOf(el: HTMLElement): number {
	const cs = getComputedStyle(el);
	const lh = Number.parseFloat(cs.lineHeight);
	if (Number.isFinite(lh)) return lh;
	const fs = Number.parseFloat(cs.fontSize);
	return (Number.isFinite(fs) ? fs : 16) * 1.2;
}

/**
 * Whether `ref`'s content really needs more than `lines` lines.
 *
 * Measures the UNclamped height (clamp class removed while measuring) so a block that fits
 * is never rendered clamped: the browser draws a clamp ellipsis whenever the clamp box is
 * even slightly shorter than its content (e.g. a taller inline chip), which leaves an "…"
 * with nothing hidden behind it. Re-measures on every size change.
 */
export function useLineClampOverflow(
	ref: RefObject<HTMLElement | null>,
	clampClass: string,
	lines: number,
	deps: readonly unknown[],
): boolean {
	const [overflowing, setOverflowing] = useState(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: deps are supplied by the caller
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const measure = () => {
			const had = el.classList.contains(clampClass);
			if (had) el.classList.remove(clampClass);
			const natural = el.scrollHeight;
			if (had) el.classList.add(clampClass);
			setOverflowing(exceedsLines(natural, lineHeightOf(el), lines));
		};
		measure();
		const ro = new ResizeObserver(measure);
		ro.observe(el);
		return () => ro.disconnect();
	}, [ref, clampClass, lines, ...deps]);
	return overflowing;
}
