import { describe, expect, it } from "vitest";
import { estimateTokenRange, formatTokenEstimate } from "./tokenEstimate";

describe("estimateTokenRange", () => {
	it("is zero for empty text", () => {
		expect(estimateTokenRange("")).toEqual({ low: 0, high: 0 });
	});
	it("bounds CJK at 0.7-1.5 and other chars at 1/4-1/2.5 per char", () => {
		expect(estimateTokenRange("你".repeat(100))).toEqual({ low: 70, high: 150 });
		expect(estimateTokenRange("a".repeat(100))).toEqual({ low: 25, high: 40 });
		expect(estimateTokenRange("你".repeat(10) + "a".repeat(40))).toEqual({ low: 17, high: 31 });
	});
	it("never reports less than 1 for non-empty text", () => {
		expect(estimateTokenRange("a")).toEqual({ low: 1, high: 1 });
	});
});

describe("formatTokenEstimate", () => {
	it("renders a range, compacting thousands", () => {
		expect(formatTokenEstimate("a".repeat(100))).toBe("约 25–40 token");
		expect(formatTokenEstimate("你".repeat(1000))).toBe("约 700–1.5k token");
	});
	it("collapses equal bounds", () => {
		expect(formatTokenEstimate("a")).toBe("约 1 token");
	});
});
