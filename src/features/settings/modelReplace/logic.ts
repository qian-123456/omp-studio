/**
 * [D] Pure logic behind Settings ▸ 模型角色 ▸ 批量替换模型.
 *
 * Everything the dialog derives — matching, comma lists, thinking suffixes, new
 * values, chain renames/merges/dedupe, plan grouping, the retry merge and the
 * undo display — lives here, so the components only render and hand the result
 * to `model_replace_*`. Matching uses the app-wide rule (`splitRoleValue`): a
 * candidate refers to the source model when its selector is equal after a
 * trailing known thinking suffix is stripped, so the same id under another
 * provider never matches and `@role` aliases are never rewritten.
 */

import type {
	ChainChange,
	ModelKindEntry,
	ModelRefLocation,
	ModelReplaceEdit,
	ModelReplaceItemResult,
	ModelUsageScan,
	ScannedProject,
} from "../../../lib/contracts";
import type { ModelOption } from "../../../lib/models";
import { resolveCurrentModel, resolveThinkingLevels } from "../../../lib/models";
import { basename } from "../../../lib/paths";
import { BUILTIN_ROLES, splitRoleValue, THINKING_SUFFIXES } from "../modelRoles";
import { type KindGroup, kindGroup } from "./kinds";
import { tNow } from "../../../stores/language";

// ── selectors, comma lists, levels ───────────────────────────────────

/** Selector of a stored candidate, i.e. `:<level>` stripped when the level is known. */
export function selectorOf(value: string): string {
	return splitRoleValue(value).selector;
}

/**
 * True when a stored candidate refers to exactly `model` (suffix insensitive,
 * provider sensitive). Only real model selectors match: a bare role name, an
 * `@role` alias or a glob as `model` never matches anything.
 */
export function sameModel(candidate: string, model: string): boolean {
	const target = selectorOf(model);
	return isModelSelector(target) && selectorOf(candidate) === target;
}

/** The value a replacement writes: `model` plus `:<level>` when a level is chosen. */
export function withLevel(model: string, level: string | null | undefined): string {
	return level ? `${model}:${level}` : model;
}

/** Every suffix omp understands (`splitRoleValue` recognizes all of them), in display order. */
export const THINKING_LEVELS: readonly string[] = THINKING_SUFFIXES;

/**
 * Thinking levels the catalog offers for `selector` (`auto`, the supported levels, `off`),
 * via the app-wide `resolveThinkingLevels`. Empty when the model is unknown or has no
 * thinking control, i.e. when no level suffix may be written.
 */
export function levelsForSelector(entries: readonly ModelKindEntry[] | null, selector: string): string[] {
	const entry = selector ? entries?.find((e) => e.selector === selector) : undefined;
	return resolveThinkingLevels(undefined, entry?.thinking, null);
}

/** `level` when `levels` offers it, else null (模型默认, no suffix). */
export function supportedLevel(level: string | null | undefined, levels: readonly string[]): string | null {
	return level && levels.includes(level) ? level : null;
}

/**
 * Row overrides whose level is made explicit and valid for the override's own target:
 * a level inherited from the shared target that the override model cannot take becomes null.
 */
export function sanitizeOverrides(
	overrides: Record<string, RowOverride>,
	toModel: string,
	sharedLevel: string | null,
	entries: readonly ModelKindEntry[] | null,
): Record<string, RowOverride> {
	const out: Record<string, RowOverride> = {};
	for (const [id, override] of Object.entries(overrides)) {
		const model = override.model?.trim() || toModel;
		const wanted = override.level !== undefined ? override.level : sharedLevel;
		out[id] = { ...override, level: supportedLevel(wanted, levelsForSelector(entries, model)) };
	}
	return out;
}

/** Trimmed, non-empty candidates of a stored comma list (omp `split_candidates`). */
export function listCandidates(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s !== "");
}

/**
 * Replace every candidate of a stored comma list that refers to `from` with `to`.
 * Untouched segments keep their original text (including whitespace); returns
 * null when nothing matched, so callers can skip the row entirely.
 */
export function replaceValue(value: string, from: string, to: string): string | null {
	let matched = false;
	const next = value.split(",").map((segment) => {
		if (!sameModel(segment, from)) return segment;
		matched = true;
		return to;
	});
	return matched ? next.join(",") : null;
}

