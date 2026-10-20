import { describe, expect, it } from "vitest";
import type { OmpConfigEntry } from "../../lib/contracts";
import { OMP_CONFIG_DEFAULTS } from "./ompConfigDefaults";
import { OMP_CONFIG_META } from "./ompConfigMeta";
import {
	groupEntriesForPage,
	isDesktopRelevant,
	ompConditionHint,
	ompConditionMet,
	ompSearchTerms,
	ompSectionFor,
	ompSectionsForPage,
	ompTuiLocation,
	OMP_SECTIONS,
} from "./ompPlacement";

const entry = (key: string): OmpConfigEntry => ({
	key,
	value: null,
	valueType: "string",
	description: "",
	redacted: false,
	tab: "",
});

describe("visibility", () => {
	it("never places terminal-only or CLI-only keys", () => {
		const hidden = [
			"loop.mode",
			"gc.stale",
			"gc.compress",
			"stream.serverUrl",
			"collab.relayUrl",
			"recap.enabled",
			"commit.cacheEnabled",
			"hideThinkingBlock",
			"proseOnlyThinking",
			"expandThinkingBlocks",
			"branchSummary.enabled",
			"branchSummary.reserveTokens",
			"ask.notify",
			"git.enabled",
			"goal.statusInFooter",
			"read.renderMarkdown",
			"mcp.renderMarkdownResults",
			"task.showResolvedModelBadge",
			"tasks.todoClearDelay",
			"dev.autoqaConsent",
			"input.bareExitOnEmptySession",
			"input.bareSlashCommands",
			"worktree.onStart",
			"worktree.onExit",
			"memories.enabled",
			"tools.approvalMode",
			"theme.dark",
			"statusLine.leftSegments",
			"speech.voice",
			"tui.vimMode",
			"completion.notify",
		];
		for (const key of hidden) expect(isDesktopRelevant(key), key).toBe(false);
	});

	it("never places keys owned by dedicated editors", () => {
		const owned = [
			"modelRoles",
			"task.agentModelOverrides",
			"retry.fallbackChains",
			"retry.modelFallback",
			"retry.fallbackOn",
			"retry.fallbackRevertPolicy",
			"retry.usageAwareFallback",
			"retry.usageReservePct",
			"retry.usageReservePolicy",
			"cycleOrder",
			"modelRoleStorage",
			"extendedContext",
			"compaction.enabled",
			"compaction.thresholdPercent",
			"contextPromotion.enabled",
		];
		for (const key of owned) expect(isDesktopRelevant(key), key).toBe(false);
		const grouped = groupEntriesForPage(owned.map(entry), "model-fallback");
		expect(grouped).toEqual([]);
	});

	it("keeps un-hidden keys on their section", () => {
		expect(isDesktopRelevant("readLineNumbers")).toBe(true);
		expect(ompSectionFor("readLineNumbers").id).toBe("files.read");
		for (const key of ["shellMinimizer.enabled", "shellMinimizer.except", "shellMinimizer.maxCaptureBytes"]) {
			expect(isDesktopRelevant(key), key).toBe(true);
			expect(ompSectionFor(key).id).toBe("shell.minimizer");
		}
		for (const key of ["ttsr.enabled", "ttsr.judge", "ttsr.builtinRules", "ttsr.disabledRules"]) {
			expect(isDesktopRelevant(key), key).toBe(true);
			expect(ompSectionFor(key).page).toBe("agents-md");
		}
	});

	it("keeps share, update, commands and marketplace keys", () => {
		expect(ompSectionFor("share.serverUrl").id).toBe("sessions.share");
		expect(ompSectionFor("update.channel").id).toBe("about.update");
		expect(ompSectionFor("commands.enableClaudeUser").id).toBe("skills.commands");
		expect(ompSectionFor("marketplace.autoUpdate").id).toBe("plugins.extensions");
		expect(ompSectionFor("worktree.cleanSource").id).toBe("subagents.isolation");
	});
});

