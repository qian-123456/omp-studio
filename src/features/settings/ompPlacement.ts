/**
 * [D] Where each omp config key lives in the desktop settings (one place per key).
 *
 * The desktop drives omp with `--mode rpc`, so terminal-only keys are hidden, and
 * keys edited by dedicated editors (model roles, fallback chain, context window) are
 * not rendered by the generic omp rows. Every other key is placed into exactly one
 * section of one host page. Precedence: exact key > longest matching prefix >
 * `*.enabled` tool switch (tools.available) > fallback `advanced.other`.
 *
 * Hidden/visible policy and section table: `docs/OMP_SETTINGS_DESKTOP.md`.
 * TUI group names (`tui`) and tabs come from omp's `/settings` metadata
 * (see ompConfigMeta.ts for how to regenerate it).
 */

import type { OmpConfigEntry } from "../../lib/contracts";
import { OMP_CONFIG_DEFAULTS } from "./ompConfigDefaults";
import {
	OMP_CONFIG_META,
	ompConfigDescription,
	ompConfigTitle,
} from "./ompConfigMeta";

export type OmpHostPage =
	| "general"
	| "privacy"
	| "about"
	| "providers"
	| "thinking"
	| "helper-models"
	| "model-fallback"
	| "context-window"
	| "sessions"
	| "agents-md"
	| "prompt-composition"
	| "tools"
	| "files"
	| "shell"
	| "subagents"
	| "memory"
	| "skills"
	| "mcp"
	| "plugins"
	| "web"
	| "advanced";

export interface OmpSectionDef {
	/** Stable id, e.g. "thinking.level". */
	id: string;
	page: OmpHostPage;
	/** Sub-tab inside a host page ("keys" | "quota" on providers). */
	slot?: string;
	/** Chinese heading. */
	title: string;
	/** TUI group label (English), shown muted next to the heading. */
	tui?: string;
	/** Optional one-line lead under the heading. */
	description?: string;
}

interface SectionRule extends OmpSectionDef {
	/** Exact keys in display order. */
	exact?: readonly string[];
	prefixes?: readonly string[];
}

const FALLBACK_ID = "advanced.other";