// ── labels ───────────────────────────────────────────────────────────

export type PlanGroup = "global" | "project" | "chain" | "appSetting" | "schedule";

/** Group headings in the order the preview shows them. */
export const GROUP_ORDER: readonly PlanGroup[] = ["global", "project", "chain", "appSetting", "schedule"];

export const GROUP_TITLE_KEYS: Record<PlanGroup, string> = {
	global: "modelReplace.groupTitle.global",
	project: "modelReplace.groupTitle.project",
	chain: "modelReplace.groupTitle.chain",
	appSetting: "modelReplace.groupTitle.appSetting",
	schedule: "modelReplace.groupTitle.schedule",
};

export const GROUP_TITLES: Record<PlanGroup, string> = new Proxy({} as Record<PlanGroup, string>, {
	get(_target, prop: string) {
		const key = GROUP_TITLE_KEYS[prop as PlanGroup];
		return key ? tNow(key) : undefined;
	},
});

const APP_SETTING_KEYS: Record<string, string> = {
	newSessionModel: "modelReplace.appSetting.newSessionModel",
	sideChatModel: "modelReplace.appSetting.sideChatModel",
	doctorModel: "modelReplace.appSetting.doctorModel",
};

export function appSettingLabel(field: string): string {
	const key = APP_SETTING_KEYS[field];
	return key ? tNow(key) : field;
}

/** `default · 主力模型` for built-in roles, else the raw key. */
export function roleTitle(name: string): string {
	const builtin = BUILTIN_ROLES.find((r) => r.id === name);
	return builtin ? `${name} · ${builtin.zhLabel}` : name;
}

/** Project display name for a scanned path (basename when the scan has no entry). */
export function projectNameMap(projects: ScannedProject[]): Record<string, string> {
	const names: Record<string, string> = {};
	for (const p of projects) names[p.path] = p.name || basename(p.path);
	return names;
}

const projectLabel = (path: string | null, names: Record<string, string>): string =>
	path === null ? tNow("modelReplace.project") : (names[path] ?? basename(path));

export interface LocationInfo {
	/** Stable row identity for one location. */
	id: string;
	group: PlanGroup;
	title: string;
	/** Right-hand scope hint (全局 / project name / …). */
	context: string;
}

export function locationInfo(location: ModelRefLocation, names: Record<string, string>): LocationInfo {
	if (location.kind === "role" || location.kind === "agentOverride") {
		return {
			id: `${location.kind}:${location.scope}:${location.projectPath ?? ""}:${location.name}`,
			group: location.scope === "global" ? "global" : "project",
			title: location.kind === "role" ? roleTitle(location.name) : tNow("modelReplace.subAgentTitle", { name: location.name }),
			context: location.scope === "global" ? tNow("modelReplace.scopeGlobal") : projectLabel(location.projectPath, names),
		};
	}
	if (location.kind === "appSetting") {
		return {
			id: `appSetting:${location.field}`,
			group: "appSetting",
			title: appSettingLabel(location.field),
			context: tNow("modelReplace.groupTitle.appSetting"),
		};
	}
	return {
		id: `schedule:${location.id}`,
		group: "schedule",
		title: location.name || location.id,
		context: tNow("modelReplace.groupTitle.schedule"),
	};
}

/**
 * Whether a candidate is a model selector rather than a bare role name
 * (`smol`, `web`), an `@role` alias or a glob chain key (`provider/*`):
 * it contains `/`, does not start with `@` and has no glob characters.
 */
