import { describe, expect, it } from "vitest";
import type { ModelOption } from "../../lib/models";
import {
	resolveSideChatModel,
	sideChatModelLabel,
	sideChatSelectorUsable,
} from "./modelDefault";

const CATALOG: ModelOption[] = [
	{ provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet" },
	{ provider: "openai", id: "gpt-5", name: "GPT-5" },
];

describe("sideChatSelectorUsable", () => {
	it("accepts catalog keys", () => {
		expect(sideChatSelectorUsable("openai/gpt-5", CATALOG)).toBe(true);
	});
	it("accepts omp role selectors", () => {
		expect(sideChatSelectorUsable("smol", CATALOG)).toBe(true);
		expect(sideChatSelectorUsable("@slow", CATALOG)).toBe(true);
	});
	it("rejects selectors missing from a loaded catalog", () => {
		expect(sideChatSelectorUsable("anthropic/gone", CATALOG)).toBe(false);
		expect(sideChatSelectorUsable("custom-model", CATALOG)).toBe(false);
	});
	it("assumes usable while the catalog is not loaded yet", () => {
		expect(sideChatSelectorUsable("anything/x", null)).toBe(true);
	});
	it("rejects empty selectors", () => {
		expect(sideChatSelectorUsable("", CATALOG)).toBe(false);
	});
});

describe("resolveSideChatModel", () => {
	it("inherits the parent model when neither picker nor setting is set", () => {
		const r = resolveSideChatModel("", null, CATALOG);
		expect(r).toEqual({ selector: "", level: null, source: "parent" });
	});
	it("uses the dedicated setting when its selector is available", () => {
		const r = resolveSideChatModel("", "openai/gpt-5", CATALOG);
		expect(r).toEqual({ selector: "openai/gpt-5", level: null, source: "setting" });
	});
	it("keeps the thinking suffix carried by the setting", () => {
		const r = resolveSideChatModel("", "openai/gpt-5:high", CATALOG);
		expect(r).toEqual({ selector: "openai/gpt-5", level: "high", source: "setting" });
	});
	it("uses the setting before the catalog has loaded (optimistic)", () => {
		const r = resolveSideChatModel("", "openai/gpt-5", null);
		expect(r.source).toBe("setting");
	});
	it("falls back to the parent model when the setting is unavailable", () => {
		const r = resolveSideChatModel("", "anthropic/removed-model", CATALOG);
		expect(r).toEqual({ selector: "", level: null, source: "parent" });
	});
	it("treats a whitespace-only setting as unset", () => {
		expect(resolveSideChatModel("", "   ", CATALOG).source).toBe("parent");
	});
	it("an explicit picker choice wins over the setting", () => {
		const r = resolveSideChatModel("anthropic/claude-sonnet-4-5", "openai/gpt-5:high", CATALOG);
		expect(r).toEqual({ selector: "anthropic/claude-sonnet-4-5", level: null, source: "picker" });
	});
	it("keeps picker priority even when the setting is unavailable", () => {
		const r = resolveSideChatModel("openai/gpt-5", "anthropic/gone", CATALOG);
		expect(r.source).toBe("picker");
	});
});

describe("sideChatModelLabel", () => {
	it("returns empty for unset", () => {
		expect(sideChatModelLabel(null, CATALOG)).toBe("");
		expect(sideChatModelLabel(" ", CATALOG)).toBe("");
	});
	it("labels catalog models with their id", () => {
		expect(sideChatModelLabel("openai/gpt-5", CATALOG)).toBe("gpt-5");
	});
	it("appends the thinking suffix", () => {
		expect(sideChatModelLabel("openai/gpt-5:high", CATALOG)).toBe("gpt-5 · high");
	});
	it("labels roles with their display name", () => {
		expect(sideChatModelLabel("smol", CATALOG)).toBe("快速模型 (smol)");
	});
	it("labels unknown selectors verbatim", () => {
		expect(sideChatModelLabel("vendor/gone:low", CATALOG)).toBe("vendor/gone · low");
	});
});