/** Section table in display order (pages are interleaved by nav order, not grouped). */
const RULES: readonly SectionRule[] = [
	{ id: "general.system", page: "general", title: "系统", tui: "Power", exact: ["power.sleepPrevention"] },
	{ id: "privacy.omp", page: "privacy", title: "密钥脱敏与数据上报", tui: "Privacy", exact: ["secrets.enabled", "telemetry.otlpExportEnabled"] },
	{ id: "about.update", page: "about", title: "omp 更新", tui: "Startup & Updates", exact: ["update.channel"] },
	{
		id: "providers.catalog",
		page: "providers",
		slot: "keys",
		title: "启用的模型与供应商",
		tui: "Model",
		exact: ["enabledModels", "enabledProviders", "disabledProviders", "modelProviderOrder", "modelTags", "modelPresets"],
	},
	{
		id: "providers.advanced",
		page: "providers",
		slot: "keys",
		title: "供应商高级选项",
		tui: "Protocol",
		exact: [
			"providers.antigravityEndpoint",
			"providers.fireworksTier",
			"providers.kimiApiFormat",
			"providers.muse-code.storeResponses",
			"providers.ollama-cloud.maxConcurrency",
			"providers.openaiLiveSteering",
			"providers.openaiWebsockets",
			"providers.openrouterVariant",
			"providers.anthropic.slowMode",
			"providers.cacheRetention",
			"providers.cacheWarming",
			"provider.appendOnlyContext",
		],
		prefixes: ["providers.", "provider.", "auth."],
	},
	{ id: "providers.resets", page: "providers", slot: "quota", title: "额度用完时自动兑换", tui: "Services", prefixes: ["codexResets.", "claudeResets."] },
	{
		id: "thinking.level",
		page: "thinking",
		title: "思考",
		tui: "Thinking",
		exact: [
			"defaultThinkingLevel",
			"providers.autoThinkingMaxEffort",
			"externalThinking",
			"omitThinking",
			"thinkingBudgets.minimal",
			"thinkingBudgets.low",
			"thinkingBudgets.medium",
			"thinkingBudgets.high",
			"thinkingBudgets.xhigh",
			"thinkingBudgets.max",
		],
	},
	{ id: "thinking.sampling", page: "thinking", title: "采样参数", tui: "Sampling", exact: ["temperature", "topP", "topK", "minP", "presencePenalty", "repetitionPenalty"] },
	{ id: "thinking.style", page: "thinking", title: "回复风格", tui: "Prompt", exact: ["personality", "textVerbosity"] },
	{ id: "thinking.tier", page: "thinking", title: "服务等级", tui: "Sampling", prefixes: ["tier."] },
	{ id: "helper.advisor", page: "helper-models", title: "顾问模型", tui: "Advisor", prefixes: ["advisor."] },
	{ id: "helper.prewalk", page: "helper-models", title: "预探", tui: "Prewalk", prefixes: ["prewalk."] },
	{ id: "helper.images", page: "helper-models", title: "图片与识图", tui: "Vision", prefixes: ["images."] },
	{ id: "helper.tiny", page: "helper-models", title: "本地小模型", tui: "Tiny Model", exact: ["providers.tinyModelDevice", "providers.tinyModelDtype"] },
	{ id: "fallback.retry", page: "model-fallback", title: "重试", tui: "Retry & Fallback", exact: ["providers.anthropic.serverSideFallback"], prefixes: ["retry."] },
	{
		id: "fallback.timeouts",
		page: "model-fallback",
		title: "超时与并发",
		tui: "Timeouts",
		exact: ["providers.streamFirstEventTimeoutSeconds", "providers.streamIdleTimeoutSeconds", "providers.maxInFlightRequests"],
	},
	{
		id: "fallback.guard",
		page: "model-fallback",
		title: "防死循环与意外停止",
		tui: "Thinking",
		exact: ["features.unexpectedStopDetection"],
		prefixes: ["model.loopGuard.", "model.toolCallLoopGuard."],
	},
	{ id: "context.snapcompact", page: "context-window", title: "实验：快照压缩", tui: "Experimental", prefixes: ["snapcompact."] },
	{ id: "sessions.queue", page: "sessions", title: "消息排队与打断", tui: "Input", exact: ["steeringMode", "followUpMode", "interruptMode"] },
	{ id: "sessions.ask", page: "sessions", title: "AI 提问", tui: "Notifications", exact: ["ask.enabled", "ask.timeout"] },
	{ id: "sessions.modes", page: "sessions", title: "计划与目标模式", tui: "Modes", prefixes: ["plan.", "goal."] },
	{ id: "sessions.keywords", page: "sessions", title: "魔法关键词", tui: "Magic Keywords", prefixes: ["magicKeywords."] },
	{ id: "sessions.title", page: "sessions", title: "会话标题", tui: "Modes", prefixes: ["title."] },
	{ id: "sessions.share", page: "sessions", title: "分享", tui: "Collab", prefixes: ["share."] },
	{ id: "rules.ttsr", page: "agents-md", title: "实时规则（TTSR）", tui: "Rules (TTSR)", prefixes: ["ttsr."] },
	{
		id: "prompt.contents",
		page: "prompt-composition",
		title: "提示词包含的内容",
		tui: "Prompt",
		exact: ["includeModelInPrompt", "includeWorkspaceTree", "inlineToolDescriptors", "skillful"],
		prefixes: ["contextFiles.", "workspace."],
	},
	{
		id: "tools.available",
		page: "tools",
		title: "可用工具",
		tui: "Available Tools",
		exact: [
			"archive.enabled",
			"astEdit.enabled",
			"astGrep.enabled",
			"checkpoint.enabled",
			"debug.enabled",
			"find.enabled",
			"generate_image.enabled",
			"glob.enabled",
			"grep.enabled",
			"launch.enabled",
			"ratchet.enabled",
			"security.enabled",
			"vault.enabled",
		],
	},
	{ id: "tools.approval", page: "tools", title: "工具审批规则", tui: "Approvals", exact: ["tools.approval"] },
	{ id: "tools.todo", page: "tools", title: "待办", tui: "Todos", prefixes: ["todo."] },
	{ id: "tools.search", page: "tools", title: "代码搜索", tui: "Grep & Browser", prefixes: ["grep.", "astGrep."] },
	{ id: "tools.browser", page: "tools", title: "浏览器", tui: "Grep & Browser", prefixes: ["browser."] },
	{ id: "tools.computer", page: "tools", title: "电脑操控", tui: "Computer", prefixes: ["computer."] },
	{ id: "tools.speech", page: "tools", title: "语音生成", tui: "Services", prefixes: ["speechgen.", "tts."] },
	{ id: "tools.github", page: "tools", title: "GitHub", tui: "GitHub", prefixes: ["github."] },
	{ id: "tools.ida", page: "tools", title: "IDA Pro", tui: "IDA Pro", prefixes: ["ida."] },
	{
		id: "tools.output",
		page: "tools",
		title: "输出长度限制",
		tui: "Output Limits",
		exact: [
			"tools.artifactHeadBytes",
			"tools.artifactMaxBytes",
			"tools.artifactSpillThreshold",
			"tools.artifactTailBytes",
			"tools.artifactTailLines",
			"tools.outputMaxColumns",
		],
	},
	{
		id: "tools.execution",
		page: "tools",
		title: "执行方式",
		tui: "Execution",
		exact: ["images.questionTimeoutMs", "tools.abortOnFabricatedResult", "tools.intentTracing", "tools.maxTimeout", "tools.format"],
		prefixes: ["async.", "tools.speculativeExecution."],
	},
	{ id: "tools.other", page: "tools", title: "其他工具设置", tui: "Available Tools", prefixes: ["tools."] },
	{ id: "files.edit", page: "files", title: "编辑", tui: "Editing", prefixes: ["edit."] },
	{ id: "files.read", page: "files", title: "读取", tui: "Reading", exact: ["readLineNumbers"], prefixes: ["read."] },
	{ id: "files.summary", page: "files", title: "读取摘要", tui: "Read Summaries", prefixes: ["read.summarize."] },
	{ id: "files.lsp", page: "files", title: "代码诊断（LSP）", tui: "LSP", prefixes: ["lsp."] },
	{ id: "shell.bash", page: "shell", title: "Bash", tui: "Bash", exact: ["shellPath"], prefixes: ["bash.", "bashInterceptor."] },
	{ id: "shell.minimizer", page: "shell", title: "命令输出精简", tui: "Bash", prefixes: ["shellMinimizer."] },
	{ id: "shell.eval", page: "shell", title: "代码运行", tui: "Eval & Runtimes", prefixes: ["eval.", "python."] },
	{ id: "subagents.behavior", page: "subagents", title: "子代理", tui: "Subagents", prefixes: ["task.", "tasks."] },
	{ id: "subagents.isolation", page: "subagents", title: "隔离与工作树", tui: "Isolation", prefixes: ["task.isolation.", "isolation.", "worktree."] },
	{ id: "memory.general", page: "memory", title: "记忆", tui: "General", exact: ["memory.backend"] },
	{ id: "memory.autolearn", page: "memory", title: "自主学习", tui: "Auto-Learn", prefixes: ["autolearn."] },
	{ id: "memory.local", page: "memory", title: "本地记忆参数", tui: "General", prefixes: ["memories."] },
	{ id: "memory.hindsight", page: "memory", title: "Hindsight", tui: "Hindsight", prefixes: ["hindsight."] },
	{ id: "memory.mnemopi", page: "memory", title: "Mnemopi", tui: "Mnemopi", prefixes: ["mnemopi."] },
	{ id: "memory.sharpshooter", page: "memory", title: "Sharpshooter", tui: "Sharpshooter", prefixes: ["sharpshooter."] },
	{ id: "skills.skills", page: "skills", title: "技能", tui: "Skills", prefixes: ["skills."] },
	{ id: "skills.commands", page: "skills", title: "自定义命令", tui: "Commands & Skills", prefixes: ["commands."] },
	{ id: "mcp.runtime", page: "mcp", title: "MCP 运行参数", tui: "Discovery & MCP", prefixes: ["mcp."] },
	{ id: "mcp.xdev", page: "mcp", title: "工具设备（xd://）", tui: "Discovery & MCP", exact: ["tools.xdev", "tools.xdevDocs", "tools.xdevInlineDevices"] },
	{
		id: "plugins.extensions",
		page: "plugins",
		title: "扩展",
		tui: "Extensions",
		exact: ["extensions", "disabledExtensions", "marketplace.autoUpdate"],
		prefixes: ["extensionHandlers."],
	},
	{
		id: "web.tools",
		page: "web",
		title: "联网工具",
		tui: "Available Tools",
		exact: ["web_search.enabled", "fetch.enabled", "providers.fetch", "providers.webSearchTimeoutSeconds"],
	},
	{ id: "web.exa", page: "web", title: "Exa", tui: "Services", prefixes: ["exa."] },
	{ id: "web.searxng", page: "web", title: "SearXNG", tui: "Services", prefixes: ["searxng."] },
	{ id: "advanced.autoqa", page: "advanced", title: "问题自动上报", tui: "Developer", prefixes: ["dev."] },
	{ id: FALLBACK_ID, page: "advanced", title: "其他" },
];

