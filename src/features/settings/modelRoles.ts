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

/** Thinking levels recognized as a trailing `:level` when a value is split, e.g. "anthropic/x:high". */
export const THINKING_SUFFIXES = [
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"auto",
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
