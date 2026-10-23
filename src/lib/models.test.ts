import { describe, expect, it } from "vitest";
import { parseModels, resolveThinkingLevels, thinkingChipState } from "./models";

describe("resolveThinkingLevels", () => {
	it("falls back to configured catalog levels when live metadata is unavailable", () => {
		expect(resolveThinkingLevels(undefined, ["low", "high"])).toEqual([
			"auto",
			"low",
			"high",
			"off",
		]);
	});

	it("keeps a non-auto current level even when it is not in known capabilities", () => {
		expect(resolveThinkingLevels(["low", "high"], ["medium"], "xhigh")).toEqual([
			"auto",
			"low",
			"high",
			"off",
			"xhigh",
		]);
	});

	it("does not invent an auto-only control when capabilities and current level are unknown", () => {
		expect(resolveThinkingLevels(undefined, undefined)).toEqual([]);
	});

	it("shows an unknown current level without inventing auto when capabilities are unknown", () => {
		expect(resolveThinkingLevels(undefined, undefined, "xhigh")).toEqual([
			"xhigh",
		]);
	});
});

describe("thinkingChipState", () => {
	it("shows levels when omp reports them, regardless of the reasoning flag", () => {
		const levels = resolveThinkingLevels(undefined, ["low", "high", "max"]);
		expect(thinkingChipState(levels, true)).toEqual({ kind: "levels", levels });
		expect(thinkingChipState(levels, undefined).kind).toBe("levels");
	});

	it("is 'unconfigured' for a reasoning model with no levels", () => {
		expect(thinkingChipState(resolveThinkingLevels(undefined, []), true)).toEqual({ kind: "unconfigured" });
	});

	it("is 'unsupported' when the model does not think or the flag is unknown", () => {
		expect(thinkingChipState([], false)).toEqual({ kind: "unsupported" });
		expect(thinkingChipState([], null)).toEqual({ kind: "unsupported" });
	});

	it("parseModels carries the reasoning flag", () => {
		const [m] = parseModels([{ provider: "p", id: "m", reasoning: true, thinking: [] }]);
		expect(m.reasoning).toBe(true);
	});
});