export const OMP_SECTIONS: readonly OmpSectionDef[] = RULES.map(({ id, page, slot, title, tui, description }) => {
	const def: OmpSectionDef = { id, page, title };
	if (slot) def.slot = slot;
	if (tui) def.tui = tui;
	if (description) def.description = description;
	return def;
});

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

/** Terminal-only prefixes (TUI chrome, CLI-only commands): never shown. Trailing dot on purpose. */
const HIDDEN_PREFIXES: readonly string[] = [
	"theme.",
	"statusLine.",
	"composer.",
	"tui.",
	"display.",
	"terminal.",
	"startup.",
	"keybindings.",
	"paste.",
	"speech.",
	"stt.",
	"live.",
	"spelling.",
	"loop.",
	"gc.",
	"stream.",
	"collab.",
	"recap.",
	"commit.",
];

/** Individual terminal-only keys and keys the desktop owns natively. */
const HIDDEN_KEYS: Readonly<Record<string, true>> = {
	"symbolPreset": true,
	"colorBlindMode": true,
	"showHardwareCursor": true,
	"autocompleteMaxVisible": true,
	"emojiAutocomplete": true,
	"doubleEscapeAction": true,
	"treeFilterMode": true,
	"autoResume": true,
	"completion.notify": true,
	"error.notify": true,
	"read.toolResultPreview": true,
	"setupVersion": true,
	"hideThinkingBlock": true,
	"proseOnlyThinking": true,
	"expandThinkingBlocks": true,
	"branchSummary.enabled": true,
	"branchSummary.reserveTokens": true,
	"ask.notify": true,
	"git.enabled": true,
	"goal.statusInFooter": true,
	"read.renderMarkdown": true,
	"mcp.renderMarkdownResults": true,
	"task.showResolvedModelBadge": true,
	"tasks.todoClearDelay": true,
	"dev.autoqaConsent": true,
	"input.bareExitOnEmptySession": true,
	"input.bareSlashCommands": true,
	"worktree.onStart": true,
	"worktree.onExit": true,
	"memories.enabled": true,
	// The desktop passes --approval-mode on every spawn; 通用 ▸ 审批模式 is the real control.
	"tools.approvalMode": true,
};

