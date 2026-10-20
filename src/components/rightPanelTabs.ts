/**
 * Pure layout math for the right panel's Chrome-style tab strip.
 * Kept component-free so the capacity decisions can be unit-tested.
 */

/** Widest a tab grows to; below the cap all tabs share the row width equally (Chrome-style). */
export const MAX_TAB_WIDTH = 160;
/** Narrowest a tab may shrink to (≈ icon + close) before it moves into the overflow menu. */
export const MIN_TAB_WIDTH = 64;
/** Air gap between adjacent tab boxes; the separator hairline is drawn inside it. */
export const TAB_GAP = 2;

/** Fixed `w-7` width of the '+' button that always trails the tab row. */
export const PLUS_BTN_WIDTH = 28;
/**
 * First-render estimate for the '+N' overflow button (padding + label +
 * chevron). The real width is measured via ResizeObserver once mounted;
 * overestimating here only costs a few px of tab room for one frame.
 */
export const MORE_BTN_FALLBACK_WIDTH = 44;
/** `gap-1` spacing between the children of the measured flex-1 wrapper. */
export const WRAPPER_GAP = 4;

/**
 * Tabs that fit in `room` px once every tab has shrunk to MIN_TAB_WIDTH:
 * n tabs need n·MIN_TAB_WIDTH + (n−1)·TAB_GAP, so n ≤ (room+gap)/(min+gap).
 * Always at least one slot — a lone tab clips under `overflow-hidden`
 * instead of vanishing into the menu.
 */
export function tabsFit(room: number): number {
	return Math.max(1, Math.floor((room + TAB_GAP) / (MIN_TAB_WIDTH + TAB_GAP)));
}

/**
 * How many of `tabCount` tabs the strip may render inline. `wrapperWidth` is
 * the measured width of the flex-1 container that hosts [tabs, '+N', '+'];
 * `fixedWidth`/`overflowWidth` are the '+' and '+N' buttons and `gap` the
 * wrapper's inter-child gap.
 *
 * Two passes keep the overflow button from oscillating: capacity is first
 * computed without reserving it; if every tab fits, that stands. Otherwise
 * the button is definitely needed, so reserve it and recompute — the second
 * pass can only yield fewer slots, never enough to make the button vanish.
 */
export function tabRowCapacity(
	wrapperWidth: number,
	tabCount: number,
	fixedWidth: number = PLUS_BTN_WIDTH,
	overflowWidth: number = MORE_BTN_FALLBACK_WIDTH,
	gap: number = WRAPPER_GAP,
): number {
	const withoutOverflow = tabsFit(wrapperWidth - fixedWidth - gap);
	if (tabCount <= withoutOverflow) return withoutOverflow;
	return tabsFit(wrapperWidth - fixedWidth - overflowWidth - 2 * gap);
}

/**
 * First `capacity` items in store order, except an active tab that would be
 * hidden is swapped into the last slot so it stays on screen.
 */
export function visibleTabs<T extends { active: boolean }>(items: T[], capacity: number): T[] {
	// A strip always keeps at least one slot; slice(0, 0 / negative) would drop
	// or wrongly keep tabs and the active-swap below would index slot -1.
	const slots = Math.max(1, Math.floor(capacity) || 1);
	if (items.length <= slots) return items;
	let shown = items.slice(0, slots);
	const active = items.find((t) => t.active);
	if (active && !shown.includes(active)) shown = [...shown.slice(0, slots - 1), active];
	return shown;
}
