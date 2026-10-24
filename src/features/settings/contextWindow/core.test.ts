import { describe, expect, it } from "vitest";
import {
	type ContextWindowRule,
	compactionTriggerPoint,
	pickRule,
	ruleKeywordsForBrand,
	selectionState,
	resolveNewModelWindow,
	ruleKeywordsForSelection,
} from "./core";
import { ruleMatches } from "../modelNormalization";

const rule = (id: string, keywords: string[], contextWindow: number, createdAt: number): ContextWindowRule => ({
	id,
	keywords,
	contextWindow,
	createdAt,
});

describe("pickRule", () => {
	const broad = rule("broad", ["opus"], 200_000, 3);
	const specific = rule("specific", ["opus", "4.6"], 1_000_000, 1);

	it("prefers the rule with more keywords regardless of creation order", () => {
		expect(pickRule([broad, specific], "claude-opus-4-6")?.id).toBe("specific");
		expect(pickRule([specific, broad], "claude-opus-4-6")?.id).toBe("specific");
		expect(pickRule([broad, specific], "claude-opus-4-1")?.id).toBe("broad");
	});

	it("breaks keyword-count ties by later createdAt", () => {
		const older = rule("older", ["opus"], 1, 10);
		const newer = rule("newer", ["opus"], 2, 20);
		expect(pickRule([newer, older], "claude-opus-4")?.id).toBe("newer");
		expect(pickRule([older, newer], "claude-opus-4")?.id).toBe("newer");
	});

	it("returns null when nothing matches", () => {
		expect(pickRule([broad], "gpt-5")).toBeNull();
	});
});

describe("compactionTriggerPoint", () => {
	it("scales the window in percent mode", () => {
		expect(compactionTriggerPoint(200_000, { mode: "percent", value: 80 })).toEqual({ tokens: 160_000, unreachable: false });
	});

	it("flags token thresholds at or above the window as unreachable", () => {
		expect(compactionTriggerPoint(200_000, { mode: "tokens", value: 150_000 })).toEqual({ tokens: 150_000, unreachable: false });
		expect(compactionTriggerPoint(200_000, { mode: "tokens", value: 200_000 }).unreachable).toBe(true);
		expect(compactionTriggerPoint(128_000, { mode: "tokens", value: 200_000 }).unreachable).toBe(true);
	});
});

describe("resolveNewModelWindow", () => {
	const rules = [rule("r", ["opus"], 1_000_000, 1)];

	it("follows rule → catalog → provider default", () => {
		const base = { modelId: "claude-opus-4", catalogWindow: 200_000, providerDefault: 128_000 };
		expect(resolveNewModelWindow({ ...base, rules })).toEqual({ value: 1_000_000, source: "rule" });
		expect(resolveNewModelWindow({ ...base, rules: [] })).toEqual({ value: 200_000, source: "catalog" });
		expect(resolveNewModelWindow({ ...base, rules: [], catalogWindow: null })).toEqual({
			value: 128_000,
			source: "providerDefault",
		});
	});

	it("returns null when every source is missing", () => {
		expect(resolveNewModelWindow({ modelId: "claude-opus-4", rules: [], catalogWindow: null, providerDefault: null })).toBeNull();
	});
});

describe("ruleKeywordsForSelection", () => {
	it("locks to one model when all selected ids normalize to it", () => {
		const kws = ruleKeywordsForSelection(["gemini-3.8-flash", "google/gemini-3-8-flash", "gemini-3.8-flash-latest"]);
		expect(kws).toEqual(["gemini", "3.8", "flash"]);
		expect(ruleMatches({ keywords: kws }, "gemini-3-8-flash")).toBe(true);
		expect(ruleMatches({ keywords: kws }, "gemini-3.8-pro")).toBe(false);
	});

	it("uses every token shared by all selected models, ignoring vendor prefixes", () => {
		expect(ruleKeywordsForSelection(["gemini-3.7-flash", "gemini-3.8-flash"])).toEqual(["gemini", "flash"]);
		expect(ruleKeywordsForSelection(["opus-5.5", "opus-4.8", "opus-4.7"])).toEqual(["opus"]);
		expect(ruleKeywordsForSelection(["claude-opus-5-5", "opus-4.8", "claude-opus-4-7"])).toEqual(["opus"]);
		expect(ruleKeywordsForSelection(["gpt-5.2-mini", "gpt-5.2-nano"])).toEqual(["gpt", "5.2"]);
	});

	it("returns no keywords when the selection shares no name", () => {
		expect(ruleKeywordsForSelection(["gpt-5", "deepseek-v3"])).toEqual([]);
	});
});

describe("selectionState", () => {
	it("is tri-state over the filtered keys", () => {
		const keys = ["a/1", "a/2", "b/1"];
		expect(selectionState(keys, new Set())).toBe("none");
		expect(selectionState(keys, new Set(["a/1", "zzz"]))).toBe("some");
		expect(selectionState(keys, new Set(keys))).toBe("all");
		expect(selectionState([], new Set(keys))).toBe("none");
	});
});

describe("ruleKeywordsForBrand", () => {
	const glm = ["glm-5.3-flash-free", "z-ai/glm-4.6", "glm-5.3-flash-free"];
	it("uses the brand name for a whole-brand selection", () => {
		expect(ruleKeywordsForBrand("GLM", true, ["glm-5.3-flash-free"])).toEqual(["glm"]);
		expect(ruleKeywordsForBrand("GLM", true, glm)).toEqual(["glm"]);
	});
	it("falls back to the model tokens when not the whole brand or brand name is absent", () => {
		expect(ruleKeywordsForBrand("GLM", false, ["glm-5.3-flash-free"])).toEqual(ruleKeywordsForSelection(["glm-5.3-flash-free"]));
		expect(ruleKeywordsForBrand("GLM", true, ["zhipu-x", "zai-y"])).toEqual([]);
		expect(ruleKeywordsForBrand("other", true, ["foo-1", "foo-2"])).toEqual(["foo"]);
	});
});
