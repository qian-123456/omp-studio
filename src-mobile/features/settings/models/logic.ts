import type { PickerModel } from "../../../ui/ModelPicker";

/* ------------------------------------------------------------------ shared types */

export type CatalogModel = PickerModel & { provider: string; id: string };

export interface RoleLayer {
	modelRoles?: Record<string, string>;
}

export interface RolesResponse {
	snapshot?: { global?: RoleLayer; project?: RoleLayer | null };
	models?: CatalogModel[];
}

/* ------------------------------------------------------------------ roles */

export const ROLE_KEYS: { id: string; label: string }[] = [
	{ id: "default", label: "全局默认（主力模型）" },
	{ id: "reviewer", label: "代码审查（Reviewer）" },
	{ id: "editor", label: "文件编辑（Editor）" },
	{ id: "bash", label: "终端分析（Bash）" },
	{ id: "commit", label: "提交生成（Commit）" },
	{ id: "task", label: "任务代理（Task）" },
	{ id: "scout", label: "快速侦察（Scout）" },
];

export type RoleValue =
	| { kind: "none" }
	| { kind: "alias"; raw: string }
	| { kind: "model"; provider: string | null; modelId: string; thinking: string | null; raw: string; model?: CatalogModel };

/** Format a role value as the backend expects: `provider/model[:thinking]`. */
export function formatRoleValue(provider: string, modelId: string, thinking: string | null): string {
	const base = `${provider}/${modelId}`;
	return thinking ? `${base}:${thinking}` : base;
}

function findModel(models: CatalogModel[], ref: string): CatalogModel | undefined {
	const slash = ref.indexOf("/");
	if (slash > 0) {
		const provider = ref.slice(0, slash);
		const id = ref.slice(slash + 1);
		const hit = models.find((m) => m.provider === provider && m.id === id);
		if (hit) return hit;
	}
	return models.find((m) => m.id === ref);
}

/**
 * Parse a stored role value. Model ids may themselves contain ":" (e.g. `x:free`), so the
 * whole string is tried against the catalog before a trailing `:level` is stripped.
 */
export function parseRoleValue(raw: string | null | undefined, models: CatalogModel[]): RoleValue {
	const text = (raw ?? "").trim();
	if (!text) return { kind: "none" };
	if (text.startsWith("@")) return { kind: "alias", raw: text };
	const whole = findModel(models, text);
	if (whole) return { kind: "model", provider: whole.provider, modelId: whole.id, thinking: null, raw: text, model: whole };
	const cut = text.lastIndexOf(":");
	const head = cut > 0 ? text.slice(0, cut) : text;
	const level = cut > 0 ? text.slice(cut + 1) || null : null;
	const hit = findModel(models, head);
	if (hit) return { kind: "model", provider: hit.provider, modelId: hit.id, thinking: level, raw: text, model: hit };
	const slash = head.indexOf("/");
	return {
		kind: "model",
		provider: slash > 0 ? head.slice(0, slash) : null,
		modelId: slash > 0 ? head.slice(slash + 1) : head,
		thinking: level,
		raw: text,
	};
}

export function describeRoleValue(v: RoleValue): string {
	if (v.kind === "none") return "未配置";
	if (v.kind === "alias") return v.raw;
	const name = v.model?.name || v.modelId;
	const base = v.provider ? `${v.provider} · ${name}` : name;
	return `${base}　思考：${v.thinking ?? "自动"}`;
}

export interface RoleSetBody {
	cwd: string | null;
	scope: "global" | "project";
	table: "roles";
	name: string;
	value: string | null;
}

export function roleSetBody(
	cwd: string | null,
	roleId: string,
	value: { provider: string; modelId: string; thinking: string | null } | null,
): RoleSetBody {
	return {
		cwd,
		scope: cwd ? "project" : "global",
		table: "roles",
		name: roleId,
		value: value ? formatRoleValue(value.provider, value.modelId, value.thinking) : null,
	};
}

/** Thinking selection stays valid only if the new model supports it; otherwise falls back to auto. */
export function reconcileThinking(model: CatalogModel | undefined, current: string | null): string | null {
	if (!current) return null;
	if (current === "off") return (model?.thinking?.length ?? 0) > 0 ? "off" : null;
	return model?.thinking?.includes(current) ? current : null;
}

/* ------------------------------------------------------------------ diff */

export interface DiffRow {
	label: string;
	before: string;
	after: string;
}

export function changedRows(rows: DiffRow[]): DiffRow[] {
	return rows.filter((r) => r.before !== r.after);
}

/* ------------------------------------------------------------------ fallbacks */

export type FallbackChains = Record<string, string[]>;

export function normalizeChains(raw: unknown): FallbackChains {
	const out: FallbackChains = {};
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
	for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
		if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string");
	}
	return out;
}

/** Move one entry up (-1) or down (+1); out-of-range returns the same array contents. */
export function moveItem<T>(list: readonly T[], index: number, dir: -1 | 1): T[] {
	const next = [...list];
	const to = index + dir;
	if (index < 0 || index >= next.length || to < 0 || to >= next.length) return next;
	[next[index], next[to]] = [next[to], next[index]];
	return next;
}

