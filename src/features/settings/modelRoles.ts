/**
 * [D] Pure helpers for the desktop role settings: the built-in role catalogue,
 * role value parsing (`provider/id[:level]`, `@role` aliases), custom role keys
 * and the `retry.fallbackChains` record helpers.
 *
 * Primary role assignments (`modelRoles`) and agent overrides are written only by
 * the backend (`omp_model_roles_set`, a format-preserving YAML edit); no frontend
 * code rewrites the `modelRoles` record any more.
 *
 * `omp config set` accepts top-level keys only, so `retry.fallbackChains` is
 * rewritten as a whole record via `withChain` and `JSON.stringify`.
 */

export interface BuiltinRole {
	id: string;
	/** Short Chinese label for the role. */
	zhLabel: string;
	/** One-line Chinese description (from omp settings.md §Models). */
	description: string;
	/** chat = conversation roles; modelKind = service runners. Neither kind restricts the `:level` syntax of a role value. */
	kind: "chat" | "modelKind";
}

export const BUILTIN_ROLES: BuiltinRole[] = [
	// ---- chat roles ----
	{
		id: "default",
		zhLabel: "主力模型",
		description: "会话默认模型，承担主要对话与工具调用（--model）",
		kind: "chat",
	},
	{
		id: "smol",
		zhLabel: "快速模型",
		description: "轻量任务与快速响应使用的小模型（--smol / PI_SMOL_MODEL）",
		kind: "chat",
	},
	{
		id: "slow",
		zhLabel: "深度模型",
		description: "需要深入推理时使用的慢速模型（--slow / PI_SLOW_MODEL）",
		kind: "chat",
	},
	{
		id: "vision",
		zhLabel: "视觉模型",
		description: "处理图片、截图等多模态输入的模型",
		kind: "chat",
	},
	{
		id: "plan",
		zhLabel: "规划模型",
		description: "计划模式与架构规划使用的模型（--plan / PI_PLAN_MODEL）",
		kind: "chat",
	},
	{
		id: "commit",
		zhLabel: "提交信息",
		description: "生成 git 提交信息时使用的模型",
		kind: "chat",
	},
	{
		id: "tiny",
		zhLabel: "轻量后台",
		description: "后台轻量工作的本地小模型（接受 tiny 目录模型与普通聊天模型）",
		kind: "chat",
	},
	{
		id: "memory",
		zhLabel: "记忆",
		description: "记忆系统提炼与召回所用的模型（接受 tiny 目录模型与普通聊天模型）",
		kind: "chat",
	},
	{
		id: "task",
		zhLabel: "子代理",
		description: "task 子代理与子任务默认使用的模型",
		kind: "chat",
	},
	{
		id: "advisor",
		zhLabel: "顾问",
		description: "每轮结束后审查会话并可注入建议的第二模型（需 advisor.enabled）",
		kind: "chat",
	},
	// ---- model-kind roles (service runners) ----
	{
		id: "image",
		zhLabel: "图像生成",
		description: "generate_image 工具生成图片所用的模型",
		kind: "modelKind",
	},
	{
		id: "web",
		zhLabel: "网络搜索",
		description: "web_search 工具与 omp search 使用的搜索/落地模型",
		kind: "modelKind",
	},
	{
		id: "speech",
		zhLabel: "语音合成",
		description: "TTS 语音合成所用的模型",
		kind: "modelKind",
	},
	{
		id: "dictation",
		zhLabel: "语音识别",
		description: "STT 语音听写所用的模型",
		kind: "modelKind",
	},
	{
		id: "judge",
		zhLabel: "判断",
		description: "TypeSafe Jev 语义判断所用的模型（接受 tiny 与聊天模型）",
		kind: "modelKind",
	},
];

const BUILTIN_ROLE_IDS: Record<string, true> = Object.fromEntries(
	BUILTIN_ROLES.map((r) => [r.id, true]),
);

/**
 * omp's full thinking-suffix grammar, recognized as a trailing `:level` when a
 * value is split, e.g. "anthropic/x:high" or "agnes-free/x:off".
 */
export const THINKING_SUFFIXES = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"auto",
	"inherit",
] as const;

export type ThinkingSuffix = (typeof THINKING_SUFFIXES)[number];

const THINKING_SUFFIX_LOOKUP: Record<string, true> = Object.fromEntries(
	THINKING_SUFFIXES.map((s) => [s, true]),
);