export function isModelSelector(candidate: string): boolean {
	const value = candidate.trim();
	return value.includes("/") && !value.startsWith("@") && !/[*?[]/.test(value);
}

// ── scope ────────────────────────────────────────────────────────────

/**
 * Where a replacement may touch: everything (`all`), only what is not tied to a project
 * (`global`: global role/agent config, fallback chains, app settings, schedules), or one
 * project's own configs (`project:<path>`).
 */
export type ReplaceScope = "all" | "global" | `project:${string}`;

export const SCOPE_ALL: ReplaceScope = "all";

export function projectScope(path: string): ReplaceScope {
	return `project:${path}`;
}

/** Project path of a `project:<path>` scope, else null. */
export function scopeProjectPath(scope: ReplaceScope): string | null {
	return scope.startsWith("project:") ? scope.slice("project:".length) : null;
}

/** Whether one scanned location lies inside `scope`. */
export function locationInScope(location: ModelRefLocation, scope: ReplaceScope): boolean {
	if (scope === "all") return true;
	const projectScoped =
		(location.kind === "role" || location.kind === "agentOverride") && location.scope !== "global";
	if (scope === "global") return !projectScoped;
	return projectScoped && location.projectPath === scopeProjectPath(scope);
}

/** Whether fallback chains (never project-scoped) lie inside `scope`. */
export function chainsInScope(scope: ReplaceScope): boolean {
	return scope === "all" || scope === "global";
}

export interface ScopeOption {
	value: ReplaceScope;
	label: string;
	/** Full path for project options (tooltip). */
	title?: string;
}

/** 全部 / 全局 / every project that holds at least one model reference. */
export function scopeOptions(scan: ModelUsageScan | null): ScopeOption[] {
	const options: ScopeOption[] = [
		{ value: "all", label: tNow("modelReplace.scopeAll") },
		{ value: "global", label: tNow("modelReplace.scopeGlobalDetail") },
	];
	if (scan === null) return options;
	const names = projectNameMap(scan.projects);
	const seen = new Set<string>();
	for (const ref of scan.refs) {
		const location = ref.location;
		if (location.kind !== "role" && location.kind !== "agentOverride") continue;
		if (location.scope === "global" || location.projectPath === null || seen.has(location.projectPath)) continue;
		if (!listCandidates(ref.value).some((c) => isModelSelector(splitRoleValue(c).selector))) continue;
		seen.add(location.projectPath);
		options.push({
			value: projectScope(location.projectPath),
			label: tNow("modelReplace.scopeProjectLabel", { name: projectLabel(location.projectPath, names) }),
			title: location.projectPath,
		});
	}
	return options;
}

/** Display name of a scope (`全部`, `全局`, `项目：<name>`). */
export function scopeLabel(scope: ReplaceScope, names: Record<string, string>): string {
	if (scope === "all") return tNow("modelReplace.scopeAll");
	if (scope === "global") return tNow("modelReplace.scopeGlobal");
	const path = scopeProjectPath(scope) ?? "";
	return tNow("modelReplace.scopeProjectLabel", { name: names[path] ?? basename(path) });
}

// ── overview ─────────────────────────────────────────────────────────

/** One place a model is referenced. */
export interface OverviewSource {
	/** 全局 / project name / 回退链 / 应用设置 / 定时任务. */
	scope: string;
	/** What exactly references it (role, setting, schedule, chain key…). */
	title: string;
}

export interface OverviewRow {
	/** Selector with any thinking suffix stripped — the value that gets matched. */
	selector: string;
	/** Referenced candidates across every scanned location (comma-list items counted). */
	count: number;
	/** Observed thinking levels, in `THINKING_LEVELS` order. */
	levels: string[];
	/**
	 * Kind group from the kind catalogue: `missing` only when the catalogue is
	 * loaded and lacks the selector. While it is not loaded the group is `chat`
	 * and callers should not display it.
	 */
	group: KindGroup;
	/** Every distinct place the model is referenced. */
	sources: OverviewSource[];
}

/**
 * Every model currently referenced anywhere in the scan, grouped by selector:
 * stored values (comma-list items counted individually) plus fallback-chain keys
 * and items. Role names, `@role` aliases and globs are not models and are
 * skipped. `kindBySelector` is null until the kind catalogue has loaded (or when
 * it failed): no row is then grouped as missing.
 */
export function buildOverview(
	scan: ModelUsageScan | null,
	kindBySelector: ReadonlyMap<string, string> | null,
	scope: ReplaceScope = "all",
): OverviewRow[] {
	if (scan === null) return [];
	const names = projectNameMap(scan.projects);
	interface Acc {
		selector: string;
		count: number;
		levels: Set<string>;
		sources: Map<string, OverviewSource>;
	}
	const bySelector = new Map<string, Acc>();
	const add = (candidate: string, source: OverviewSource) => {
		const { selector, thinkingSuffix } = splitRoleValue(candidate.trim());
		if (!isModelSelector(selector)) return;
		const acc = bySelector.get(selector) ?? {
			selector,
			count: 0,
			levels: new Set<string>(),
			sources: new Map<string, OverviewSource>(),
		};
		acc.count += 1;
		if (thinkingSuffix) acc.levels.add(thinkingSuffix);
		acc.sources.set(`${source.scope}\u0000${source.title}`, source);
		bySelector.set(selector, acc);
	};

	for (const ref of scan.refs) {
		if (!locationInScope(ref.location, scope)) continue;
		const info = locationInfo(ref.location, names);
		const source = { scope: info.context, title: info.title };
		for (const candidate of listCandidates(ref.value)) add(candidate, source);
	}
	const chains = chainsInScope(scope) ? (scan.fallbackChains?.chains ?? {}) : {};
	for (const [key, items] of Object.entries(chains)) {
		add(key, { scope: tNow("modelReplace.groupTitle.chain"), title: tNow("modelReplace.chainKeyTitle", { key }) });
		for (const item of items) add(item, { scope: tNow("modelReplace.groupTitle.chain"), title: tNow("modelReplace.chainItemTitle", { key }) });
	}

	return [...bySelector.values()]
		.sort((a, b) => b.count - a.count || a.selector.localeCompare(b.selector))
		.map((acc) => ({
			selector: acc.selector,
			count: acc.count,
			levels: THINKING_LEVELS.filter((l) => acc.levels.has(l)),
			group: kindBySelector === null ? "chat" : kindGroup(kindBySelector.get(acc.selector)),
			sources: [...acc.sources.values()],
		}));
}

/** Lower-cased whitespace-separated search terms; empty when the query is blank. */
export function searchTerms(query: string): string[] {
	return query.toLowerCase().split(/\s+/).filter((t) => t !== "");
}

const sourceText = (source: OverviewSource): string => `${source.title} ${source.scope}`.toLowerCase();

/** Whether one location (「title · scope」) contains any search term. */
export function sourceMatches(source: OverviewSource, terms: readonly string[]): boolean {
	const text = sourceText(source);
	return terms.some((t) => text.includes(t));
}

/**
 * Rows whose model id (which carries the provider) and locations together contain every
 * term, case-insensitively. Row order and group membership are preserved, so the caller's
 * grouping keeps working; a blank query keeps everything.
 */
export function filterOverviewRows(rows: OverviewRow[], query: string): OverviewRow[] {
	const terms = searchTerms(query);
	if (terms.length === 0) return rows;
	return rows.filter((row) => {
		const haystack = `${row.selector.toLowerCase()} ${row.sources.map(sourceText).join(" ")}`;
		return terms.every((t) => haystack.includes(t));
	});
}

/** `text` cut into pieces, `match` true for the parts that contain a search term. */
export function highlightParts(text: string, terms: readonly string[]): { text: string; match: boolean }[] {
	if (terms.length === 0) return [{ text, match: false }];
	const lower = text.toLowerCase();
	const marked = new Array<boolean>(text.length).fill(false);
	for (const term of terms) {
		for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) {
			marked.fill(true, at, at + term.length);
		}
	}
	const parts: { text: string; match: boolean }[] = [];
	for (let i = 0; i < text.length; i++) {
		const last = parts[parts.length - 1];
		if (last && last.match === marked[i]) last.text += text[i];
		else parts.push({ text: text[i] ?? "", match: marked[i] ?? false });
	}
	return parts;
}

