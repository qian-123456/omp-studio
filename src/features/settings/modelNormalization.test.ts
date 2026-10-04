import { describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../lib/contracts";
import { applyContextUpdates, cleanModelId, matchKey, parseContextInput, ruleMatches, tokenizeModelId } from "./modelNormalization";

function provider(
	id: string,
	models: ProviderConfig["models"],
	defaultContextWindow: number | null = null,
): ProviderConfig {
	return {
		id,
		name: `Provider-${id}`,
		slug: id,
		presetId: null,
		baseUrl: "https://example.com/v1",
		api: "anthropic",
		envVar: "API_KEY",
		models,
		defaultModel: null,
		defaultContextWindow,
		defaultMaxTokens: null,
		enabled: true,
		sort: 0,
		hasKey: false,
		keyHint: null,
		notes: null,
		createdAt: "",
		updatedAt: "",
	};
}

describe("cleanModelId", () => {
	it("strips vendor prefixes and date/variant suffixes", () => {
		expect(cleanModelId("anthropic/claude-3-5-sonnet-20241022")).toBe("claude-3-5-sonnet");
		expect(cleanModelId("openrouter/deepseek/deepseek-r1:free")).toBe("deepseek-r1");
		expect(cleanModelId("gpt-4o-2024-08-06")).toBe("gpt-4o");
		expect(cleanModelId("Claude-3-7-Sonnet-latest")).toBe("claude-3-7-sonnet");
	});
});

const rule = (_id: string, keywords: string[]) => ({ keywords });

describe("tokenizeModelId / matchKey", () => {
	it("merges numeric runs into versions and keeps alnum tokens", () => {
		expect(tokenizeModelId("claude-opus-5-5")).toEqual(["claude", "opus", "5.5"]);
		expect(tokenizeModelId("gpt-4o-mini")).toEqual(["gpt", "4o", "mini"]);
		expect(tokenizeModelId("deepseek-v3")).toEqual(["deepseek", "v3"]);
	});

	it.each([
		["claude-opus-5-5", "opus-5.5", "Opus 5.5"],
		["OPUS-5.5", "opus-5.5", "Opus 5.5"],
		["anthropic/claude-opus-5.5-20260101", "opus-5.5", "Opus 5.5"],
		["gpt-5.2-chat", "gpt-5.2-chat", "GPT-5.2 Chat"],
		["gpt-4o", "gpt-4o", "GPT-4o"],
		["deepseek-v3", "deepseek-v3", "DeepSeek V3"],
	])("%s → %s / %s", (raw, key, name) => {
		expect(matchKey(raw)).toEqual({ key, name });
	});
});

describe("ruleMatches", () => {
	it("requires every keyword (AND)", () => {
		expect(ruleMatches(rule("a", ["opus", "5.5"]), "claude-opus-5-5")).toBe(true);
		expect(ruleMatches(rule("a", ["opus", "5.5"]), "claude-opus-4")).toBe(false);
		expect(ruleMatches(rule("a", ["opus", "5.5"]), "claude-sonnet-5.5")).toBe(false);
	});

	it("tolerates small typos on longer words", () => {
		expect(ruleMatches(rule("a", ["oops", "5.5"]), "claude-opus-5.5")).toBe(true);
		expect(ruleMatches(rule("a", ["sonet"]), "claude-sonnet-4")).toBe(true);
		expect(ruleMatches(rule("a", ["plus"]), "claude-opus-4")).toBe(false);
	});

	it("never matches with no keywords", () => {
		expect(ruleMatches(rule("a", []), "claude-opus-5.5")).toBe(false);
		expect(ruleMatches(rule("a", ["  "]), "claude-opus-5.5")).toBe(false);
	});

});

describe("parseContextInput", () => {
	it.each([
		["300k", 300_000],
		["30万", 300_000],
		["272K", 272_000],
		["250000", 250_000],
		["200", 200_000],
		["128", 128_000],
		["1000", 1_000],
		["250,000", 250_000],
		["1M", 1_000_000],
		["1.5m", 1_500_000],
	])("%s → %d", (input, n) => {
		expect(parseContextInput(input)).toBe(n);
	});

	it.each(["", "abc", "0", "-5k", "12x"])("rejects invalid input %s", (input) => {
		expect(parseContextInput(input)).toBeNull();
	});
});

describe("applyContextUpdates", () => {
	it("sets and removes per-model values without touching defaultContextWindow", () => {
		const p1 = provider("p1", ["a", { id: "b", contextWindow: 100_000 }, { id: "c", contextWindow: 1, maxTokens: 9 }], 64_000);
		const [changed] = applyContextUpdates(
			[p1],
			[
				{ providerId: "p1", modelId: "a", contextWindow: 300_000 },
				{ providerId: "p1", modelId: "b", contextWindow: null },
				{ providerId: "p1", modelId: "c", contextWindow: null },
			],
		);
		expect(changed.defaultContextWindow).toBe(64_000);
		expect(changed.models).toEqual([{ id: "a", contextWindow: 300_000 }, "b", { id: "c", maxTokens: 9 }]);
	});
});