export interface SplitRoleValue {
	/** Selector without the thinking suffix, e.g. "anthropic/claude-opus-4-5". */
	selector: string;
	/** Bare suffix without the colon ("high", "auto"), or null when absent. */
	thinkingSuffix: string | null;
}

/**
 * Split a role value into selector + optional thinking suffix.
 * Only a trailing `:level` whose level is a known thinking level counts;
 * "provider/id:8080" keeps its colon inside the selector.
 */
export function splitRoleValue(v: string): SplitRoleValue {
	const trimmed = v.trim();
	const idx = trimmed.lastIndexOf(":");
	if (idx > 0) {
		const maybeSuffix = trimmed.slice(idx + 1);
		if (THINKING_SUFFIX_LOOKUP[maybeSuffix]) {
			return {
				selector: trimmed.slice(0, idx),
				thinkingSuffix: maybeSuffix,
			};
		}
	}
	return { selector: trimmed, thinkingSuffix: null };
}

/** Role ids present in `modelRoles` that are not built-in — custom roles. */
export function customRoles(modelRoles: Record<string, unknown>): string[] {
	return Object.keys(modelRoles)
		.filter((k) => !BUILTIN_ROLE_IDS[k])
		.sort();
}

/** Primary selector string assigned to a role, or null when unset/non-string. */
export function roleValue(
	modelRoles: Record<string, unknown>,
	role: string,
): string | null {
	const v = modelRoles[role];
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

export type ChainState = "unset" | "empty" | "list";

export interface ParsedChain {
	/**
	 * unset = `retry.fallbackChains.<role>` key absent → omp built-in/inherited behavior;
	 * empty = explicit `[]` → never fall back;
	 * list  = ordered fallback selectors ("provider/id[:level]" or "@role" aliases).
	 */
	state: ChainState;
	items: string[];
}

/** Parse one role's chain value out of the `retry.fallbackChains` record. */
export function parseChain(v: unknown): ParsedChain {
	if (v === undefined || v === null) return { state: "unset", items: [] };
	if (Array.isArray(v)) {
		const items = v.filter(
			(x): x is string => typeof x === "string" && x.trim().length > 0,
		);
		return items.length === 0
			? { state: "empty", items: [] }
			: { state: "list", items };
	}
	// A bare string is treated as a one-item chain (defensive; schema wants arrays).
	if (typeof v === "string" && v.trim()) return { state: "list", items: [v.trim()] };
	return { state: "unset", items: [] };
}

/**
 * Serialize a chain for `omp config set` (JSON array string). The `unset`
 * state cannot be expressed as a value — callers must rewrite the record
 * without the key (see `withChain`); returns "" so accidental writes fail
 * validation instead of silently recording "no fallback".
 */
export function serializeChain(state: ChainState, items: string[]): string {
	if (state === "unset") return "";
	return JSON.stringify(state === "empty" ? [] : items);
}

/**
 * Return a copy of the `retry.fallbackChains` record with `role`'s chain set
 * to `items` — or removed when `items` is null (record-level "unset").
 */
export function withChain(
	chains: Record<string, unknown>,
	role: string,
	items: string[] | null,
): Record<string, unknown> {
	const next = { ...chains };
	if (items === null) {
		delete next[role];
	} else {
		next[role] = items;
	}
	return next;
}

/** Normalize an omp record value into a plain object map ({} when absent/invalid). */
export function asRecord(v: unknown): Record<string, unknown> {
	if (v && typeof v === "object" && !Array.isArray(v)) {
		return v as Record<string, unknown>;
	}
	return {};
}

/** Normalize an omp array value into a string list ([] when absent/invalid). */
export function asStringList(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x): x is string => typeof x === "string");
}

/** Thinking suffixes a fallback-chain entry may carry (omp 18 settings docs). */
export const CHAIN_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

const CHAIN_LEVEL_LOOKUP: Record<string, true> = Object.fromEntries(CHAIN_LEVELS.map((l) => [l, true]));

export interface ChainEntryParts {
	/** Entry without the thinking suffix. */
	selector: string;
	/** Bare level ("high") or null when the entry inherits the failing turn's level. */
	level: string | null;
}

/**
 * Split a chain entry into selector + thinking level. Only a trailing
 * `:off|minimal|low|medium|high|xhigh|max` counts, so ids with colons
 * ("ollama/qwen:7b", "localhost:11434/x") stay intact.
 */
