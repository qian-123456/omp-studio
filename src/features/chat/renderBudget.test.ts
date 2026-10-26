import { describe, expect, it } from "vitest";
import {
	calculateBlockCost,
	MAX_OVERSCAN_COST,
	MAX_OVERSCAN_HEIGHT_PX,
	selectRenderIndexes,
	selectTailIndexes,
} from "./renderBudget";

describe("calculateBlockCost", () => {
	it("weights height, chars, code blocks and tool calls", () => {
		expect(calculateBlockCost({ height: 500, chars: 1600, codeBlocks: 2, toolCalls: 10 })).toBeCloseTo(
			5 + 2 + 3 + 3,
		);
		expect(calculateBlockCost({ height: 0, chars: 0, codeBlocks: 0, toolCalls: 0 })).toBe(0);
	});
});

const uniform = (height: number, cost: number) => ({
	heightOf: () => height,
	costOf: () => cost,
});

describe("selectRenderIndexes", () => {
	it("mounts neighbours until the height budget is covered on each side", () => {
		const out = selectRenderIndexes({ count: 100, startIndex: 50, endIndex: 52, ...uniform(400, 4) });
		// 400px rows: 3 rows reach 1200 >= 900 → third one is the last added.
		expect(out[0]).toBe(47);
		expect(out[out.length - 1]).toBe(55);
		expect(out).toEqual([47, 48, 49, 50, 51, 52, 53, 54, 55]);
	});

	it("stops at the cost budget even when height budget is unused", () => {
		const out = selectRenderIndexes({ count: 100, startIndex: 50, endIndex: 50, ...uniform(10, 10) });
		// cost 10 per row: two fit (20 <= 25), a third would reach 30.
		expect(out).toEqual([48, 49, 50, 51, 52]);
		expect(MAX_OVERSCAN_COST).toBe(25);
	});

	it("never mounts a neighbour that alone breaks the cost budget", () => {
		const out = selectRenderIndexes({ count: 10, startIndex: 5, endIndex: 5, ...uniform(3000, 40) });
		expect(out).toEqual([5]);
	});

	it("clamps to the list bounds and keeps indexes ascending and unique", () => {
		const out = selectRenderIndexes({ count: 3, startIndex: 0, endIndex: 2, ...uniform(100, 1) });
		expect(out).toEqual([0, 1, 2]);
		expect(selectRenderIndexes({ count: 0, startIndex: 0, endIndex: 0, ...uniform(1, 1) })).toEqual([]);
	});

	it("uses measured heights supplied by heightOf", () => {
		const heights = [100, 100, 100, 1000, 100, 100];
		const out = selectRenderIndexes({
			count: 6,
			startIndex: 3,
			endIndex: 3,
			heightOf: (i) => heights[i],
			costOf: () => 1,
		});
		// Left: 100+100+100 = 300 < 900 so all three; right: 100+100.
		expect(out).toEqual([0, 1, 2, 3, 4, 5]);
		expect(MAX_OVERSCAN_HEIGHT_PX).toBe(900);
	});
});

describe("selectTailIndexes", () => {
	it("starts at the newest rows, not the oldest, for a cold open", () => {
		const out = selectTailIndexes({ count: 500, viewportPx: 800, ...uniform(300, 3) });
		expect(out[out.length - 1]).toBe(499);
		expect(out[0]).toBeGreaterThan(480);
		expect(out).not.toContain(0);
	});

	it("covers the whole list when it is shorter than the viewport", () => {
		expect(selectTailIndexes({ count: 2, viewportPx: 800, ...uniform(100, 1) })).toEqual([0, 1]);
	});
});