/**
 * Scope a recorded replacement actually touched, derived from its edits (history stores
 * the edits, whose locations carry the project paths): 全局, 项目：<name>, N 个项目, or both.
 */
export function editsScopeLabel(edits: readonly ModelReplaceEdit[], names: Record<string, string>): string {
	const projects = new Set<string>();
	let hasNonProject = false;
	for (const edit of edits) {
		const location = edit.kind === "value" ? edit.location : null;
		if (location && (location.kind === "role" || location.kind === "agentOverride") && location.scope !== "global" && location.projectPath) {
			projects.add(location.projectPath);
		} else {
			hasNonProject = true;
		}
	}
	const projectText =
		projects.size === 1 ? scopeLabel(projectScope([...projects][0] ?? ""), names) : tNow("modelReplace.projectCount", { count: String(projects.size) });
	if (projects.size === 0) return tNow("modelReplace.scopeGlobal");
	return hasNonProject ? tNow("modelReplace.globalPlusProjects", { projects: projectText }) : projectText;
}

// ── plan ─────────────────────────────────────────────────────────────

export interface RowOverride {
	model?: string;
	level?: string | null;
}

export interface PlanRow {
	id: string;
	group: PlanGroup;
	title: string;
	context: string;
	/** Stored value before, as shown in the preview. */
	before: string;
	after: string;
	checked: boolean;
	/** Chain rows that rename their key: the resulting key name. */
	renamedKey: string | null;
	/** Chain row whose renamed key already exists (default unchecked). */
	conflict: boolean;
	/** Duplicate/key-equal items were dropped. */
	deduped: boolean;
	/** Effective target of this row (its override, else the dialog's target). */
	model: string;
	level: string | null;
	/** The edit this row contributes; null while unchecked or when nothing changes. */
	edit: ModelReplaceEdit | null;
}

