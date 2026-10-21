/**
 * Edge cases of the template/rule logic: window options, condition text,
 * status badges, recommendations, drift, auto-revert and conflict copy.
 */
import { describe, expect, it } from "vitest";
import type {
	CurrentTemplateState,
	ModelSwitchRule,
	ModelTemplate,
	ProviderStatus,
	RuleConflict,
	WindowStatus,
} from "../../../lib/contracts";
import type { ModelOption } from "../../../lib/models";
import { KNOWN_BRAND_CONFIGS } from "../sections/quotaHelpers";
import {
	canAutoRevert,
	conflictText,
	currentForScope,
	driftSummary,
	inScope,
	providerOptions,
	recommendedRoles,
	ruleConditionText,
	ruleFormDefaults,
	scopeDisplayName,
	scopeWriteHint,
	statusLabel,
	statusTone,
	windowOptionsFor,
} from "./logic";

function win(key: string, label: string, usedPct: number): WindowStatus {
	return { key, label, usedPct, resetsAt: null };
}

function provider(
	usageSlug: string,
	windows: WindowStatus[],
	state: ProviderStatus["state"] = "available",
): ProviderStatus {
	return {
		usageSlug,
		modelProvider: null,
		state,
		windows,
		accounts: 1,
		exhaustedAccounts: 0,
	};
}

function rule(over: Partial<ModelSwitchRule> = {}): ModelSwitchRule {
	return {
		id: "r1",
		name: "claude 用尽",
		enabled: true,
		scope: "global",
		provider: "anthropic",
		windowKey: "5h",
		thresholdPct: 95,
		templateId: "t1",
		autoRevert: true,
		revertThresholdPct: null,
		sort: 0,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		...over,
	};
}

function current(over: Partial<CurrentTemplateState> = {}): CurrentTemplateState {
	return { scope: "global", templateId: "t1", templateName: "省额度", driftedRoles: [], logId: "l1", ...over };
}

