import { beforeEach, describe, expect, it } from "vitest";
import type { ProviderConfig } from "../../lib/contracts";
import type { ThreeTierConfig } from "./modelContextTypes";
import {
	THREE_TIER_STORAGE_KEY,
	applyContextUpdates,
	cleanModelId,
	computeThreeTierUpdates,
	groupModels,
	isPrimaryModel,
	loadThreeTierConfig,
	normalizeModelName,
	parseContextInput,
	resolveGroupContext,
	saveThreeTierConfig,
} from "./modelNormalization";

// Node test env: minimal localStorage stub.
const mem = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => mem.get(k) ?? null,
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
	key: () => null,
	get length() {
		return mem.size;
	},
} as Storage;

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

describe("normalizeModelName (Brand and Tier identification)", () => {
	it.each([
		["claude-opus-5.5", "Claude Opus 5.5", "Claude", "claude-opus"],
		["claude-opus-5-5", "Claude Opus 5.5", "Claude", "claude-opus"],
		["OPUS-5.5", "Claude Opus 5.5", "Claude", "claude-opus"],
		["opus-5-5", "Claude Opus 5.5", "Claude", "claude-opus"],
		["OOPS 5.5", "Claude Opus 5.5", "Claude", "claude-opus"],
		["5-5", "Claude Opus 5.5", "Claude", "claude-opus"],
		["anthropic/claude-opus-5.5-20260101", "Claude Opus 5.5", "Claude", "claude-opus"],
		["claude-3-7-sonnet-latest", "Claude 3.7 Sonnet", "Claude", "claude-sonnet"],
		["anthropic/claude-3.5-sonnet", "Claude 3.5 Sonnet", "Claude", "claude-sonnet"],
		["claude-3-5-haiku-20241022", "Claude 3.5 Haiku", "Claude", "claude-haiku"],
		["gpt-6-astra", "GPT-6 Astra", "GPT", "gpt-flagship"],
		["openai/gpt-6-astra", "GPT-6 Astra", "GPT", "gpt-flagship"],
		["astra-6", "GPT-6 Astra", "GPT", "gpt-flagship"],
		["gpt-4o", "GPT-4o", "GPT", "gpt-balanced"],
		["gpt-4o-mini", "GPT-4o mini", "GPT", "gpt-mini"],
		["o1-preview", "OpenAI o1", "GPT", "gpt-flagship"],
		["o3-mini", "OpenAI o3-mini", "GPT", "gpt-mini"],
		["gemini-3.8-flash", "Gemini 3.8 Flash", "Gemini", "gemini-flash"],
		["gemini-flash-3.8", "Gemini 3.8 Flash", "Gemini", "gemini-flash"],
		["gemini-2.5-pro", "Gemini 2.5 Pro", "Gemini", "gemini-pro"],
		["deepseek/deepseek-chat", "DeepSeek V3 / Chat", "DeepSeek", "deepseek-v3"],
		["deepseek-r1", "DeepSeek R1", "DeepSeek", "deepseek-r1"],
	])("%s → name: %s, family: %s, tier: %s", (raw, name, family, tier) => {
		const res = normalizeModelName(raw);
		expect(res.name).toBe(name);
		expect(res.family).toBe(family);
		expect(res.tier).toBe(tier);
	});
});

describe("groupModels", () => {
	it("clusters heterogeneous names across providers and flags unification", () => {
		const groups = groupModels([
			provider("p1", ["claude-opus-5.5", { id: "gpt-6-astra", contextWindow: 272_000 }]),
			provider("p2", [
				{ id: "OPUS-5-5", contextWindow: 300_000 },
				{ id: "openai/gpt-6-astra", contextWindow: 272_000 },
			]),
		]);
		const opus = groups.find((g) => g.name === "Claude Opus 5.5");
		const astra = groups.find((g) => g.name === "GPT-6 Astra");
		expect(opus?.sources.map((s) => s.modelId)).toEqual(["claude-opus-5.5", "OPUS-5-5"]);
		expect(opus?.unified).toBe(false);
		expect(astra?.sources).toHaveLength(2);
		expect(astra?.unified).toBe(true);
	});
});