export interface SkippedProject {
	name: string;
	path: string;
	reason: string;
}

export interface Plan {
	rows: PlanRow[];
	groups: { group: PlanGroup; title: string; rows: PlanRow[] }[];
	/** Edits of every checked row, ready for `model_replace_apply`. */
	edits: ModelReplaceEdit[];
	skippedProjects: SkippedProject[];
	chainError: string | null;
}

export interface PlanInput {
	scan: ModelUsageScan;
	/** Source model; candidates referring to it are replaced. */
	fromModel: string;
	toModel: string;
	/** Dialog-level thinking level (null = 模型默认, no suffix). */
	level: string | null;
	/** Per-row target overrides, keyed by row id. */
	overrides?: Record<string, RowOverride>;
	/** Row checkboxes; absent = the row's default. */
	checked?: Record<string, boolean>;
	/** Only locations inside this scope are planned; default all. */
	scope?: ReplaceScope;
}

const chainItemsText = (items: string[] | null): string =>
	items === null ? tNow("modelReplace.chainNotExist") : items.length === 0 ? tNow("modelReplace.chainEmpty") : items.join(", ");

/** `selector:level` for display (a schedule's model column plus its thinking column). */
function withThinking(value: string, thinking: string | null): string {
	return thinking ? `${value}:${thinking}` : value;
}

/** Items kept in order: blanks, duplicates and items equal to the chain's own key dropped. */
function dedupeChainItems(items: string[], key: string): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const item of items) {
		const trimmed = item.trim();
		if (!trimmed || trimmed === key || seen.has(trimmed)) continue;
		seen.add(trimmed);
		out.push(trimmed);
	}
	return out;
}

/**
 * Build the preview: one row per affected value/chain, grouped by scope, with
 * the edits that apply would send. Nothing here writes anything.
 */
