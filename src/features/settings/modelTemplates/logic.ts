/**
 * [D] Pure logic behind Settings ▸ 模型角色 ▸ 角色模板与额度自动切换:
 * quota-window options, rule condition text, switch-status badges, recommended
 * role replacements, drift/auto-revert/conflict presentation.
 *
 * No React and no IPC here; the panel components only call these helpers.
 */

import type {
	CurrentTemplateState,
	ModelSwitchRule,
	ModelTemplate,
	ProviderStatus,
	RuleConflict,
} from "../../../lib/contracts";
import type { ModelOption } from "../../../lib/models";
import { splitRoleValue } from "../modelRoles";
import { formatHumanWindowName, KNOWN_BRAND_CONFIGS } from "../sections/quotaHelpers";

import { tNow } from "../../../stores/language";
// ── scope ────────────────────────────────────────────────────────────

/** Backend scope string of the global layer; every other scope is a project's absolute path. */
export const GLOBAL_SCOPE = "global";

/** A project that can be a scope: absolute path plus display name. */
export interface ScopeProject {
	path: string;
	name: string;
}

/** Last path segment (the directory name); the whole input when it has none. */
export function projectBasename(dir: string): string {
	return dir.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || dir;
}

/** 「全局」, or the project's registered name (falling back to its directory name). */
export function scopeDisplayName(scope: string, projects: ScopeProject[]): string {
	if (scope === GLOBAL_SCOPE) return tNow("modelTemplates.scopeGlobal");
	return projects.find((p) => p.path === scope)?.name ?? projectBasename(scope);
}

/** Items that belong to `scope` (templates, rules, log entries, conflicts). */
export function inScope<T extends { scope: string }>(items: readonly T[], scope: string): T[] {
	return items.filter((item) => item.scope === scope);
}

/** The 当前生效 state of `scope`; null when the backend reported none. */
export function currentForScope(
	currents: readonly CurrentTemplateState[],
	scope: string,
): CurrentTemplateState | null {
	return currents.find((c) => c.scope === scope) ?? null;
}

/** One-line statement of what applying a template writes in `scope`. */
export function scopeWriteHint(scope: string, projects: ScopeProject[]): string {
	return scope === GLOBAL_SCOPE
		? tNow("modelTemplates.writeHintGlobal")
		: tNow("modelTemplates.writeHintProject", { project: scopeDisplayName(scope, projects) });
}

/**
 * Defaults of a new rule form: the first reported provider/window, the page scope
 * and the first template of that scope.
 */
export function ruleFormDefaults(
	providers: ProviderStatus[],
	templates: readonly ModelTemplate[],
	scope: string,
): { scope: string; provider: string; windowKey: string; templateId: string } {
	const provider = providers[0]?.usageSlug ?? "";
	const window = provider ? windowOptionsFor(providers, provider)[0] : undefined;
	return {
		scope,
		provider,
		windowKey: window?.key ?? "",
		templateId: inScope(templates, scope)[0]?.id ?? "",
	};
}

// ── providers & windows ──────────────────────────────────────────────

/** Usage slug → model provider, mirroring the Rust `provider_map` table. Unknown slugs never guess. */
const USAGE_MODEL_PROVIDER: Record<string, string> = {
	anthropic: "anthropic",
	openai: "openai",
	"openai-codex": "openai",
	google: "google",
	"google-antigravity": "google",
	"kimi-code": "moonshot",
	zai: "zai",
	"zai-coding-plan": "zai",
	"zhipu-coding-plan": "zai",
	deepseek: "deepseek",
	"github-copilot": "github-copilot",
	cursor: "cursor",
	devin: "devin",
	"minimax-code": "minimax",
	"alibaba-token-plan": "alibaba",
	"alibaba-coding-plan": "alibaba",
	"opencode-go": "opencode",
	codegeex: "codegeex",
	openrouter: "openrouter",
};

/** Windows the provider actually reports, in report order. */
export function windowOptionsFor(
	providers: ProviderStatus[],
	usageSlug: string,
): { key: string; label: string; usedPct: number }[] {
	const provider = providers.find((p) => p.usageSlug === usageSlug);
	if (!provider) return [];
	return provider.windows.map((w) => ({
		key: w.key,
		label: w.label || formatHumanWindowName(w.key),
		usedPct: w.usedPct,
	}));
}

export function providerOptions(
	providers: ProviderStatus[],
): { value: string; label: string; state: string }[] {
	return providers.map((p) => ({
		value: p.usageSlug,
		label: KNOWN_BRAND_CONFIGS[p.usageSlug]?.name ?? p.usageSlug,
		state: p.state,
	}));
}

