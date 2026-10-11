import { describe, expect, it } from "vitest";
import { resolveThinkingLevels } from "./models";

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