export function buildPlan({
	scan,
	fromModel,
	toModel,
	level,
	overrides = {},
	checked = {},
	scope = "all",
}: PlanInput): Plan {
	const names = projectNameMap(scan.projects);
	const rows: PlanRow[] = [];

	const targetOf = (id: string): { model: string; level: string | null } => {
		const override = overrides[id];
		return {
			model: override?.model?.trim() || toModel,
			level: override && override.level !== undefined ? override.level : level,
		};
	};

	for (const ref of scan.refs) {
		if (!locationInScope(ref.location, scope)) continue;
		const info = locationInfo(ref.location, names);
		const target = targetOf(info.id);
		const newValue = withLevel(target.model, target.level);
		if (ref.location.kind === "schedule") {
			if (!sameModel(ref.value, fromModel)) continue;
			const thinkingAfter = target.level ?? ref.thinking;
			rows.push({
				id: info.id,
				group: info.group,
				title: info.title,
				context: info.context,
				before: withThinking(ref.value, ref.thinking),
				after: withThinking(target.model, thinkingAfter),
				checked: checked[info.id] ?? true,
				renamedKey: null,
				conflict: false,
				deduped: false,
				model: target.model,
				level: target.level,
				edit: {
					kind: "value",
					location: ref.location,
					before: ref.value,
					after: target.model,
					thinkingBefore: ref.thinking,
					thinkingAfter,
				},
			});
			continue;
		}
		const after = replaceValue(ref.value, fromModel, newValue);
		if (after === null) continue;
		rows.push({
			id: info.id,
			group: info.group,
			title: info.title,
			context: info.context,
			before: ref.value,
			after,
			checked: checked[info.id] ?? true,
			renamedKey: null,
			conflict: false,
			deduped: false,
			model: target.model,
			level: target.level,
			edit: {
				kind: "value",
				location: ref.location,
				before: ref.value,
				after,
				thinkingBefore: null,
				thinkingAfter: null,
			},
		});
	}

	const chains = chainsInScope(scope) ? (scan.fallbackChains?.chains ?? {}) : {};
	for (const [key, rawItems] of Object.entries(chains)) {
		const items = rawItems.filter((i): i is string => typeof i === "string");
		const id = `chain:${key}`;
		const target = targetOf(id);
		const newValue = withLevel(target.model, target.level);
		const replaced = items.map((item) => (sameModel(item, fromModel) ? newValue : item));
		const itemsChanged = replaced.some((item, i) => item !== items[i]);
		// Chain keys are role ids, `provider/model` or `provider/*` — never `:level`, so a
		// renamed key is the bare target model; the level only applies to chain items.
		const newKey = target.model;
		const renames = sameModel(key, fromModel) && newKey !== key;

		if (renames) {
			const hasExisting = Object.prototype.hasOwnProperty.call(chains, newKey);
			const existing = hasExisting
				? (chains[newKey] ?? []).filter((i): i is string => typeof i === "string")
				: null;
			const combined = existing === null ? replaced : [...existing, ...replaced];
			const after = dedupeChainItems(combined, newKey);
			const changes: ChainChange[] = [
				{ key: newKey, before: existing, after },
				{ key, before: items, after: null },
			];
			const rowChecked = checked[id] ?? !hasExisting;
			rows.push({
				id,
				group: "chain",
				title: key,
				context: hasExisting ? tNow("modelReplace.chainKeyExists", { key: newKey }) : tNow("modelReplace.chainKeyNew", { key: newKey }),
				before: `${key}: ${chainItemsText(items)}`,
				after: `${newKey}: ${chainItemsText(after)}`,
				checked: rowChecked,
				renamedKey: newKey,
				conflict: hasExisting,
				deduped: after.length !== combined.length,
				model: target.model,
				level: target.level,
				edit: rowChecked ? { kind: "fallbackChain", label: key, changes } : null,
			});
			continue;
		}

		const after = dedupeChainItems(replaced, key);
		if (!itemsChanged && after.length === replaced.length) continue;
		const rowChecked = checked[id] ?? true;
		rows.push({
			id,
			group: "chain",
			title: key,
			context: tNow("modelReplace.chainItemContext"),
			before: chainItemsText(items),
			after: chainItemsText(after),
			checked: rowChecked,
			renamedKey: null,
			conflict: false,
			deduped: after.length !== replaced.length,
			model: target.model,
			level: target.level,
			edit: rowChecked ? { kind: "fallbackChain", label: key, changes: [{ key, before: items, after }] } : null,
		});
	}

	const selected: ModelReplaceEdit[] = [];
	for (const row of rows) {
		if (row.checked && row.edit) selected.push(row.edit);
	}
	return {
		rows,
		groups: GROUP_ORDER.map((group) => ({
			group,
			title: GROUP_TITLES[group],
			rows: rows.filter((r) => r.group === group),
		})).filter((g) => g.rows.length > 0),
		edits: selected,
		skippedProjects: scan.projects
			.filter((p) => p.status !== "ok")
			.map((p) => ({
				name: p.name || basename(p.path),
				path: p.path,
				// The backend explains its own failures (global config errors arrive here too).
				reason: p.error ?? (p.status === "missing" ? tNow("modelReplace.dirNotFound") : tNow("modelReplace.configReadFailed")),
			})),
		chainError: scan.fallbackChainsError,
	};
}

// ── results, retry, undo display ─────────────────────────────────────

