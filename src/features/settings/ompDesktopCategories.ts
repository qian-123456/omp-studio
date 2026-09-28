/**
 * [D] Desktop-facing categories for `omp config list` entries.
 *
 * The desktop app drives omp with `--mode rpc`, so omp's own TUI surface
 * (theme, status line, composer, keybindings, speech/STT, …) is noise here.
 * Policy:
 *   - TUI-only prefixes/keys and keys edited by dedicated UIs are HIDDEN and
 *     never reach the settings list (see HIDDEN_PREFIXES / HIDDEN_KEYS).
 *   - Everything else maps to one desktop-native category; first match in
 *     `CATEGORY_MATCH` wins, unmatched visible keys fall back to `advanced`.
 *
 * Keep this in sync with the design doc `docs/OMP_SETTINGS_DESKTOP.md` and
 * the category contract negotiated for the settings rework.
 */

import type { OmpConfigEntry } from "../../lib/contracts";

export interface OmpDesktopCategory {
	id: string;
	label: string;
	hint: string;
}

/** Desktop categories in nav order; `advanced` is the fallback bucket. */
export const OMP_DESKTOP_CATEGORIES: OmpDesktopCategory[] = [
	{ id: "model", label: "模型与目录", hint: "模型目录与选择" },
	{ id: "thinking", label: "思考与采样", hint: "思考级别、预算与采样参数" },
	{ id: "retry", label: "重试与回退", hint: "重试、回退与流式限制" },
	{ id: "context", label: "上下文与记忆", hint: "压缩、上下文与记忆" },
	{ id: "tools", label: "工具与审批", hint: "工具开关、审批与扩展能力" },
	{ id: "tasks", label: "任务与子代理", hint: "子代理、隔离与工作树" },
	{ id: "providers", label: "提供商与网络", hint: "传输、扩展与认证" },
	{ id: "advanced", label: "高级", hint: "其余桌面相关配置" },
];

const CATEGORY_BY_ID: Record<string, OmpDesktopCategory> = Object.fromEntries(
	OMP_DESKTOP_CATEGORIES.map((c) => [c.id, c]),
);
const ADVANCED = CATEGORY_BY_ID.advanced;

/**
 * TUI-only prefixes — meaningless in the desktop app, never listed.
 * Prefixes carry a trailing dot so `speech.` doesn't swallow `speechgen.*`
 * and `tts.` doesn't swallow `ttsr.*` (though `ttsr.` is hidden anyway).
 */
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
	"shellMinimizer.",
	"speech.",
	"stt.",
	"live.",
	"ttsr.",
	"spelling.",
];

/**
 * Individual hidden keys. `modelRoles` and `retry.fallbackChains` are edited
 * by the dedicated model-roles UI (omp `/model` Roles view), not the flat
 * list; the rest are TUI-only settings with no desktop surface.
 */
const HIDDEN_KEYS: Record<string, true> = {
	symbolPreset: true,
	colorBlindMode: true,
	showHardwareCursor: true,
	autocompleteMaxVisible: true,
	emojiAutocomplete: true,
	doubleEscapeAction: true,
	treeFilterMode: true,
	autoResume: true,
	"completion.notify": true,
	"error.notify": true,
	readLineNumbers: true,
	"read.toolResultPreview": true,
	setupVersion: true,
	// Edited by the dedicated Roles UI, not the flat config list.
	modelRoles: true,
	"retry.fallbackChains": true,
};

interface CategoryMatch {
	id: string;
	/** Bare keys matched exactly (e.g. `temperature`). */
	exact: Record<string, true>;
	/** Dotted prefixes; `read.` matches `read.defaultLimit` but not `readLineNumbers`. */
	prefixes: readonly string[];
}

/**
 * Membership rules, evaluated in nav order — first match wins. Order matters:
 * `providers.*` carve-outs living in `thinking`/`retry` must run before the
 * `providers` catch-all, and `tools` claims `read.*`/`edit.*`/`task.*`…
 * before the `tasks`/`advanced` buckets see them.
 */