export function removeAt<T>(list: readonly T[], index: number): T[] {
	return list.filter((_, i) => i !== index);
}

/** Replace one chain, preserving every other role's chain verbatim. Empty chain removes the key. */
export function withChain(chains: FallbackChains, role: string, chain: string[]): FallbackChains {
	const next: FallbackChains = { ...chains };
	if (chain.length) next[role] = chain;
	else delete next[role];
	return next;
}

export function fallbackSetBody(chains: FallbackChains): { chains: FallbackChains } {
	return { chains };
}

/** Whether a chain already contains the model (ignoring a `:thinking` suffix). */
export function chainHas(chain: readonly string[], provider: string, modelId: string): boolean {
	const key = `${provider}/${modelId}`;
	return chain.some((e) => e === key || e.startsWith(`${key}:`));
}

/* ------------------------------------------------------------------ context windows */

export interface ContextOverride {
	providerId: string;
	modelId: string;
	contextWindow: number | null;
}

export const CONTEXT_MIN = 1_000;
export const CONTEXT_MAX = 100_000_000;

export type ContextParse = { ok: true; value: number } | { ok: false; error: string };

/** Parse "128000", "128,000", "128k", "1m", "1.5m" into a token count with range validation. */
export function parseContextWindow(input: string): ContextParse {
	const text = input.trim().toLowerCase().replace(/[,\s_]/g, "");
	if (!text) return { ok: false, error: "请输入上下文大小" };
	const m = /^(\d+(?:\.\d+)?)([km]?)$/.exec(text);
	if (!m) return { ok: false, error: "只能输入数字，可带 k / m 后缀（如 128k、1m）" };
	const mult = m[2] === "m" ? 1_000_000 : m[2] === "k" ? 1_000 : 1;
	const value = Math.round(Number(m[1]) * mult);
	if (!Number.isFinite(value) || value < CONTEXT_MIN) return { ok: false, error: `不能小于 ${CONTEXT_MIN.toLocaleString("en-US")} tokens` };
	if (value > CONTEXT_MAX) return { ok: false, error: `不能大于 ${CONTEXT_MAX.toLocaleString("en-US")} tokens` };
	return { ok: true, value };
}

export function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export function findOverride(overrides: readonly ContextOverride[], provider: string, modelId: string): ContextOverride | undefined {
	return overrides.find((o) => o.providerId === provider && o.modelId === modelId && o.contextWindow);
}

export function contextSetBody(
	provider: string,
	modelId: string,
	contextWindow: number | null,
): { entries: ContextOverride[] } {
	return { entries: [{ providerId: provider, modelId, contextWindow }] };
}

/* ------------------------------------------------------------------ providers */

export type KeyKind =
	| "encrypted"
	| "vaultMissing"
	| "plaintext"
	| "envVar"
	| "command"
	| "oauth"
	| "loginStored"
	| "none"
	| "missing";

const KEY_LABELS: Record<KeyKind, string> = {
	encrypted: "已加密",
	vaultMissing: "密钥缺失",
	plaintext: "明文密钥",
	envVar: "环境变量",
	command: "命令获取",
	oauth: "账号登录",
	loginStored: "登录保存",
	none: "无需密钥",
	missing: "未设密钥",
};

export const keyLabel = (kind: string | undefined): string => KEY_LABELS[kind as KeyKind] ?? "未设密钥";

export const hasKey = (kind: string | undefined): boolean =>
	["encrypted", "plaintext", "envVar", "command", "oauth", "loginStored"].includes(kind ?? "");

export interface ProviderRow {
	id: string;
	displayName?: string | null;
	origin?: string;
	baseUrl?: string | null;
	api?: string | null;
	models?: unknown[];
	key?: { kind?: string; envVar?: string | null; envSet?: boolean | null };
	testable?: boolean;
}

export const KEY_MASK = "••••••••";

export interface ProviderSaveBody {
	id: string;
	base_url?: string;
	api_key?: string;
}

/** Body for POST /left/providers/save: only changed fields; the key is sent only when newly typed. */
export function providerSaveBody(row: ProviderRow, baseUrl: string, apiKey: string): ProviderSaveBody | null {
	const body: ProviderSaveBody = { id: row.id };
	const url = baseUrl.trim();
	if (row.origin === "custom" && url && url !== (row.baseUrl ?? "")) body.base_url = url;
	const key = apiKey.trim();
	if (key) body.api_key = key;
	return body.base_url || body.api_key ? body : null;
}

/** Before→after rows for confirmation. The key value is ALWAYS masked, never echoed. */
export function providerDiffRows(row: ProviderRow, baseUrl: string, apiKey: string): DiffRow[] {
	const rows: DiffRow[] = [];
	const body = providerSaveBody(row, baseUrl, apiKey);
	if (body?.base_url) rows.push({ label: "Base URL", before: row.baseUrl || "（未设置）", after: body.base_url });
	if (body?.api_key) {
		rows.push({
			label: "API Key",
			before: hasKey(row.key?.kind) ? KEY_MASK : "（未设置）",
			after: KEY_MASK,
		});
	}
	return rows;
}
