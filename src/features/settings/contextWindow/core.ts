/**
 * Pure logic for Settings ▸ 上下文窗口: keyword rules (localStorage), rule
 * priority, new-model window resolution (D15), compaction trigger points and
 * table row helpers. No React / IPC.
 */
import { matchKey, ruleMatches, tokenizeModelId } from "../modelNormalization";

export type ContextWindowRule = { id: string; keywords: string[]; contextWindow: number; createdAt: number };

export const RULES_STORAGE_KEY = "ompws.contextWindowRules.v1";

function sanitizeRule(r: unknown): ContextWindowRule | null {
	if (!r || typeof r !== "object") return null;
	const o = r as Record<string, unknown>;
	const keywords = Array.isArray(o.keywords)
		? o.keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "")
		: [];
	if (typeof o.id !== "string" || !o.id || keywords.length === 0) return null;
	if (typeof o.contextWindow !== "number" || !(o.contextWindow > 0)) return null;
	return {
		id: o.id,
		keywords,
		contextWindow: Math.round(o.contextWindow),
		createdAt: typeof o.createdAt === "number" ? o.createdAt : 0,
	};
}

export function loadRules(): ContextWindowRule[] {
	try {
		const raw = globalThis.localStorage?.getItem(RULES_STORAGE_KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : [];
		return Array.isArray(parsed)
			? parsed.map(sanitizeRule).filter((r): r is ContextWindowRule => r != null)
			: [];
	} catch {
		return [];
	}
}

export function saveRules(rules: ContextWindowRule[]): void {
	globalThis.localStorage?.setItem(RULES_STORAGE_KEY, JSON.stringify(rules));
}

/** Split a search box string into rule keywords. */
export function keywordsOf(query: string): string[] {
	return query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}

/**
 * 「记住为规则」keywords derived from the selected raw model ids. One normalized model
 * (same matchKey) → that model's tokens; otherwise every token shared by all selected
 * ids, in the first id's order (vendor tokens like `claude` dropped). Empty = no common name.
 */
export function ruleKeywordsForSelection(modelIds: readonly string[]): string[] {
	if (modelIds.length === 0) return [];
	const keys = modelIds.map((id) => matchKey(id).key);
	const keyTokens = keys.map((k) => k.split("-").filter(Boolean));
	if (keys.every((k) => k === keys[0])) return keyTokens[0];
	return keyTokens[0].filter((t, i, arr) => arr.indexOf(t) === i && keyTokens.every((ts) => ts.includes(t)));
}

/** True when the raw model id contains every rule keyword (typo-tolerant). */
export function matchRule(rule: Pick<ContextWindowRule, "keywords">, modelId: string): boolean {
	return ruleMatches(rule, modelId);
}

/** D12: more keywords (more specific) wins; equal count → later createdAt wins. */
export function pickRule(rules: readonly ContextWindowRule[], modelId: string): ContextWindowRule | null {
	let best: ContextWindowRule | null = null;
	for (const r of rules) {
		if (!matchRule(r, modelId)) continue;
		if (
			!best ||
			r.keywords.length > best.keywords.length ||
			(r.keywords.length === best.keywords.length && r.createdAt >= best.createdAt)
		)
			best = r;
	}
	return best;
}

/** D15 order for a model without a window: user rule → OMP catalog → provider default; null = unknown. */
export function resolveNewModelWindow({
	modelId,
	rules,
	catalogWindow,
	providerDefault,
}: {
	modelId: string;
	rules: readonly ContextWindowRule[];
	catalogWindow?: number | null;
	providerDefault?: number | null;
}): { value: number; source: "rule" | "catalog" | "providerDefault" } | null {
	const rule = pickRule(rules, modelId);
	if (rule) return { value: rule.contextWindow, source: "rule" };
	if (catalogWindow != null && catalogWindow > 0) return { value: catalogWindow, source: "catalog" };
	if (providerDefault != null && providerDefault > 0) return { value: providerDefault, source: "providerDefault" };
	return null;
}

/** Window of the same model type (normalized key) in the OMP catalog, first known value. */
export function catalogWindowFor(
	modelId: string,
	catalog: readonly { id: string; contextWindow?: number | null }[],
): number | null {
	const key = matchKey(modelId).key;
	for (const m of catalog) {
		if (m.contextWindow != null && m.contextWindow > 0 && matchKey(m.id).key === key) return m.contextWindow;
	}
	return null;
}

/**
 * Token count at which auto-compaction fires for a window. Percent mode scales the
 * window; token mode is absolute and unreachable once it reaches the window.
 */
export function compactionTriggerPoint(
	window: number,
	threshold: { mode: "percent" | "tokens"; value: number },
): { tokens: number; unreachable: boolean } {
	if (threshold.mode === "percent") return { tokens: Math.round((window * threshold.value) / 100), unreachable: false };
	return { tokens: threshold.value, unreachable: threshold.value >= window };
}

// ── Table rows ───────────────────────────────────────────────────────

export type RowKind = "workbench" | "catalog";

/** One provider × model row. */
export interface CwRow {
	providerId: string;
	providerName: string;
	modelId: string;
	contextWindow: number | null;
	kind: RowKind;
	/** Upstream original window (OMP catalog built-in without a models.yml override); null = unknown. */
	upstreamWindow: number | null;
}

/** D10: warn only when a new value exceeds the known upstream original window. */
export function exceedsUpstream(row: Pick<CwRow, "upstreamWindow">, value: number): boolean {
	return row.upstreamWindow != null && value > row.upstreamWindow;
}

export const rowKey = (r: Pick<CwRow, "providerId" | "modelId">) => `${r.providerId}/${r.modelId}`;

export const FAMILIES = ["Claude", "GPT", "Gemini", "DeepSeek", "Qwen", "其他"] as const;
export type Family = (typeof FAMILIES)[number];

/** Vendor family from the raw model id. */
export function modelFamily(modelId: string): Family {
	const tokens = tokenizeModelId(modelId);
	const has = (re: RegExp) => tokens.some((t) => re.test(t));
	if (has(/^(claude|anthropic|opus|sonnet|haiku)$/)) return "Claude";
	if (has(/^(gpt|chatgpt|codex)/) || /^o\d/.test(tokens[0] ?? "")) return "GPT";
	if (has(/^(gemini|gemma)$/)) return "Gemini";
	if (has(/^deepseek/)) return "DeepSeek";
	if (has(/^(qwen|qwq|qvq)/)) return "Qwen";
	return "其他";
}

export type StatusFilter = "all" | "unset" | "mixed" | "set";

/** Rows that change under a rule (only where this rule wins), plus takeovers by more specific rules. */
export interface RulePlan {
	changes: { row: CwRow; from: number | null; to: number }[];
	takenOver: { row: CwRow; winner: ContextWindowRule }[];
}

/** Effect of `rule` (already part of `allRules`) on the given rows. */
export function planRule(rule: ContextWindowRule, allRules: readonly ContextWindowRule[], rows: readonly CwRow[]): RulePlan {
	const plan: RulePlan = { changes: [], takenOver: [] };
	for (const row of rows) {
		if (!matchRule(rule, row.modelId)) continue;
		const winner = pickRule(allRules, row.modelId);
		if (winner && winner.id !== rule.id) plan.takenOver.push({ row, winner });
		else if (row.contextWindow !== rule.contextWindow)
			plan.changes.push({ row, from: row.contextWindow, to: rule.contextWindow });
	}
	return plan;
}

/** Number of rows matched by `rule` but won by a more specific rule. */
export function takenOverCount(rule: ContextWindowRule, allRules: readonly ContextWindowRule[], rows: readonly CwRow[]): number {
	return rows.filter((r) => matchRule(rule, r.modelId) && pickRule(allRules, r.modelId)?.id !== rule.id).length;
}