describe("placement precedence", () => {
	it("prefers exact keys over prefixes", () => {
		expect(ompSectionFor("tools.xdev").id).toBe("mcp.xdev");
		expect(ompSectionFor("tools.xdevDocs").id).toBe("mcp.xdev");
		expect(ompSectionFor("grep.enabled").id).toBe("tools.available");
		expect(ompSectionFor("grep.contextBefore").id).toBe("tools.search");
		expect(ompSectionFor("astGrep.enabled").id).toBe("tools.available");
		expect(ompSectionFor("images.questionTimeoutMs").id).toBe("tools.execution");
		expect(ompSectionFor("images.autoResize").id).toBe("helper.images");
		expect(ompSectionFor("providers.autoThinkingMaxEffort").id).toBe("thinking.level");
		expect(ompSectionFor("providers.webSearchTimeoutSeconds").id).toBe("web.tools");
		expect(ompSectionFor("providers.streamIdleTimeoutSeconds").id).toBe("fallback.timeouts");
		expect(ompSectionFor("providers.anthropic.serverSideFallback").id).toBe("fallback.retry");
		expect(ompSectionFor("ask.enabled").id).toBe("sessions.ask");
	});

	it("prefers the longest matching prefix", () => {
		expect(ompSectionFor("task.isolation.apply").id).toBe("subagents.isolation");
		expect(ompSectionFor("task.maxConcurrency").id).toBe("subagents.behavior");
		expect(ompSectionFor("read.summarize.enabled").id).toBe("files.summary");
		expect(ompSectionFor("read.defaultLimit").id).toBe("files.read");
		expect(ompSectionFor("tools.speculativeExecution.enabled").id).toBe("tools.execution");
		expect(ompSectionFor("tools.somethingNew").id).toBe("tools.other");
		expect(ompSectionFor("providers.someNewOption").id).toBe("providers.advanced");
	});

	it("falls back to advanced.other for unknown keys and routes unknown tool switches to available tools", () => {
		expect(ompSectionFor("totally.unknown").id).toBe("advanced.other");
		expect(ompSectionFor("newtool.enabled").id).toBe("tools.available");
	});

	it("orders rows exact-first, then *.enabled, then alphabetical", () => {
		const keys = ["bash.zeta", "bash.alpha", "bash.enabled", "shellPath"];
		const [group] = groupEntriesForPage(keys.map(entry), "shell");
		expect(group.section.id).toBe("shell.bash");
		expect(group.entries.map((e) => e.key)).toEqual(["shellPath", "bash.enabled", "bash.alpha", "bash.zeta"]);
		const [limits] = groupEntriesForPage(["tools.outputMaxColumns", "tools.artifactHeadBytes"].map(entry), "tools");
		expect(limits.entries.map((e) => e.key)).toEqual(["tools.artifactHeadBytes", "tools.outputMaxColumns"]);
	});

	it("groups per page in section order, omits empty sections, honours slots", () => {
		const keys = ["codexResets.autoRedeem", "providers.fireworksTier", "enabledModels", "temperature"];
		const all = groupEntriesForPage(keys.map(entry), "providers");
		expect(all.map((g) => g.section.id)).toEqual(["providers.catalog", "providers.advanced", "providers.resets"]);
		expect(groupEntriesForPage(keys.map(entry), "providers", "quota").map((g) => g.section.id)).toEqual(["providers.resets"]);
		expect(ompSectionsForPage("providers", "keys").map((s) => s.id)).toEqual(["providers.catalog", "providers.advanced"]);
		expect(groupEntriesForPage(keys.map(entry), "thinking")[0].entries.map((e) => e.key)).toEqual(["temperature"]);
	});

	it("has unique section ids", () => {
		const ids = OMP_SECTIONS.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("coverage of known keys", () => {
	it("places every desktop-relevant known key in a non-fallback section", () => {
		const known = new Set([...Object.keys(OMP_CONFIG_META), ...Object.keys(OMP_CONFIG_DEFAULTS)]);
		const fallback = [...known].filter((k) => isDesktopRelevant(k) && ompSectionFor(k).id === "advanced.other");
		expect(fallback).toEqual([]);
		expect(known.size).toBeGreaterThan(400);
	});
});

describe("conditions", () => {
	const config = (values: Record<string, unknown>) => (key: string) => values[key];

	it("shows hindsight parameters only for the hindsight backend", () => {
		expect(ompConditionMet("hindsight.apiUrl", config({ "memory.backend": "hindsight" }))).toBe(true);
		expect(ompConditionMet("hindsight.recallBudget", config({ "memory.backend": "hindsight" }))).toBe(true);
		expect(ompConditionMet("hindsight.apiUrl", config({ "memory.backend": "local" }))).toBe(false);
		expect(ompConditionMet("hindsight.recallBudget", config({}))).toBe(false);
		expect(ompConditionHint("hindsight.apiUrl")).toBe("选择 Hindsight 记忆后端后显示");
		expect(ompConditionMet("mnemopi.bank", config({ "memory.backend": "mnemopi" }))).toBe(true);
		expect(ompConditionMet("mnemopi.bank", config({ "memory.backend": "hindsight" }))).toBe(false);
		expect(ompConditionMet("memories.threadScanLimit", config({ "memory.backend": "local" }))).toBe(true);
		expect(ompConditionMet("memories.threadScanLimit", config({ "memory.backend": "off" }))).toBe(false);
		expect(ompConditionMet("sharpshooter.minPromptLength", config({ "memory.backend": "sharpshooter" }))).toBe(true);
		expect(ompConditionMet("sharpshooter.minPromptLength", config({ "memory.backend": "off" }))).toBe(false);
		expect(ompConditionMet("memory.backend", config({}))).toBe(true);
	});

	it("gates advisor children on advisor.enabled but never the switch itself", () => {
		const off = config({ "advisor.enabled": false });
		const on = config({ "advisor.enabled": true });
		for (const key of ["advisor.reviewMode", "advisor.immuneTurns", "advisor.continueSeverity", "tier.advisor"]) {
			expect(ompConditionMet(key, off), key).toBe(false);
			expect(ompConditionMet(key, on), key).toBe(true);
		}
		expect(ompConditionMet("advisor.enabled", off)).toBe(true);
		expect(ompConditionHint("advisor.enabled")).toBeNull();
		expect(ompConditionHint("advisor.reviewMode")).toBe("开启顾问模型后显示");
	});

	it("gates autolearn, auto thinking and plan keys", () => {
		expect(ompConditionMet("autolearn.autoContinue", config({ "autolearn.enabled": false }))).toBe(false);
		expect(ompConditionMet("autolearn.autoContinue", config({ "autolearn.enabled": true }))).toBe(true);
		expect(ompConditionMet("autolearn.enabled", config({}))).toBe(true);
		expect(ompConditionMet("providers.autoThinkingMaxEffort", config({ defaultThinkingLevel: "high" }))).toBe(false);
		expect(ompConditionMet("providers.autoThinkingMaxEffort", config({ defaultThinkingLevel: "auto" }))).toBe(true);
		expect(ompConditionMet("plan.autosaveDir", config({ "plan.enabled": true, "plan.autosave": false }))).toBe(false);
		expect(ompConditionMet("plan.autosaveDir", config({ "plan.enabled": true, "plan.autosave": true }))).toBe(true);
		expect(ompConditionMet("plan.defaultOnStartup", config({ "plan.enabled": false }))).toBe(false);
	});

	it("uses schema defaults for unset values and treats macOS-only keys as available", () => {
		expect(ompConditionMet("advisor.reviewMode", (k) => (k === "advisor.enabled" ? null : undefined))).toBe(false);
		expect(ompConditionMet("plan.defaultOnStartup", config({}))).toBe(true);
		expect(ompConditionMet("spelling.typoDetection", config({}))).toBe(true);
		expect(ompConditionHint("temperature")).toBeNull();
	});
});

describe("TUI metadata helpers", () => {
	it("describes where the setting lives in the terminal /settings", () => {
		expect(ompTuiLocation("defaultThinkingLevel")).toMatch(/^终端 \/settings › Model › Thinking · /);
		expect(ompTuiLocation("no.such.key")).toBeNull();
	});

	it("carries TUI warnings and conditions in the metadata", () => {
		expect(OMP_CONFIG_META.externalThinking?.warning).toBeTruthy();
		expect(OMP_CONFIG_META["hindsight.apiUrl"]?.condition).toBe("hindsightActive");
		expect(OMP_CONFIG_META["advisor.reviewMode"]?.condition).toBe("advisorEnabled");
		expect(OMP_CONFIG_META["providers.openai-codex.codeMode"]).toBeUndefined();
		expect(OMP_CONFIG_DEFAULTS["providers.openai-codex.codeMode"]).toBeUndefined();
	});

	it("search terms include key, Chinese title, English TUI label and section", () => {
		const terms = ompSearchTerms("steeringMode").join("\n").toLowerCase();
		expect(terms).toContain("steeringmode");
		expect(terms).toContain("steering");
		expect(terms).toContain("消息排队与打断");
		expect(ompSearchTerms("temperature").join("\n")).toContain("Sampling");
	});
});