describe("Three-Tier Context Resolution (同品牌 -> 同档位 -> 同模型)", () => {
	const groups = groupModels([
		provider("p1", [
			"claude-opus-5.5",
			"claude-3-5-sonnet",
			"gpt-4o",
			"gpt-6-astra",
			"deepseek-r1",
			"misc-unknown-model",
		]),
	]);

	const opusGroup = groups.find((g) => g.name === "Claude Opus 5.5")!;
	const sonnetGroup = groups.find((g) => g.name === "Claude 3.5 Sonnet")!;
	const gpt4oGroup = groups.find((g) => g.name === "GPT-4o")!;
	const unknownGroup = groups.find((g) => g.name === "misc-unknown-model")!;

	it("inherits from Brand default when no tier or model override is set", () => {
		const config: ThreeTierConfig = {
			brands: { Claude: 200_000, GPT: 272_000 },
			tiers: {},
			models: {},
		};
		const resOpus = resolveGroupContext(opusGroup, config);
		expect(resOpus.value).toBe(200_000);
		expect(resOpus.source).toBe("brand");

		const resGpt = resolveGroupContext(gpt4oGroup, config);
		expect(resGpt.value).toBe(272_000);
		expect(resGpt.source).toBe("brand");
	});

	it("Tier-level setting overrides Brand-level default", () => {
		const config: ThreeTierConfig = {
			brands: { Claude: 200_000 },
			tiers: { "claude-opus": 300_000, "claude-sonnet": 250_000 },
			models: {},
		};
		const resOpus = resolveGroupContext(opusGroup, config);
		expect(resOpus.value).toBe(300_000);
		expect(resOpus.source).toBe("tier");

		const resSonnet = resolveGroupContext(sonnetGroup, config);
		expect(resSonnet.value).toBe(250_000);
		expect(resSonnet.source).toBe("tier");
	});

	it("Model-level setting overrides both Tier-level and Brand-level settings", () => {
		const config: ThreeTierConfig = {
			brands: { Claude: 200_000 },
			tiers: { "claude-opus": 300_000 },
			models: { [opusGroup.key]: 350_000 },
		};
		const resOpus = resolveGroupContext(opusGroup, config);
		expect(resOpus.value).toBe(350_000);
		expect(resOpus.source).toBe("model");
	});

	it("handles unconfigured unknown models gracefully", () => {
		const config: ThreeTierConfig = {
			brands: {},
			tiers: {},
			models: {},
		};
		const res = resolveGroupContext(unknownGroup, config);
		expect(res.value).toBeNull();
		expect(res.source).toBe("none");
	});
});

describe("Primary vs Secondary Model Filter", () => {
	const groups = groupModels([
		provider("p1", [
			"claude-opus-5.5",
			"gpt-4o",
			"misc-old-test-model-1",
			"misc-old-test-model-2",
		]),
	]);
	const opusGroup = groups.find((g) => g.name === "Claude Opus 5.5")!;
	const gptGroup = groups.find((g) => g.name === "GPT-4o")!;
	const obscureGroup = groups.find((g) => g.name === "misc-old-test-model-1")!;

	it("classifies mainstream models as primary", () => {
		expect(isPrimaryModel(opusGroup)).toBe(true);
		expect(isPrimaryModel(gptGroup)).toBe(true);
	});

	it("classifies unknown unconfigured models as secondary", () => {
		expect(isPrimaryModel(obscureGroup)).toBe(false);
	});

	it("promotes secondary model to primary if used in sessions or configured in roles", () => {
		expect(
			isPrimaryModel(obscureGroup, {
				activeSessionModels: new Set(["misc-old-test-model-1"]),
			}),
		).toBe(true);

		expect(
			isPrimaryModel(obscureGroup, {
				roleModels: new Set(["misc-old-test-model-1"]),
			}),
		).toBe(true);

		expect(
			isPrimaryModel(obscureGroup, {
				hasCustomConfig: true,
			}),
		).toBe(true);
	});
});

describe("computeThreeTierUpdates & applyContextUpdates", () => {
	it("updates only targeted models, converts string entries to specs, never touches provider defaultContextWindow", () => {
		const p1 = provider("p1", ["claude-opus-5.5", "unrelated-model"], 64_000);
		const p2 = provider("p2", [{ id: "OPUS-5-5", contextWindow: 100_000 }], 32_000);
		const groups = groupModels([p1, p2]);

		const config: ThreeTierConfig = {
			brands: {},
			tiers: { "claude-opus": 300_000 },
			models: {},
		};

		const updates = computeThreeTierUpdates([p1, p2], groups, config);
		expect(updates).toEqual([
			{ providerId: "p1", modelId: "claude-opus-5.5", contextWindow: 300_000 },
			{ providerId: "p2", modelId: "OPUS-5-5", contextWindow: 300_000 },
		]);

		const changed = applyContextUpdates([p1, p2], updates);
		expect(changed).toHaveLength(2);

		// Provider defaultContextWindow remains intact!
		expect(changed[0].defaultContextWindow).toBe(64_000);
		expect(changed[1].defaultContextWindow).toBe(32_000);

		// Models array is properly updated with ModelSpec!
		expect(changed[0].models[0]).toEqual({
			id: "claude-opus-5.5",
			contextWindow: 300_000,
		});
		expect(changed[0].models[1]).toBe("unrelated-model"); // Unrelated model untouched!
		expect(changed[1].models[0]).toEqual({
			id: "OPUS-5-5",
			contextWindow: 300_000,
		});
	});
});

describe("parseContextInput", () => {
	it.each([
		["300k", 300_000],
		["30万", 300_000],
		["272K", 272_000],
		["250000", 250_000],
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

describe("ThreeTierConfig persistence", () => {
	beforeEach(() => localStorage.clear());

	it("round-trips brand, tier, and model configs", () => {
		const config: ThreeTierConfig = {
			brands: { Claude: 200_000, GPT: 272_000 },
			tiers: { "claude-opus": 300_000 },
			models: { "claude-opus-5.5": 350_000 },
		};
		saveThreeTierConfig(config);
		const loaded = loadThreeTierConfig();
		expect(loaded).toEqual(config);
	});

	it("handles corrupted storage gracefully", () => {
		localStorage.setItem(THREE_TIER_STORAGE_KEY, "invalid-json");
		const loaded = loadThreeTierConfig();
		expect(loaded).toEqual({ brands: {}, tiers: {}, models: {} });
	});
});
