import { describe, expect, it } from "vitest";
import type { ModelOption } from "../lib/models";
import {
	applyThinkingLevel,
	carryLevel,
	composeSelection,
	describeResolution,
	isRecordableModelKey,
	parseSelection,
	pushRecent,
	removeRecent,
	resolveRole,
	roleIdOf,
	thinkingLevelsFor,
} from "./modelSelectLogic";

const MODELS: ModelOption[] = [
	{ provider: "anthropic", id: "haiku", name: "Haiku", thinking: ["low", "high"] },
	{ provider: "anthropic", id: "opus", name: "Opus", thinking: [] },
];

describe("parseSelection / composeSelection", () => {
	it("splits known trailing levels only", () => {
		expect(parseSelection("anthropic/opus:high")).toEqual({ selector: "anthropic/opus", level: "high" });
		expect(parseSelection("smol:off")).toEqual({ selector: "smol", level: "off" });
		expect(parseSelection("openai/gpt-5:inherit")).toEqual({ selector: "openai/gpt-5", level: "inherit" });
		expect(parseSelection("host/m:8080")).toEqual({ selector: "host/m:8080", level: null });
		expect(parseSelection(undefined)).toEqual({ selector: "", level: null });
	});
	it("composes and strips", () => {
		expect(composeSelection("smol", "high")).toBe("smol:high");
		expect(composeSelection("anthropic/opus", null)).toBe("anthropic/opus");
		expect(composeSelection("", "high")).toBe("");
	});
	it("recognizes roles with or without @", () => {
		expect(roleIdOf("@smol")).toBe("smol");
		expect(roleIdOf("slow")).toBe("slow");
		expect(roleIdOf("anthropic/opus")).toBeNull();
	});
});

describe("resolveRole", () => {
	it("resolves a configured role with level", () => {
		const r = resolveRole({ smol: "anthropic/haiku:low" }, "smol", MODELS);
		expect(r).toMatchObject({ kind: "model", selector: "anthropic/haiku", level: "low" });
		expect(describeResolution(r)).toBe("Haiku · low");
		expect(describeResolution(r, "high")).toBe("Haiku · high");
	});
	it("follows @alias chains and guards cycles", () => {
		expect(resolveRole({ slow: "@default", default: "anthropic/opus" }, "slow", MODELS)).toMatchObject({
			kind: "model",
			model: { id: "opus" },
		});
		expect(resolveRole({ smol: "@slow", slow: "@smol" }, "smol", MODELS).kind).toBe("auto");
	});
	it("falls back to default, then auto", () => {
		const r = resolveRole({ default: "anthropic/opus" }, "smol", MODELS);
		expect(r.kind).toBe("followDefault");
		expect(describeResolution(r)).toBe("跟随主力：Opus");
		expect(describeResolution(resolveRole({}, "smol", MODELS))).toBe("omp 自动挑选");
		expect(resolveRole({}, "default", MODELS).kind).toBe("auto");
	});
	it("keeps raw selector when not in catalog", () => {
		expect(describeResolution(resolveRole({ smol: "x/y" }, "smol", MODELS))).toBe("x/y");
	});
});

describe("recent models", () => {
	it("dedupes most-recent-first and caps at 5", () => {
		let list: string[] = [];
		for (const k of ["a/1", "a/2", "a/3", "a/4", "a/5", "a/6", "a/3"]) list = pushRecent(list, k);
		expect(list).toEqual(["a/3", "a/6", "a/5", "a/4", "a/2"]);
	});
	it("records only real model keys", () => {
		expect(isRecordableModelKey("anthropic/opus")).toBe(true);
		expect(isRecordableModelKey("smol")).toBe(false);
		expect(isRecordableModelKey("__custom")).toBe(false);
		expect(isRecordableModelKey("")).toBe(false);
		expect(isRecordableModelKey("a/")).toBe(false);
	});
	it("removes target model key cleanly", () => {
		const list = ["a/1", "a/2", "a/3"];
		expect(removeRecent(list, "a/2")).toEqual(["a/1", "a/3"]);
		expect(removeRecent(list, "not-in-list")).toEqual(["a/1", "a/2", "a/3"]);
	});
});

describe("thinking chip helpers", () => {
	const CAT: ModelOption[] = [
		{ provider: "a", id: "m1", name: "M1", thinking: ["low", "high"] },
		{ provider: "a", id: "m2", name: "M2", thinking: ["high", "xhigh"] },
		{ provider: "a", id: "plain", name: "Plain", thinking: [] },
	];
	it("offers the selected model's levels via resolveThinkingLevels", () => {
		expect(thinkingLevelsFor("a/m1", CAT, {}, null)).toEqual(["auto", "off", "low", "high"]);
		expect(thinkingLevelsFor("a/plain", CAT, {}, null)).toEqual([]);
		expect(thinkingLevelsFor("a/unknown", CAT, {}, null)).toEqual([]);
		expect(thinkingLevelsFor("", CAT, {}, null)).toEqual([]);
	});
	it("resolves a role to its model's levels", () => {
		expect(thinkingLevelsFor("smol", CAT, { smol: "a/m2:high" }, null)).toEqual(["auto", "off", "high", "xhigh"]);
		expect(thinkingLevelsFor("smol", CAT, {}, null)).toEqual([]);
	});
	it("writes auto as the bare selector, other levels as a suffix", () => {
		expect(applyThinkingLevel("a/m1", "auto")).toBe("a/m1");
		expect(applyThinkingLevel("a/m1", "high")).toBe("a/m1:high");
		expect(applyThinkingLevel("smol", "off")).toBe("smol:off");
	});
	it("keeps the level across a model switch only when still supported", () => {
		expect(carryLevel("a/m2", "high", CAT, {})).toBe("a/m2:high");
		expect(carryLevel("a/m2", "low", CAT, {})).toBe("a/m2");
		expect(carryLevel("a/plain", "high", CAT, {})).toBe("a/plain");
		expect(carryLevel("a/m1", null, CAT, {})).toBe("a/m1");
	});
});
