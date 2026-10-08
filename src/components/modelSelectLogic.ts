/**
 * Pure helpers behind the shared `ModelSelect`: thinking-suffix parse/compose,
 * role → model resolution (omp `modelRoles`), and the recent-models list.
 */
import { type ModelOption, toModelKey } from "../lib/models";

/** Thinking levels accepted as a trailing `:<level>` on a model/role selector. */
export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
	"auto",
] as const;

const LEVEL_LOOKUP: Record<string, true> = Object.fromEntries(
	THINKING_LEVELS.map((l) => [l, true]),
);

export interface Selection {
	/** Selector without suffix: "provider/id", "smol", "@smol", "" … */
	selector: string;
	/** Thinking level suffix, or null when absent. */
	level: string | null;
}

/** Split `<selector>[:<level>]`; only a known trailing level counts as suffix. */
export function parseSelection(value: string | null | undefined): Selection {
	const trimmed = (value ?? "").trim();
	const idx = trimmed.lastIndexOf(":");
	if (idx > 0) {
		const maybe = trimmed.slice(idx + 1);
		if (LEVEL_LOOKUP[maybe]) return { selector: trimmed.slice(0, idx), level: maybe };
	}
	return { selector: trimmed, level: null };
}

/** Compose `<selector>:<level>`; null/empty level yields the bare selector. */
export function composeSelection(selector: string, level?: string | null): string {
	const sel = selector.trim();
	if (!sel) return "";
	return level ? `${sel}:${level}` : sel;
}

/** Role ids the picker knows how to resolve and label. */
export const RESOLVABLE_ROLES: Record<string, string> = {
	smol: "快速模型 (smol)",
	default: "主力模型 (default)",
	slow: "深度模型 (slow)",
};

/** Role id for a selector like "smol" / "@smol", else null. */
export function roleIdOf(selector: string): string | null {
	const id = selector.startsWith("@") ? selector.slice(1) : selector;
	return Object.prototype.hasOwnProperty.call(RESOLVABLE_ROLES, id) ? id : null;
}

export type RoleResolution =
	/** Role configured; `model` is the catalog entry when found. */
	| { kind: "model"; selector: string; level: string | null; model: ModelOption | null }
	/** Role unconfigured; omp falls back to the configured `default` role. */
	| { kind: "followDefault"; selector: string; level: string | null; model: ModelOption | null }
	/** Neither role nor `default` configured; omp picks automatically. */
	| { kind: "auto" };

function findModel(selector: string, models: ModelOption[] | null): ModelOption | null {
	if (!models) return null;
	return (
		models.find((m) => toModelKey(m.provider, m.id) === selector) ??
		(selector.includes("/") ? null : (models.find((m) => m.id === selector) ?? null))
	);
}

/** Follow `modelRoles.<role>` (and `@alias` chains) to a concrete selector. */
function followRole(
	roles: Record<string, unknown>,
	role: string,
	seen: Set<string>,
): Selection | null {
	if (seen.has(role)) return null;
	seen.add(role);
	const raw = roles[role];
	if (typeof raw !== "string" || !raw.trim()) return null;
	const sel = parseSelection(raw);
	if (sel.selector.startsWith("@")) {
		const inner = followRole(roles, sel.selector.slice(1), seen);
		if (!inner) return null;
		return { selector: inner.selector, level: sel.level ?? inner.level };
	}
	return sel;
}

/**
 * Resolve a role to its model. Unconfigured roles fall back to `default`
 * (omp semantics for `@role`), then to omp's automatic pick.
 */
export function resolveRole(
	roles: Record<string, unknown>,
	role: string,
	models: ModelOption[] | null,
): RoleResolution {
	const own = followRole(roles, role, new Set());
	if (own) return { kind: "model", ...own, model: findModel(own.selector, models) };
	if (role !== "default") {
		const def = followRole(roles, "default", new Set());
		if (def) return { kind: "followDefault", ...def, model: findModel(def.selector, models) };
	}
	return { kind: "auto" };
}

/** Text after the role label, e.g. "Claude Haiku · high" / "跟随主力：Opus" / "omp 自动挑选". */
export function describeResolution(r: RoleResolution, levelOverride?: string | null): string {
	if (r.kind === "auto") return levelOverride ? `omp 自动挑选 · ${levelOverride}` : "omp 自动挑选";
	const name = r.model?.name ?? r.selector;
	const level = levelOverride ?? r.level;
	const base = r.kind === "followDefault" ? `跟随主力：${name}` : name;
	return level ? `${base} · ${level}` : base;
}

export const RECENT_MODELS_CAP = 5;

/** Move `key` to the front, dedupe, cap. */
export function pushRecent(list: readonly string[], key: string, cap = RECENT_MODELS_CAP): string[] {
	return [key, ...list.filter((k) => k !== key)].slice(0, cap);
}

/** Real catalog-style model key ("provider/id"); excludes roles, placeholders, empty. */
export function isRecordableModelKey(key: string): boolean {
	const k = key.trim();
	if (!k || k.startsWith("__") || k.startsWith("@")) return false;
	const slash = k.indexOf("/");
	return slash > 0 && slash < k.length - 1;
}