/** Keys owned by dedicated desktop editors (model roles, fallback chain, context window). */
const EDITOR_KEYS: Readonly<Record<string, true>> = {
	"modelRoles": true,
	"task.agentModelOverrides": true,
	"retry.fallbackChains": true,
	"retry.modelFallback": true,
	"retry.fallbackOn": true,
	"retry.fallbackRevertPolicy": true,
	"retry.usageAwareFallback": true,
	"retry.usageReservePct": true,
	"retry.usageReservePolicy": true,
	"cycleOrder": true,
	"modelRoleStorage": true,
	"extendedContext": true,
};
const EDITOR_PREFIXES: readonly string[] = ["compaction.", "contextPromotion."];

/** False for terminal-only keys and keys rendered by dedicated editors. */
export function isDesktopRelevant(key: string): boolean {
	if (HIDDEN_KEYS[key] || EDITOR_KEYS[key]) return false;
	return !HIDDEN_PREFIXES.some((p) => key.startsWith(p)) && !EDITOR_PREFIXES.some((p) => key.startsWith(p));
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

const SECTION_INDEX = new Map(RULES.map((r, i) => [r.id, i]));
const EXACT = new Map<string, { rule: SectionRule; order: number }>();
const PREFIXES: { prefix: string; rule: SectionRule }[] = [];
for (const rule of RULES) {
	rule.exact?.forEach((key, order) => {
		if (EXACT.has(key)) throw new Error(`duplicate exact placement for ${key}`);
		EXACT.set(key, { rule, order });
	});
	for (const prefix of rule.prefixes ?? []) PREFIXES.push({ prefix, rule });
}
PREFIXES.sort((a, b) => b.prefix.length - a.prefix.length);
const TOOL_SWITCH = /^[^.]+\.enabled$/;
const TOOLS_AVAILABLE = RULES.find((r) => r.id === "tools.available") as SectionRule;
const FALLBACK = RULES.find((r) => r.id === FALLBACK_ID) as SectionRule;

function resolve(key: string): { rule: SectionRule; rank: number } {
	const exact = EXACT.get(key);
	if (exact) return { rule: exact.rule, rank: exact.order };
	const hit = PREFIXES.find((p) => key.startsWith(p.prefix));
	if (hit) return { rule: hit.rule, rank: TOOL_SWITCH.test(key) ? 1_000 : 1_001 };
	if (TOOL_SWITCH.test(key)) return { rule: TOOLS_AVAILABLE, rank: 1_000 };
	return { rule: FALLBACK, rank: 1_001 };
}

function toDef(rule: SectionRule): OmpSectionDef {
	return OMP_SECTIONS[SECTION_INDEX.get(rule.id) as number];
}

/** Placement for a key (callers filter with isDesktopRelevant first). */
export function ompSectionFor(key: string): OmpSectionDef {
	return toDef(resolve(key).rule);
}

/** Sections of a host page in display order; `slot` narrows to one sub-tab. */
export function ompSectionsForPage(page: OmpHostPage, slot?: string): readonly OmpSectionDef[] {
	return OMP_SECTIONS.filter((s) => s.page === page && (slot === undefined || s.slot === slot));
}

/** Desktop-relevant entries of a page grouped by section, rows ordered per the section table. */
export function groupEntriesForPage(
	entries: readonly OmpConfigEntry[],
	page: OmpHostPage,
	slot?: string,
): { section: OmpSectionDef; entries: OmpConfigEntry[] }[] {
	const buckets = new Map<string, { entry: OmpConfigEntry; rank: number }[]>();
	for (const entry of entries) {
		if (!isDesktopRelevant(entry.key)) continue;
		const { rule, rank } = resolve(entry.key);
		if (rule.page !== page || (slot !== undefined && rule.slot !== slot)) continue;
		let list = buckets.get(rule.id);
		if (!list) buckets.set(rule.id, (list = []));
		list.push({ entry, rank });
	}
	const out: { section: OmpSectionDef; entries: OmpConfigEntry[] }[] = [];
	for (const section of ompSectionsForPage(page, slot)) {
		const list = buckets.get(section.id);
		if (!list) continue;
		list.sort((a, b) => a.rank - b.rank || (a.entry.key < b.entry.key ? -1 : a.entry.key > b.entry.key ? 1 : 0));
		out.push({ section, entries: list.map((x) => x.entry) });
	}
	return out;
}

// ---------------------------------------------------------------------------
// TUI conditions
// ---------------------------------------------------------------------------

type ValueOf = (key: string) => unknown;

interface Condition {
	met(v: ValueOf): boolean;
	hint: string;
}

const MEMORY_BACKEND = "memory.backend";

function backendIs(backend: string): (v: ValueOf) => boolean {
	return (v) => v(MEMORY_BACKEND) === backend;
}

/** Conditions by omp `ui.condition` id (omp config/settings-ui.ts CONDITIONS). */
const CONDITIONS: Readonly<Record<string, Condition>> = {
	advisorEnabled: { met: (v) => v("advisor.enabled") === true, hint: "开启顾问模型后显示" },
	hindsightActive: { met: backendIs("hindsight"), hint: "当前记忆后端不是 Hindsight，只在它生效的设置先不显示，共" },
	mnemopiActive: { met: backendIs("mnemopi"), hint: "当前记忆后端不是 Mnemopi，只在它生效的设置先不显示，共" },
	sharpshooterActive: { met: backendIs("sharpshooter"), hint: "当前记忆后端不是 Sharpshooter，只在它生效的设置先不显示，共" },
	localMemoryActive: { met: backendIs("local"), hint: "当前记忆后端不是本地，只在本地后端生效的设置先不显示，共" },
	autolearnActive: { met: (v) => v("autolearn.enabled") === true, hint: "开启自主学习后显示" },
	autoThinkingActive: { met: (v) => v("defaultThinkingLevel") === "auto", hint: "思考级别设为「自动」后显示" },
	usageAwareFallbackEnabled: { met: (v) => v("retry.usageAwareFallback") === true, hint: "开启按额度切换备用模型后显示" },
	planModeEnabled: { met: (v) => v("plan.enabled") !== false, hint: "开启计划模式后显示" },
	planAutosaveEnabled: { met: (v) => v("plan.enabled") !== false && v("plan.autosave") === true, hint: "开启计划自动保存后显示" },
	vimModeEnabled: { met: (v) => v("tui.vimMode") === true, hint: "开启 Vim 模式后显示" },
};

/** Conditions that cannot gate a desktop row (terminal capability, platform, provenance): always met. */
const ALWAYS_MET: Readonly<Record<string, true>> = {
	macOS: true,
	hasImageProtocol: true,
	nativeRendering: true,
	contextFilesExtraNotProject: true,
};

/** Condition id for a key: omp's `ui.condition`, else its settings family. */
function conditionIdFor(key: string): string | null {
	const declared = OMP_CONFIG_META[key]?.condition;
	if (declared) return declared;
	if (key.startsWith("hindsight.")) return "hindsightActive";
	if (key.startsWith("mnemopi.")) return "mnemopiActive";
	if (key.startsWith("sharpshooter.")) return "sharpshooterActive";
	if (key.startsWith("memories.") && key !== "memories.enabled") return "localMemoryActive";
	if (key.startsWith("advisor.") && key !== "advisor.enabled") return "advisorEnabled";
	if (key.startsWith("autolearn.") && key !== "autolearn.enabled") return "autolearnActive";
	if (key === "providers.autoThinkingMaxEffort") return "autoThinkingActive";
	if (key === "plan.autosaveDir") return "planAutosaveEnabled";
	if (key.startsWith("plan.") && key !== "plan.enabled") return "planModeEnabled";
	return null;
}

function conditionFor(key: string): Condition | null {
	const id = conditionIdFor(key);
	if (!id || ALWAYS_MET[id]) return null;
	return CONDITIONS[id] ?? null;
}

/** True when the row should be shown given the current config (unset values use schema defaults). */
export function ompConditionMet(key: string, valueOf: (key: string) => unknown): boolean {
	const condition = conditionFor(key);
	if (!condition) return true;
	return condition.met((k) => {
		const value = valueOf(k);
		return value === undefined || value === null ? OMP_CONFIG_DEFAULTS[k] : value;
	});
}

/** Chinese hint explaining why a conditional row is hidden, or null for unconditional keys. */
export function ompConditionHint(key: string): string | null {
	return conditionFor(key)?.hint ?? null;
}

// ---------------------------------------------------------------------------
// TUI location + search
// ---------------------------------------------------------------------------

const TUI_TAB_LABELS: Readonly<Record<string, string>> = {
	appearance: "Appearance",
	model: "Model",
	interaction: "Interaction",
	context: "Context",
	memory: "Memory",
	files: "Files",
	shell: "Shell",
	tools: "Tools",
	tasks: "Tasks",
	providers: "Providers",
};

/** Where the same setting lives in omp's terminal /settings, e.g. 「终端 /settings › Model › Thinking · Default Thinking Level」. */
export function ompTuiLocation(key: string): string | null {
	const meta = OMP_CONFIG_META[key];
	if (!meta?.tab) return null;
	const parts = ["终端 /settings", TUI_TAB_LABELS[meta.tab] ?? meta.tab];
	if (meta.group) parts.push(meta.group);
	const where = parts.join(" › ");
	return meta.label ? `${where} · ${meta.label}` : where;
}

/** Search haystack: key, zh title, English TUI label, zh description, section title, TUI group. */
export function ompSearchTerms(key: string): string[] {
	const meta = OMP_CONFIG_META[key];
	const section = ompSectionFor(key);
	const terms = [key, ompConfigTitle(key), meta?.label, ompConfigDescription(key), section.title, section.tui];
	return terms.filter((t): t is string => typeof t === "string" && t.length > 0);
}
