import { describe, expect, it } from "vitest";
import {
	currentModelOpt,
	filterModels,
	groupByProvider,
	isCurrentModel,
	modelLabel,
	resolveThinkingLevels,
	shortModel,
	type ModelOpt,
} from "./models";

const ms: ModelOpt[] = [
	{ provider: "openai", id: "gpt-5", name: "GPT 5", thinking: ["low", "high"] },
	{ provider: "anthropic", id: "sonnet", name: "sonnet" },
	{ provider: "openai", id: "gpt-mini" },
	{ provider: "anthropic", id: "opus", name: "Claude Opus" },
];

describe("groupByProvider", () => {
	it("sorts providers, keeps model order", () => {
		const g = groupByProvider(ms);
		expect(g.map((x) => x.provider)).toEqual(["anthropic", "openai"]);
		expect(g[0].models.map((m) => m.id)).toEqual(["sonnet", "opus"]);
		expect(g[1].models.map((m) => m.id)).toEqual(["gpt-5", "gpt-mini"]);
	});
});

describe("filterModels", () => {
	it("empty query returns all", () => expect(filterModels(ms, "  ")).toHaveLength(4));
	it("AND tokens across provider/name, case-insensitive", () => {
		expect(filterModels(ms, "OPENAI gpt").map((m) => m.id)).toEqual(["gpt-5", "gpt-mini"]);
		expect(filterModels(ms, "claude anthropic").map((m) => m.id)).toEqual(["opus"]);
		expect(filterModels(ms, "claude openai")).toEqual([]);
	});
});

describe("current model", () => {
	it("provider optional", () => {
		expect(isCurrentModel(ms[0], { id: "gpt-5" })).toBe(true);
		expect(isCurrentModel(ms[0], { provider: "x", id: "gpt-5" })).toBe(false);
		expect(isCurrentModel(ms[0], null)).toBe(false);
	});
	it("currentModelOpt falls back to id match", () => {
		expect(currentModelOpt(ms, { provider: "anthropic", id: "opus" })).toBe(ms[3]);
		expect(currentModelOpt(ms, { provider: "zzz", id: "opus" })).toBe(ms[3]);
		expect(currentModelOpt(ms, { id: "nope" })).toBeNull();
	});
});

describe("resolveThinkingLevels", () => {
	it("auto first, off last, from catalog", () => {
		expect(resolveThinkingLevels(ms[0], [], "auto")).toEqual(["auto", "low", "high", "off"]);
	});
	it("live levels win", () => {
		expect(resolveThinkingLevels(ms[0], ["medium", "off", "auto"], null)).toEqual(["auto", "medium", "off"]);
	});
	it("appends missing current level", () => {
		expect(resolveThinkingLevels(ms[0], [], "max")).toEqual(["auto", "low", "high", "off", "max"]);
	});
	it("empty cases", () => {
		expect(resolveThinkingLevels(null, [], null)).toEqual([]);
		expect(resolveThinkingLevels(ms[1], [], "high")).toEqual(["high"]);
	});
});

describe("labels", () => {
	it("modelLabel", () => {
		expect(modelLabel(ms[0])).toBe("GPT 5");
		expect(modelLabel(ms[1])).toBe("sonnet");
		expect(modelLabel({ provider: "a", id: "b", name: "a/b" })).toBe("b");
	});
	it("shortModel", () => {
		expect(shortModel("openai/gpt-5")).toBe("gpt-5");
		expect(shortModel("gpt-5")).toBe("gpt-5");
	});
});