export function splitChainEntry(entry: string): ChainEntryParts {
	const t = entry.trim();
	const idx = t.lastIndexOf(":");
	if (idx > 0 && CHAIN_LEVEL_LOOKUP[t.slice(idx + 1)]) {
		return { selector: t.slice(0, idx), level: t.slice(idx + 1) };
	}
	return { selector: t, level: null };
}

/** Inverse of splitChainEntry. */
export function formatChainEntry(selector: string, level: string | null): string {
	const s = selector.trim();
	return level ? `${s}:${level}` : s;
}

export interface WildcardParts {
	provider: string;
	/** Id prefix without slashes ("google" for "openrouter/google/*"), "" for a plain provider wildcard. */
	prefix: string;
}

/** Parse `provider/*` or `provider/prefix/*`; null when the selector is not a well-formed wildcard. */
export function parseWildcard(selector: string): WildcardParts | null {
	if (!selector.endsWith("/*")) return null;
	const body = selector.slice(0, -2);
	if (body.includes("*") || /\s/.test(body)) return null;
	const slash = body.indexOf("/");
	const provider = slash === -1 ? body : body.slice(0, slash);
	const prefix = slash === -1 ? "" : body.slice(slash + 1);
	if (!provider || (slash !== -1 && !prefix) || prefix.startsWith("/") || prefix.endsWith("/")) return null;
	return { provider, prefix };
}

/** Build `provider/*` or `provider/prefix/*`; stray slashes/stars on the prefix are trimmed. */
export function buildWildcard(provider: string, prefix = ""): string {
	const p = prefix.trim().replace(/\*+$/, "").replace(/^\/+|\/+$/g, "");
	return p ? `${provider.trim()}/${p}/*` : `${provider.trim()}/*`;
}

export type ChainEntryKind = "role" | "model" | "wildcard" | "invalid";

/** Classify a chain entry (with or without thinking suffix). */
export function classifyChainEntry(entry: string): ChainEntryKind {
	return validateChainEntry(entry) === null ? entryKind(splitChainEntry(entry).selector) : "invalid";
}

function entryKind(selector: string): ChainEntryKind {
	if (selector.startsWith("@")) return "role";
	return selector.includes("*") ? "wildcard" : "model";
}

/** Plain-language problem with a chain entry, or null when it is well-formed. */
export function validateChainEntry(entry: string): string | null {
	const t = entry.trim();
	if (!t) return "不能为空";
	if (/\s/.test(t)) return "不能包含空格";
	const { selector, level } = splitChainEntry(t);
	if (selector.startsWith("@")) {
		return /^@[^/*:@]+$/.test(selector) ? null : "角色别名写成 @角色名，例如 @smol";
	}
	if (selector.includes("*")) {
		if (!parseWildcard(selector)) return "通配符只能写成 供应商/* 或 供应商/前缀/*";
		return level ? "通配符条目总是沿用当前思考强度，不能加 :强度" : null;
	}
	const slash = selector.indexOf("/");
	if (slash <= 0 || slash === selector.length - 1) return "需要写成 供应商/模型，例如 openai/gpt-5";
	return null;
}

export type ChainKeyKind = "role" | "model" | "provider" | "prefix" | "invalid";

/** Classify a `retry.fallbackChains` key: role name, exact model, provider wildcard or prefixed wildcard. */
export function classifyChainKey(key: string): ChainKeyKind {
	if (validateChainKey(key) !== null) return "invalid";
	if (!key.includes("/")) return "role";
	const w = parseWildcard(key);
	if (!w) return "model";
	return w.prefix ? "prefix" : "provider";
}

/** Plain-language problem with a chain key, or null when it is usable. */
export function validateChainKey(key: string): string | null {
	if (!key.trim()) return "不能为空";
	if (key !== key.trim() || /\s/.test(key)) return "不能包含空格";
	if (!key.includes("/")) {
		return /[*:@]/.test(key) ? "角色名不能包含 * : @" : null;
	}
	if (key.includes("*")) return parseWildcard(key) ? null : "通配符只能写成 供应商/* 或 供应商/前缀/*";
	const slash = key.indexOf("/");
	if (slash <= 0 || slash === key.length - 1) return "需要写成 供应商/模型";
	if (splitChainEntry(key).level) return "规则对象不能带 :强度";
	return null;
}

/** Chain keys that are model / provider rules (contain "/"), in record order. */
export function ruleKeys(chains: Record<string, unknown>): string[] {
	return Object.keys(chains).filter((k) => k.includes("/"));
}
