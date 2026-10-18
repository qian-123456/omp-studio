import { describe, expect, it } from "vitest";
import { Z_LAYER } from "../components/FloatingLayer";
import { PILL_BASE_Z, pillZIndex } from "./scrollPills";

describe("pillZIndex", () => {
	it("keeps page scrollers below every floating tier", () => {
		expect(pillZIndex([])).toBe(PILL_BASE_Z);
		expect(pillZIndex([10, 30, 20])).toBe(PILL_BASE_Z);
		expect(PILL_BASE_Z).toBeLessThan(Z_LAYER.drawer);
	});

	it("lifts scrollers inside a floating tier just above it", () => {
		expect(pillZIndex([10, Z_LAYER.popover])).toBe(Z_LAYER.popover + 1);
		expect(pillZIndex([Z_LAYER.modal, Z_LAYER.menu])).toBe(Z_LAYER.modal + 1);
	});
});