/** Rule condition text: 「Anthropic Claude · 5 小时滚动限额 ≥ 95%」. */
export function ruleConditionText(rule: ModelSwitchRule, providers: ProviderStatus[]): string {
	const provider = providers.find((p) => p.usageSlug === rule.provider);
	const window =
		provider?.windows.find((w) => w.key === rule.windowKey) ??
		provider?.windows.find((w) => w.key.toLowerCase() === rule.windowKey.toLowerCase());
	const windowLabel = window?.label || formatHumanWindowName(rule.windowKey);
	const brand = KNOWN_BRAND_CONFIGS[rule.provider]?.name ?? rule.provider;
	const pct = Number.isFinite(rule.thresholdPct) ? Math.round(rule.thresholdPct * 10) / 10 : 0;
	const pctText = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
	return tNow("modelTemplates.ruleCondition", { brand, window: windowLabel, pct: pctText });
}

// ── switch status ────────────────────────────────────────────────────

const STATUS_TONE: Record<string, "ok" | "warn" | "error" | "muted"> = {
	applied: "ok",
	partial: "warn",
	refused: "error",
	skipped: "muted",
	reverted: "muted",
	undone: "muted",
	failed: "error",
};

const STATUS_KEYS: Record<string, string> = {
	applied: "modelTemplates.status.applied",
	partial: "modelTemplates.status.partial",
	refused: "modelTemplates.status.refused",
	skipped: "modelTemplates.status.skipped",
	reverted: "modelTemplates.status.reverted",
	undone: "modelTemplates.status.undone",
	failed: "modelTemplates.status.failed",
};

export function statusLabel(status: string): string {
	const key = STATUS_KEYS[status];
	return key ? tNow(key) : status;
}

export function statusTone(status: string): "ok" | "warn" | "error" | "muted" {
	return STATUS_TONE[status] ?? "muted";
}


// ── recommendations ──────────────────────────────────────────────────

/** Provider of a role selector (`provider/model`, wildcard prefix, or a bare model id). */
function selectorProvider(selector: string, providerById: ReadonlyMap<string, string>): string | null {
	if (!selector || selector.startsWith("@")) return null;
	const slash = selector.indexOf("/");
	if (slash > 0) return selector.slice(0, slash);
	return providerById.get(selector) ?? null;
}

/**
 * Roles whose current selector belongs to the mapped model provider of `usageSlug`
 * (mirrors the backend `provider_matches`: mapped equality or raw equality).
 * An unmapped usage slug recommends nothing (never guess).
 */
export function recommendedRoles(
	roles: Record<string, string | null>,
	usageSlug: string,
	models: ModelOption[],
): string[] {
	const target = USAGE_MODEL_PROVIDER[usageSlug];
	if (!target) return [];
	const providerById = new Map<string, string>();
	for (const model of models) {
		if (!providerById.has(model.id)) providerById.set(model.id, model.provider);
	}
	const out: string[] = [];
	for (const [role, value] of Object.entries(roles)) {
		if (!value) continue;
		const provider = selectorProvider(splitRoleValue(value).selector, providerById);
		if (provider && (provider === target || provider === usageSlug)) out.push(role);
	}
	return out;
}

// ── current template & rules ─────────────────────────────────────────

export function driftSummary(current: CurrentTemplateState): string | null {
	const count = current.driftedRoles.length;
	if (count === 0) return null;
	const name = current.templateName?.trim() || current.templateId?.trim() || "";
	return tNow("modelTemplates.driftSummary", { name, count: String(count) });
}

/** True when the rule may auto-revert now: enabled, opted in, and the window is at or below its threshold. */
export function canAutoRevert(rule: ModelSwitchRule, providers: ProviderStatus[]): boolean {
	if (!rule.enabled || !rule.autoRevert) return false;
	const provider = providers.find((p) => p.usageSlug === rule.provider);
	const window = provider?.windows.find((w) => w.key === rule.windowKey);
	if (!window) return false;
	// The backend defaults a missing revert threshold to `threshold - 10`, clamped at 0.
	const threshold =
		rule.revertThresholdPct ?? Math.max(0, rule.thresholdPct - 10);
	return window.usedPct <= threshold;
}

const CONFLICT_KEYS: Record<string, string> = {
	"self-eating": "modelTemplates.conflictSelfEating",
	"mutual-escape": "modelTemplates.conflictMutualEscape",
	"no-bottom-line": "modelTemplates.conflictNoBottomLine",
};

/** Readable sentence for a rule conflict; unknown kinds fall back to the backend message. */
export function conflictText(conflict: RuleConflict): string {
	const key = CONFLICT_KEYS[conflict.kind];
	return key ? tNow(key) : conflict.message;
}