/** Stable identity of one edit, used to merge retry results in place. */
export function editKey(edit: ModelReplaceEdit): string {
	if (edit.kind === "fallbackChain") {
		return `chain:${edit.label}:${edit.changes.map((c) => c.key).join("|")}`;
	}
	const location = edit.location;
	if (location.kind === "role" || location.kind === "agentOverride") {
		return `value:${location.kind}:${location.scope}:${location.projectPath ?? ""}:${location.name}`;
	}
	if (location.kind === "appSetting") return `value:appSetting:${location.field}`;
	return `value:schedule:${location.id}`;
}

/**
 * Fold a retry response into the previous results: retried edits replace their
 * earlier entry in place, items that were not retried keep their outcome.
 */
export function mergeResults(
	previous: ModelReplaceItemResult[],
	next: ModelReplaceItemResult[],
): ModelReplaceItemResult[] {
	const retried = new Map(next.map((r) => [editKey(r.edit), r]));
	const merged: ModelReplaceItemResult[] = [];
	const seen = new Set<string>();
	for (const result of previous) {
		const key = editKey(result.edit);
		seen.add(key);
		merged.push(retried.get(key) ?? result);
	}
	for (const result of next) {
		const key = editKey(result.edit);
		if (seen.has(key)) continue;
		seen.add(key);
		merged.push(result);
	}
	return merged;
}

/** The inverse of one edit — what undo restores. */
export function invertEdit(edit: ModelReplaceEdit): ModelReplaceEdit {
	if (edit.kind === "fallbackChain") {
		return {
			kind: "fallbackChain",
			label: edit.label,
			changes: edit.changes.map((c) => ({ key: c.key, before: c.after, after: c.before })),
		};
	}
	return {
		kind: "value",
		location: edit.location,
		before: edit.after,
		after: edit.before,
		thinkingBefore: edit.thinkingAfter,
		thinkingAfter: edit.thinkingBefore,
	};
}

export interface EditSummary {
	title: string;
	context: string;
	before: string;
	after: string;
	/** Chain rows: one line per key change. */
	details: string[];
}

/** Display form of one edit (value rows and chain rows). */
export function summarizeEdit(
	edit: ModelReplaceEdit,
	names: Record<string, string> = {},
): EditSummary {
	if (edit.kind === "fallbackChain") {
		return {
			title: edit.label,
			context: tNow("modelReplace.groupTitle.chain"),
			before: chainItemsText(edit.changes[0]?.before ?? null),
			after: chainItemsText(edit.changes[0]?.after ?? null),
			details: edit.changes.map((c) => `${c.key}: ${chainItemsText(c.before)} → ${chainItemsText(c.after)}`),
		};
	}
	const info = locationInfo(edit.location, names);
	// A schedule stores the model and the thinking level in two columns, so its
	// before/after render as the pair the row will actually hold (the level line
	// below spells the thinking column out).
	const isSchedule = edit.location.kind === "schedule";
	return {
		title: info.title,
		context: info.context,
		before: isSchedule ? withThinking(edit.before, edit.thinkingBefore) : edit.before,
		after: isSchedule ? withThinking(edit.after, edit.thinkingAfter) : edit.after,
		details: isSchedule
			? [tNow("modelReplace.thinkingLevelChange", { before: edit.thinkingBefore ?? tNow("modelReplace.notSet"), after: edit.thinkingAfter ?? tNow("modelReplace.notSet") })]
			: [],
	};
}

// ── live sessions ────────────────────────────────────────────────────

export interface LiveModelEntry {
	sessionId: string;
	title: string;
	cwd: string | null;
	modelState: unknown;
}

export interface LiveOnModel {
	sessionId: string;
	title: string;
	cwd: string | null;
	/** Resolved catalogue key of the session's current model. */
	value: string;
}

/** Alive sessions whose resolved current model is `target` — the candidates the results page offers to switch. */
export function liveSessionsOnModel(
	entries: LiveModelEntry[],
	models: ModelOption[] | null,
	target: string,
): LiveOnModel[] {
	if (!target) return [];
	const out: LiveOnModel[] = [];
	for (const entry of entries) {
		const value = resolveCurrentModel(entry.modelState, models).value;
		if (!value || !sameModel(value, target)) continue;
		out.push({ sessionId: entry.sessionId, title: entry.title, cwd: entry.cwd, value });
	}
	return out;
}
