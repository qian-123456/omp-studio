import { describe, expect, it } from "vitest";
import type { OmpConfigEntry } from "../../lib/contracts";
import {
	groupByDesktopCategory,
	isDesktopRelevant,
	OMP_DESKTOP_CATEGORIES,
	ompDesktopCategoryFor,
} from "./ompDesktopCategories";

function entry(key: string): OmpConfigEntry {
	return {
		key,
		value: null,
		valueType: "string",
		description: "",
		redacted: false,
		tab: "",
	};
}

describe("OMP_DESKTOP_CATEGORIES", () => {
	it("lists the eight desktop categories in frozen order", () => {
		expect(OMP_DESKTOP_CATEGORIES.map((c) => c.id)).toEqual([
			"model",
			"thinking",
			"retry",
			"context",
			"tools",
			"tasks",
			"providers",
			"advanced",
		]);
		expect(OMP_DESKTOP_CATEGORIES.map((c) => c.label)).toEqual([
			"模型与目录",
			"思考与采样",
			"重试与回退",
			"上下文与记忆",
			"工具与审批",
			"任务与子代理",
			"网络与扩展",
			"其他 OMP 配置",
		]);
		expect(OMP_DESKTOP_CATEGORIES.every((c) => c.hint.length > 0)).toBe(true);
	});
});

describe("isDesktopRelevant", () => {
	it("rejects TUI-only prefixes", () => {
		expect(isDesktopRelevant("theme.dark")).toBe(false);
		expect(isDesktopRelevant("statusLine.preset")).toBe(false);
		expect(isDesktopRelevant("tui.mouse")).toBe(false);
		expect(isDesktopRelevant("composer.shape")).toBe(false);
		expect(isDesktopRelevant("startup.checkUpdate")).toBe(false);
		expect(isDesktopRelevant("speech.enabled")).toBe(false);
		expect(isDesktopRelevant("stt.language")).toBe(false);
		expect(isDesktopRelevant("ttsr.enabled")).toBe(false);
		expect(isDesktopRelevant("spelling.autocomplete")).toBe(false);
	});

	it("rejects hidden exact keys", () => {
		expect(isDesktopRelevant("symbolPreset")).toBe(false);
		expect(isDesktopRelevant("modelRoles")).toBe(false);
		expect(isDesktopRelevant("retry.fallbackChains")).toBe(false);
		expect(isDesktopRelevant("read.toolResultPreview")).toBe(false);
		expect(isDesktopRelevant("readLineNumbers")).toBe(false);
		expect(isDesktopRelevant("setupVersion")).toBe(false);
		expect(isDesktopRelevant("doubleEscapeAction")).toBe(false);
		expect(isDesktopRelevant("completion.notify")).toBe(false);
		expect(isDesktopRelevant("error.notify")).toBe(false);
		expect(isDesktopRelevant("cycleOrder")).toBe(false);
		expect(isDesktopRelevant("modelRoleStorage")).toBe(false);
	});

	it("keeps near-miss prefixes that only look hidden", () => {
		// `speech.`/`tts.` are hidden but `speechgen.*`/`tts.*` are tools.
		expect(isDesktopRelevant("speechgen.enabled")).toBe(true);
		expect(isDesktopRelevant("tts.localVoice")).toBe(true);
		// `read.` is a tools prefix but `readLineNumbers` is a hidden bare key.
		expect(isDesktopRelevant("read.defaultLimit")).toBe(true);
		expect(isDesktopRelevant("temperature")).toBe(true);
	});
});

describe("ompDesktopCategoryFor", () => {
	it("classifies keys into the matching category", () => {
		expect(ompDesktopCategoryFor("modelProviderOrder").id).toBe("model");
		expect(ompDesktopCategoryFor("model.loopGuard.enabled").id).toBe("model");
		expect(ompDesktopCategoryFor("codexResets.keepCredits").id).toBe("model");

		expect(ompDesktopCategoryFor("temperature").id).toBe("thinking");
		expect(ompDesktopCategoryFor("thinkingBudgets.high").id).toBe("thinking");
		expect(ompDesktopCategoryFor("tier.anthropic").id).toBe("thinking");
		expect(ompDesktopCategoryFor("providers.autoThinkingMaxEffort").id).toBe(
			"thinking",
		);

		expect(ompDesktopCategoryFor("retry.maxRetries").id).toBe("retry");
		expect(
			ompDesktopCategoryFor("providers.anthropic.serverSideFallback").id,
		).toBe("retry");
		expect(ompDesktopCategoryFor("provider.appendOnlyContext").id).toBe(
			"retry",
		);

		expect(ompDesktopCategoryFor("compaction.thresholdPercent").id).toBe(
			"context",
		);
		expect(ompDesktopCategoryFor("memories.enabled").id).toBe("context");
		expect(ompDesktopCategoryFor("steeringMode").id).toBe("context");

		expect(ompDesktopCategoryFor("bash.enabled").id).toBe("tools");
		expect(ompDesktopCategoryFor("tools.approval").id).toBe("tools");
		expect(ompDesktopCategoryFor("mcp.notifications").id).toBe("tools");
		expect(ompDesktopCategoryFor("todo.reminders").id).toBe("tools");

		expect(ompDesktopCategoryFor("task.maxConcurrency").id).toBe("tasks");
		expect(ompDesktopCategoryFor("task.isolation.enabled").id).toBe("tasks");
		expect(ompDesktopCategoryFor("worktree.base").id).toBe("tasks");

		expect(ompDesktopCategoryFor("searxng.endpoint").id).toBe("providers");
		expect(ompDesktopCategoryFor("providers.fetch").id).toBe("providers");
		expect(ompDesktopCategoryFor("auth.broker.url").id).toBe("providers");
		expect(ompDesktopCategoryFor("git.enabled").id).toBe("providers");

		expect(ompDesktopCategoryFor("shellPath").id).toBe("advanced");
		expect(ompDesktopCategoryFor("power.sleepPrevention").id).toBe("advanced");
	});

	it("routes unknown future keys to advanced and keeps them relevant", () => {
		expect(isDesktopRelevant("quantum.entangle")).toBe(true);
		expect(ompDesktopCategoryFor("quantum.entangle").id).toBe("advanced");
	});
});

describe("groupByDesktopCategory", () => {
	it("emits categories in frozen order and sorts entries by key", () => {
		const groups = groupByDesktopCategory([
			entry("tools.read"),
			entry("temperature"),
			entry("modelProviderOrder"),
			entry("topP"),
		]);
		expect(groups.map((g) => g.category.id)).toEqual([
			"model",
			"thinking",
			"tools",
		]);
		expect(groups[1].category.label).toBe("思考与采样");
		expect(groups[1].entries.map((e) => e.key)).toEqual([
			"temperature",
			"topP",
		]);
	});

	it("drops hidden entries and omits empty categories", () => {
		const groups = groupByDesktopCategory([
			entry("theme.dark"),
			entry("modelRoles"),
			entry("statusLine.preset"),
			entry("retry.fallbackChains"),
			entry("shellPath"),
		]);
		expect(groups.map((g) => g.category.id)).toEqual(["advanced"]);
		expect(groups[0].entries.map((e) => e.key)).toEqual(["shellPath"]);
	});

	it("returns an empty list when nothing is desktop-relevant", () => {
		expect(
			groupByDesktopCategory([entry("tui.mouse"), entry("symbolPreset")]),
		).toEqual([]);
	});
});
