import { describe, expect, it } from "vitest";
import { cappedDpr, extendStroke, startStroke, undoStroke } from "./sketchModel";

describe("sketchModel", () => {
	it("starts, extends and undoes strokes without mutating the previous list", () => {
		const a = startStroke([], "#111111", 6, [1, 2]);
		const b = startStroke(a, "#e5372e", 3, [5, 5]);
		extendStroke(b, [6, 7]);
		expect(a).toHaveLength(1);
		expect(b[1].pts).toEqual([
			[5, 5],
			[6, 7],
		]);
		expect(undoStroke(b)).toEqual([a[0]]);
		expect(undoStroke([])).toEqual([]);
	});

	it("caps dpr at 2 and defaults invalid values to 1", () => {
		expect(cappedDpr(3)).toBe(2);
		expect(cappedDpr(1.5)).toBe(1.5);
		expect(cappedDpr(0)).toBe(1);
		expect(cappedDpr(Number.NaN)).toBe(1);
	});
});