const CATEGORY_MATCH: readonly CategoryMatch[] = [
	{
		id: "model",
		exact: {
			modelProviderOrder: true,
			enabledModels: true,
			enabledProviders: true,
			disabledProviders: true,
			modelTags: true,
			modelRoleStorage: true,
			cycleOrder: true,
			includeModelInPrompt: true,
		},
		prefixes: [
			"model.loopGuard.",
			"model.toolCallLoopGuard.",
			"features.",
			"codexResets.",
		],
	},
	{
		id: "thinking",
		exact: {
			defaultThinkingLevel: true,
			hideThinkingBlock: true,
			proseOnlyThinking: true,
			omitThinking: true,
			externalThinking: true,
			"providers.autoThinkingMaxEffort": true,
			temperature: true,
			topP: true,
			topK: true,
			minP: true,
			presencePenalty: true,
			repetitionPenalty: true,
			textVerbosity: true,
			personality: true,
		},
		prefixes: ["thinkingBudgets.", "tier."],
	},
	{
		id: "retry",
		exact: {
			"providers.anthropic.serverSideFallback": true,
			"provider.appendOnlyContext": true,
			"providers.streamFirstEventTimeoutSeconds": true,
			"providers.streamIdleTimeoutSeconds": true,
			"providers.maxInFlightRequests": true,
			"providers.cacheRetention": true,
		},
		prefixes: ["retry."],
	},
	{
		id: "context",
		exact: {
			extendedContext: true,
			includeWorkspaceTree: true,
			skillful: true,
			steeringMode: true,
			followUpMode: true,
			interruptMode: true,
		},
		prefixes: [
			"compaction.",
			"contextPromotion.",
			"workspace.",
			"title.",
			"recap.",
			"memory.",
			"hindsight.",
			"mnemopi.",
			"memories.",
			"autolearn.",
			"goal.",
		],
	},
	{
		id: "tools",
		exact: {},
		prefixes: [
			"tools.",
			"bash.",
			"eval.",
			"python.",
			"lsp.",
			"edit.",
			"read.",
			"glob.",
			"grep.",
			"astGrep.",
			"astEdit.",
			"find.",
			"debug.",
			"launch.",
			"fetch.",
			"vault.",
			"github.",
			"web_search.",
			"security.",
			"ask.",
			"browser.",
			"computer.",
			"images.",
			"checkpoint.",
			"speechgen.",
			"generate_image.",
			"mcp.",
			"async.",
			"irc.",
			"plan.",
			"skills.",
			"commands.",
			"secrets.",
			"tts.",
			"todo.",
		],
	},
	{
		id: "tasks",
		exact: {},
		prefixes: ["task.", "tasks.", "isolation.", "worktree.", "prewalk."],
	},
	{
		id: "providers",
		exact: { extensions: true, disabledExtensions: true },
		prefixes: [
			"providers.",
			"searxng.",
			"exa.",
			"auth.",
			"extensionHandlers.",
			"dev.",
			"gc.",
			"commit.",
			"git.",
		],
	},
	// `advanced` intentionally has no rules: it catches every visible key
	// that matched nothing above (shellPath, power.*, future keys, …).
];

/** False when the key is TUI-only or owned by a dedicated editor UI. */
export function isDesktopRelevant(key: string): boolean {
	if (HIDDEN_KEYS[key]) return false;
	return !HIDDEN_PREFIXES.some((p) => key.startsWith(p));
}

/**
 * Resolve the desktop category for a key. First match in `CATEGORY_MATCH`
 * wins; unmatched keys land in `advanced`. Hidden keys are NOT special-cased
 * — filter them via `isDesktopRelevant` first.
 */
export function ompDesktopCategoryFor(key: string): OmpDesktopCategory {
	for (const m of CATEGORY_MATCH) {
		if (m.exact[key] || m.prefixes.some((p) => key.startsWith(p))) {
			return CATEGORY_BY_ID[m.id];
		}
	}
	return ADVANCED;
}

/**
 * Group entries into desktop categories: hidden entries dropped, categories
 * emitted in `OMP_DESKTOP_CATEGORIES` order (empty ones omitted), each
 * category's entries sorted by key.
 */
export function groupByDesktopCategory(
	entries: OmpConfigEntry[],
): { category: OmpDesktopCategory; entries: OmpConfigEntry[] }[] {
	const buckets: Record<string, OmpConfigEntry[]> = {};
	for (const entry of entries) {
		if (!isDesktopRelevant(entry.key)) continue;
		const category = ompDesktopCategoryFor(entry.key);
		(buckets[category.id] ??= []).push(entry);
	}
	const groups: { category: OmpDesktopCategory; entries: OmpConfigEntry[] }[] =
		[];
	for (const category of OMP_DESKTOP_CATEGORIES) {
		const list = buckets[category.id];
		if (!list) continue;
		list.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
		groups.push({ category, entries: list });
	}
	return groups;
}
