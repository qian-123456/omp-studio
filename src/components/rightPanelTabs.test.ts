import { describe, expect, it } from "vitest";
import {
	MORE_BTN_FALLBACK_WIDTH,
	MIN_TAB_WIDTH,
	PLUS_BTN_WIDTH,
	TAB_GAP,
	WRAPPER_GAP,
	tabRowCapacity,
	tabsFit,
	visibleTabs,
} from "./rightPanelTabs";

const tab = (key: string, active = false) => ({ key, active });

describe("tabsFit", () => {
	it("fits exactly the tabs that can shrink to the minimum width", () => {
		// n tabs need n*64 + (n-1)*2 px.
		expect(tabsFit(64)).toBe(1);
		expect(tabsFit(130)).toBe(2); // 64+2+64
		expect(tabsFit(131)).toBe(2);
		expect(tabsFit(196)).toBe(3); // 3*64 + 2*2
	});

	it("always leaves at least one slot even in zero room", () => {
		expect(tabsFit(0)).toBe(1);
		expect(tabsFit(-50)).toBe(1);
	});
});

describe("tabRowCapacity", () => {
	const PLUS_AND_GAP = PLUS_BTN_WIDTH + WRAPPER_GAP; // 32
	const BOTH_BTNS = PLUS_BTN_WIDTH + MORE_BTN_FALLBACK_WIDTH + 2 * WRAPPER_GAP; // 80

	it("lets every tab inline when they all fit (no overflow reservation)", () => {
		const width = 2 * MIN_TAB_WIDTH + TAB_GAP + PLUS_AND_GAP; // 162
		expect(tabRowCapacity(width, 2)).toBe(2);
	});

	it("reserves the overflow button only once tabs no longer all fit", () => {
		const width = 3 * MIN_TAB_WIDTH + 2 * TAB_GAP + PLUS_AND_GAP; // fits 3 without, 2 with
		expect(tabRowCapacity(width, 3)).toBe(3);
		expect(tabRowCapacity(width, 4)).toBe(2);
	});

	it("still shows one tab on a very narrow panel", () => {
		expect(tabRowCapacity(80, 5)).toBe(1);
		expect(tabRowCapacity(0, 5)).toBe(1);
	});

	it("reproduces the reported panel: ~302px wrapper fits the two open tabs", () => {
		expect(tabRowCapacity(302, 2)).toBe(4);
	});

	it("never oscillates: the overflow button appears exactly when tabs overflow", () => {
		for (let width = 40; width <= 700; width += 1) {
			for (let count = 1; count <= 12; count += 1) {
				const capacity = tabRowCapacity(width, count);
				const overflows = capacity < count;
				const neededWithoutButton = tabsFit(width - PLUS_AND_GAP) < count;
				// Two-pass rule: reserve the button iff it is truly required.
				expect(overflows).toBe(neededWithoutButton);
				// And the result must fit inside the room left after reserving
				// it — unless even one tab cannot fit, where it clips on purpose.
				const tabRoom = width - BOTH_BTNS;
				if (overflows && tabRoom >= MIN_TAB_WIDTH) {
					expect(capacity * MIN_TAB_WIDTH + (capacity - 1) * TAB_GAP).toBeLessThanOrEqual(
						tabRoom,
					);
				}
			}
		}
	});
});

describe("visibleTabs", () => {
	it("returns all items when they fit", () => {
		const items = [tab("a"), tab("b")];
		expect(visibleTabs(items, 4)).toEqual(items);
	});

	it("keeps store order and trims the tail", () => {
		const items = [tab("a"), tab("b"), tab("c")];
		expect(visibleTabs(items, 2)).toEqual([tab("a"), tab("b")]);
	});

	it("swaps a hidden active tab into the last slot", () => {
		const items = [tab("a"), tab("b"), tab("c", true), tab("d")];
		expect(visibleTabs(items, 3)).toEqual([tab("a"), tab("b"), tab("c", true)]);
	});

	it("keeps the active tab in place when it is already visible", () => {
		const items = [tab("a", true), tab("b"), tab("c")];
		expect(visibleTabs(items, 2)).toEqual([tab("a", true), tab("b")]);
	});

	it("never drops below one slot for a zero, negative or NaN capacity", () => {
		const items = [tab("a"), tab("b", true), tab("c")];
		for (const cap of [0, -3, Number.NaN]) {
			expect(visibleTabs(items, cap)).toEqual([tab("b", true)]);
		}
	});
});