const MODELS: ModelOption[] = [
	{ provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus 4.5" },
	{ provider: "openai", id: "gpt-5", name: "GPT-5" },
	{ provider: "moonshot", id: "kimi-k2", name: "Kimi K2" },
];

describe("windowOptionsFor", () => {
	it("returns only the reported windows, in report order, with their percentages", () => {
		const providers = [
			provider("anthropic", [win("7d", "7 天周期限额", 41.5), win("5h", "5 小时滚动限额", 97)]),
			provider("openai", [win("5h", "5 小时", 3)]),
		];
		expect(windowOptionsFor(providers, "anthropic")).toEqual([
			{ key: "7d", label: "7 天周期限额", usedPct: 41.5 },
			{ key: "5h", label: "5 小时滚动限额", usedPct: 97 },
		]);
	});

	it("returns nothing for a provider without a report", () => {
		expect(windowOptionsFor([provider("anthropic", [win("5h", "5 小时", 10)])], "cursor")).toEqual([]);
		expect(windowOptionsFor([], "anthropic")).toEqual([]);
	});

	it("falls back to the humanized key when the report carries no label", () => {
		const [option] = windowOptionsFor([provider("anthropic", [win("5h", "", 12)])], "anthropic");
		expect(option.key).toBe("5h");
		expect(option.label).not.toBe("");
		expect(option.usedPct).toBe(12);
	});
});

describe("providerOptions", () => {
	it("uses the known brand name when mapped and the raw slug otherwise, keeping state", () => {
		const options = providerOptions([
			provider("anthropic", [], "available"),
			provider("mystery-plan", [], "unmapped"),
		]);
		expect(options).toEqual([
			{ value: "anthropic", label: KNOWN_BRAND_CONFIGS.anthropic.name, state: "available" },
			{ value: "mystery-plan", label: "mystery-plan", state: "unmapped" },
		]);
	});
});

describe("ruleConditionText", () => {
	it("names the brand, the reported window label and the trimmed threshold", () => {
		const providers = [provider("anthropic", [win("5h", "5 小时滚动限额", 97)])];
		const text = ruleConditionText(rule({ thresholdPct: 95.34 }), providers);
		expect(text).toContain(KNOWN_BRAND_CONFIGS.anthropic.name);
		expect(text).toContain("5 小时滚动限额");
		expect(text).toContain("95.3%");
	});

	it("drops a trailing zero decimal and keeps whole numbers bare", () => {
		const providers = [provider("anthropic", [win("5h", "5 小时滚动限额", 97)])];
		expect(ruleConditionText(rule({ thresholdPct: 95 }), providers)).toContain("≥ 95%");
		expect(ruleConditionText(rule({ thresholdPct: 95.0 }), providers)).toContain("≥ 95%");
		expect(ruleConditionText(rule({ thresholdPct: 0 }), providers)).toContain("≥ 0%");
	});

	it("falls back to the raw slug and the window key when nothing is reported", () => {
		const text = ruleConditionText(
			rule({ provider: "mystery-plan", windowKey: "custom-window", thresholdPct: 50 }),
			[],
		);
		expect(text).toContain("mystery-plan");
		expect(text).toContain("custom-window");
		expect(text).toContain("50%");
	});
});

describe("statusTone / statusLabel", () => {
	it("maps every switch status", () => {
		expect(statusTone("applied")).toBe("ok");
		expect(statusTone("partial")).toBe("warn");
		expect(statusTone("refused")).toBe("error");
		expect(statusTone("skipped")).toBe("muted");
		expect(statusTone("reverted")).toBe("muted");
		expect(statusTone("undone")).toBe("muted");
		expect(statusTone("failed")).toBe("error");
		expect(statusTone("something-new")).toBe("muted");
	});

	it("labels every switch status distinctly, passing unknown ones through", () => {
		const known = ["applied", "partial", "refused", "skipped", "reverted", "undone", "failed"];
		const labels = known.map(statusLabel);
		for (const label of labels) expect(label.length).toBeGreaterThan(0);
		expect(new Set(labels).size).toBe(known.length);
		expect(labels.every((label, i) => label !== known[i])).toBe(true);
		expect(statusLabel("something-new")).toBe("something-new");
	});
});

describe("recommendedRoles", () => {
	it("returns roles whose selector provider maps to the usage slug's model provider", () => {
		const roles: Record<string, string | null> = {
			default: "anthropic/claude-opus-4-5:high",
			smol: "openai/gpt-5",
			slow: null,
			task: "moonshot/kimi-k2",
		};
		expect(recommendedRoles(roles, "kimi-code", MODELS)).toEqual(["task"]);
		expect(recommendedRoles(roles, "openai-codex", MODELS)).toEqual(["smol"]);
		expect(recommendedRoles(roles, "anthropic", MODELS)).toEqual(["default"]);
	});

	it("resolves bare model ids through the catalog and skips aliases", () => {
		const roles: Record<string, string | null> = {
			default: "claude-opus-4-5",
			task: "@default",
			smol: "unknown-model",
		};
		expect(recommendedRoles(roles, "anthropic", MODELS)).toEqual(["default"]);
	});

	it("recommends nothing for an unmapped usage slug", () => {
		expect(recommendedRoles({ default: "anthropic/claude-opus-4-5" }, "mystery-plan", MODELS)).toEqual([]);
		expect(recommendedRoles({}, "anthropic", MODELS)).toEqual([]);
	});
});

describe("driftSummary", () => {
	it("is null without drift", () => {
		expect(driftSummary(current())).toBeNull();
	});

	it("counts drifted roles and names the template", () => {
		const text = driftSummary(current({ driftedRoles: ["default", "smol"] }));
		expect(text).not.toBeNull();
		expect(text).toContain("省额度");
		expect(text).toContain("2");
	});
});

describe("canAutoRevert", () => {
	const providers = [provider("anthropic", [win("5h", "5 小时滚动限额", 80)])];

	it("reverts at exactly the threshold (equal counts)", () => {
		expect(canAutoRevert(rule({ revertThresholdPct: 80 }), providers)).toBe(true);
	});

	it("does not revert above the threshold", () => {
		expect(canAutoRevert(rule({ revertThresholdPct: 79.9 }), providers)).toBe(false);
	});

	it("defaults the threshold to threshold - 10", () => {
		expect(canAutoRevert(rule({ thresholdPct: 90, revertThresholdPct: null }), providers)).toBe(true);
		expect(canAutoRevert(rule({ thresholdPct: 89, revertThresholdPct: null }), providers)).toBe(false);
	});

	it("clamps the default threshold at zero", () => {
		const zero = [provider("anthropic", [win("5h", "5 小时滚动限额", 0)])];
		expect(canAutoRevert(rule({ thresholdPct: 5, revertThresholdPct: null }), zero)).toBe(true);
	});

	it("requires an enabled rule with auto-revert", () => {
		expect(canAutoRevert(rule({ enabled: false, revertThresholdPct: 80 }), providers)).toBe(false);
		expect(canAutoRevert(rule({ autoRevert: false, revertThresholdPct: 80 }), providers)).toBe(false);
	});

	it("requires the provider window to exist", () => {
		expect(canAutoRevert(rule({ provider: "cursor", revertThresholdPct: 80 }), providers)).toBe(false);
		expect(canAutoRevert(rule({ windowKey: "7d", revertThresholdPct: 80 }), providers)).toBe(false);
		expect(canAutoRevert(rule({ revertThresholdPct: 80 }), [])).toBe(false);
	});
});

describe("conflictText", () => {
	it("explains each conflict kind", () => {
		const make = (kind: string): RuleConflict => ({ kind, message: "backend", ruleIds: ["r1"], scope: "global" });
		const self = conflictText(make("self-eating"));
		const mutual = conflictText(make("mutual-escape"));
		const bottom = conflictText(make("no-bottom-line"));
		expect(self).not.toBe("backend");
		expect(mutual).not.toBe("backend");
		expect(bottom).not.toBe("backend");
		expect(new Set([self, mutual, bottom]).size).toBe(3);
	});

	it("falls back to the backend message for an unknown kind", () => {
		expect(conflictText({ kind: "future-kind", message: "backend", ruleIds: [], scope: "global" })).toBe("backend");
	});
});

describe("scope helpers", () => {
	const projects = [{ path: "/work/alpha", name: "Alpha" }];

	it("names the global scope, a registered project and an unregistered path", () => {
		expect(scopeDisplayName("global", projects)).toBe("全局");
		expect(scopeDisplayName("/work/alpha", projects)).toBe("Alpha");
		expect(scopeDisplayName("/work/beta/", projects)).toBe("beta");
	});

	it("keeps only the items of the scope", () => {
		const items = [
			{ id: "a", scope: "global" },
			{ id: "b", scope: "/work/alpha" },
			{ id: "c", scope: "global" },
		];
		expect(inScope(items, "global").map((i) => i.id)).toEqual(["a", "c"]);
		expect(inScope(items, "/work/alpha").map((i) => i.id)).toEqual(["b"]);
		expect(inScope(items, "/work/none")).toEqual([]);
	});

	it("picks the current state of the matching scope", () => {
		const currents = [current({ scope: "global", templateId: "g" }), current({ scope: "/work/alpha", templateId: "p" })];
		expect(currentForScope(currents, "/work/alpha")?.templateId).toBe("p");
		expect(currentForScope(currents, "/work/none")).toBeNull();
	});

	it("words the write target per scope", () => {
		expect(scopeWriteHint("global", projects)).toContain("全局模型角色");
		const hint = scopeWriteHint("/work/alpha", projects);
		expect(hint).toContain("Alpha");
		expect(hint).toContain(".omp/config.yml");
	});

	it("defaults a new rule to the page scope and that scope's first template", () => {
		const providers = [provider("anthropic", [win("5h", "5 小时滚动限额", 10)])];
		const templates = [
			{ id: "g1", scope: "global" },
			{ id: "p1", scope: "/work/alpha" },
		] as ModelTemplate[];
		expect(ruleFormDefaults(providers, templates, "/work/alpha")).toEqual({
			scope: "/work/alpha",
			provider: "anthropic",
			windowKey: "5h",
			templateId: "p1",
		});
		expect(ruleFormDefaults([], templates, "/work/none")).toEqual({
			scope: "/work/none",
			provider: "",
			windowKey: "",
			templateId: "",
		});
	});
});

