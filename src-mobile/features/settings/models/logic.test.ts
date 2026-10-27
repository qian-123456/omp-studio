import { describe, expect, it } from "vitest";
import { thinkingOptions } from "../../../ui/ModelPicker";
import {
	KEY_MASK,
	chainHas,
	contextSetBody,
	fallbackSetBody,
	formatRoleValue,
	moveItem,
	normalizeChains,
	parseContextWindow,
	parseRoleValue,
	providerDiffRows,
	providerSaveBody,
	reconcileThinking,
	removeAt,
	roleSetBody,
	withChain,
	type CatalogModel,
	type ProviderRow,
} from "./logic";

const models: CatalogModel[] = [
	{ provider: "anthropic", id: "opus", name: "Opus", thinking: ["low", "high"] },
	{ provider: "openrouter", id: "x/model:free", name: "Free", thinking: [] },
];

describe("role value mapping", () => {
	it("formats provider/model[:thinking]", () => {
		expect(formatRoleValue("anthropic", "opus", "high")).toBe("anthropic/opus:high");
		expect(formatRoleValue("anthropic", "opus", null)).toBe("anthropic/opus");
	});

	it("parses thinking suffix but keeps ':' inside model ids", () => {
		const a = parseRoleValue("anthropic/opus:high", models);
		expect(a).toMatchObject({ kind: "model", provider: "anthropic", modelId: "opus", thinking: "high" });
		const b = parseRoleValue("openrouter/x/model:free", models);
		expect(b).toMatchObject({ kind: "model", provider: "openrouter", modelId: "x/model:free", thinking: null });
		expect(parseRoleValue("@smol", models)).toEqual({ kind: "alias", raw: "@smol" });
		expect(parseRoleValue(undefined, models)).toEqual({ kind: "none" });
	});

	it("builds the roles/set payload for global, project and inherit-reset", () => {
		expect(roleSetBody(null, "default", { provider: "anthropic", modelId: "opus", thinking: "off" })).toEqual({
			cwd: null,
			scope: "global",
			table: "roles",
			name: "default",
			value: "anthropic/opus:off",
		});
		expect(roleSetBody("/p", "task", null)).toMatchObject({ scope: "project", cwd: "/p", value: null });
	});

	it("drops a thinking level the new model does not support", () => {
		expect(reconcileThinking(models[0], "high")).toBe("high");
		expect(reconcileThinking(models[0], "xhigh")).toBeNull();
		expect(reconcileThinking(models[1], "off")).toBeNull();
		expect(reconcileThinking(models[0], "off")).toBe("off");
	});

	it("derives thinking choices only from the model catalog", () => {
		expect(thinkingOptions(models[1])).toEqual([]);
		expect(thinkingOptions(models[0]).map((o) => o.value)).toEqual([null, "low", "high", "off"]);
	});
});

describe("fallback chain editing", () => {
	it("reorders without mutating and ignores out-of-range moves", () => {
		const list = ["a", "b", "c"];
		expect(moveItem(list, 1, -1)).toEqual(["b", "a", "c"]);
		expect(moveItem(list, 1, 1)).toEqual(["a", "c", "b"]);
		expect(moveItem(list, 0, -1)).toEqual(list);
		expect(moveItem(list, 2, 1)).toEqual(list);
		expect(list).toEqual(["a", "b", "c"]);
		expect(removeAt(list, 1)).toEqual(["a", "c"]);
	});

	it("preserves other chains in the payload and drops emptied ones", () => {
		const chains = normalizeChains({ default: ["a/x"], web: ["b/y"], bad: "nope" });
		expect(chains).toEqual({ default: ["a/x"], web: ["b/y"] });
		expect(fallbackSetBody(withChain(chains, "default", ["a/x", "c/z"]))).toEqual({
			chains: { default: ["a/x", "c/z"], web: ["b/y"] },
		});
		expect(withChain(chains, "web", [])).toEqual({ default: ["a/x"] });
	});

	it("detects duplicates ignoring thinking suffix", () => {
		expect(chainHas(["anthropic/opus:high"], "anthropic", "opus")).toBe(true);
		expect(chainHas(["anthropic/opus-2"], "anthropic", "opus")).toBe(false);
	});
});

describe("context window validation", () => {
	it("accepts plain, grouped and suffixed values", () => {
		expect(parseContextWindow("128000")).toEqual({ ok: true, value: 128000 });
		expect(parseContextWindow("128,000")).toEqual({ ok: true, value: 128000 });
		expect(parseContextWindow("200K")).toEqual({ ok: true, value: 200000 });
		expect(parseContextWindow("1.5m")).toEqual({ ok: true, value: 1_500_000 });
	});

	it("rejects empty, non-numeric, too small and too large input", () => {
		expect(parseContextWindow("").ok).toBe(false);
		expect(parseContextWindow("abc").ok).toBe(false);
		expect(parseContextWindow("-5").ok).toBe(false);
		expect(parseContextWindow("500").ok).toBe(false);
		expect(parseContextWindow("999m").ok).toBe(false);
	});

	it("keys the override by provider and model; null resets", () => {
		expect(contextSetBody("anthropic", "opus", null)).toEqual({
			entries: [{ providerId: "anthropic", modelId: "opus", contextWindow: null }],
		});
	});
});

describe("provider edit payload", () => {
	const custom: ProviderRow = {
		id: "mine",
		origin: "custom",
		baseUrl: "https://a.example/v1",
		key: { kind: "encrypted" },
	};

	it("sends only changed fields", () => {
		expect(providerSaveBody(custom, "https://a.example/v1", "")).toBeNull();
		expect(providerSaveBody(custom, " https://b.example/v1 ", "")).toEqual({ id: "mine", base_url: "https://b.example/v1" });
		expect(providerSaveBody(custom, "https://a.example/v1", " sk-new ")).toEqual({ id: "mine", api_key: "sk-new" });
	});

	it("never changes the URL of non-custom providers", () => {
		const builtin: ProviderRow = { id: "anthropic", origin: "builtIn", baseUrl: "https://x", key: { kind: "envVar" } };
		expect(providerSaveBody(builtin, "https://evil", "")).toBeNull();
	});

	it("masks secrets in the confirmation rows", () => {
		const rows = providerDiffRows(custom, "https://b.example/v1", "sk-super-secret");
		const text = JSON.stringify(rows);
		expect(text).not.toContain("sk-super-secret");
		expect(rows.find((r) => r.label === "API Key")).toEqual({ label: "API Key", before: KEY_MASK, after: KEY_MASK });
		expect(rows.find((r) => r.label === "Base URL")?.before).toBe("https://a.example/v1");
	});
});
