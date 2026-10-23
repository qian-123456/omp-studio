import { describe, expect, it } from "vitest";
import { abbreviateThinking, mergedSuffix, pickToolbarTier } from "./composerToolbar";

const base = {
	modelLabel: "gemini-3.8-flash",
	thinkingKind: "levels" as const,
	thinkingLevel: "high",
};

describe("pickToolbarTier", () => {
	it("is full when wide or unmeasured", () => {
		expect(pickToolbarTier({ ...base, width: 640 })).toBe(0);
		expect(pickToolbarTier({ ...base, width: 0 })).toBe(0);
	});
	it("collapses monotonically as width shrinks", () => {
		let prev = 0;
		for (let w = 700; w >= 100; w -= 10) {
			const t = pickToolbarTier({ ...base, width: w });
			expect(t).toBeGreaterThanOrEqual(prev);
			prev = t;
		}
		expect(prev).toBe(4);
	});
	it("merges the chips on a narrow side-chat composer", () => {
		expect(pickToolbarTier({ ...base, width: 280 })).toBeGreaterThanOrEqual(3);
	});
});

describe("merged chip text", () => {
	it("abbreviates levels", () => {
		expect(abbreviateThinking("xhigh")).toBe("xhi");
		expect(abbreviateThinking("custom")).toBe("cus");
	});
	it("suffix per state", () => {
		expect(mergedSuffix("levels", "high", false)).toBe(" · high");
		expect(mergedSuffix("levels", "high", true)).toBe(" · hi");
		expect(mergedSuffix("unsupported", "auto", false)).toBe("");
		expect(mergedSuffix("unconfigured", "auto", false)).toBe(" · 未配置");
	});
});
