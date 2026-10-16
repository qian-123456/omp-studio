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
	ModelRefLocation,
	ModelReplaceEdit,
	ModelReplaceItemResult,
	ModelUsageScan,
	ScannedProject,
} from "../../../lib/contracts";
import type { ModelOption } from "../../../lib/models";
import { resolveCurrentModel } from "../../../lib/models";
import { basename } from "../../../lib/paths";
import { BUILTIN_ROLES, splitRoleValue, THINKING_SUFFIXES } from "../modelRoles";

// ── selectors, comma lists, levels ───────────────────────────────────

/** Selector of a stored candidate, i.e. `:<level>` stripped when the level is known. */
export function selectorOf(value: string): string {
	return splitRoleValue(value).selector;
}

/** True when a stored candidate refers to exactly `model` (suffix insensitive, provider sensitive). */
export function sameModel(candidate: string, model: string): boolean {
	const target = selectorOf(model);
	return target !== "" && selectorOf(candidate) === target;
}

/** The value a replacement writes: `model` plus `:<level>` when a level is chosen. */
export function withLevel(model: string, level: string | null | undefined): string {
	return level ? `${model}:${level}` : model;
}

/** Thinking levels the pickers offer (the suffixes `splitRoleValue` recognizes). */
export const THINKING_LEVELS: readonly string[] = THINKING_SUFFIXES;

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

export const GROUP_TITLES: Record<PlanGroup, string> = {
	global: "全局",
	project: "每个项目",
	chain: "回退链",
	appSetting: "应用设置",
	schedule: "定时任务",
};

const APP_SETTING_LABELS: Record<string, string> = {
	newSessionModel: "新会话默认模型",
	sideChatModel: "侧边对话专用模型",
	doctorModel: "医生模型",
};

export function appSettingLabel(field: string): string {
	return APP_SETTING_LABELS[field] ?? field;
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
	path === null ? "项目" : (names[path] ?? basename(path));

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
			title: location.kind === "role" ? roleTitle(location.name) : `子代理 ${location.name}`,
			context: location.scope === "global" ? "全局" : projectLabel(location.projectPath, names),
		};
	}
	if (location.kind === "appSetting") {
		return {
			id: `appSetting:${location.field}`,
			group: "appSetting",
			title: appSettingLabel(location.field),
			context: "应用设置",
		};
	}
	return {
		id: `schedule:${location.id}`,
		group: "schedule",
		title: location.name || location.id,
		context: "定时任务",
	};
}

/** One-line origin of a reference, used by the overview's source list. */
function sourceLabel(location: ModelRefLocation, names: Record<string, string>): string {
	const info = locationInfo(location, names);
	return info.context === "全局" || info.context === "应用设置"
		? `${info.title}（${info.context}）`
		: `${info.title} · ${info.context}`;
}

// ── overview ─────────────────────────────────────────────────────────

export interface OverviewRow {
	/** Selector with any thinking suffix stripped — the value that gets matched. */
	selector: string;
	/** Referenced candidates across every scanned location (comma-list items counted). */
	count: number;
	/** Observed thinking levels, in `THINKING_LEVELS` order. */
	levels: string[];
	inCatalog: boolean;
	/**
	 * The selector is used as a model somewhere (a stored value or a chain item).
	 * Chain keys are listed too, but a key is usually a role name — it must not
	 * be reported as a missing model.
	 */
	referencedAsModel: boolean;
	/** Up to three origins. */
	sources: string[];
	extraSources: number;
}

/**
 * Every model currently referenced anywhere in the scan, grouped by selector:
 * stored values (comma-list items counted individually) plus fallback-chain keys
 * and items. `@role` aliases are not models and are skipped.
 */
export function buildOverview(
	scan: ModelUsageScan | null,
	catalogKeys: ReadonlySet<string>,
): OverviewRow[] {
	if (scan === null) return [];
	const names = projectNameMap(scan.projects);
	interface Acc {
		selector: string;
		count: number;
		levels: Set<string>;
		referencedAsModel: boolean;
		sources: Set<string>;
	}
	const bySelector = new Map<string, Acc>();
	const add = (candidate: string, source: string, asModel: boolean) => {
		const trimmed = candidate.trim();
		if (!trimmed || trimmed.startsWith("@")) return;
		const { selector, thinkingSuffix } = splitRoleValue(trimmed);
		if (!selector) return;
		const acc = bySelector.get(selector) ?? {
			selector,
			count: 0,
			levels: new Set<string>(),
			referencedAsModel: false,
			sources: new Set<string>(),
		};
		acc.count += 1;
		acc.referencedAsModel ||= asModel;
		if (thinkingSuffix) acc.levels.add(thinkingSuffix);
		if (acc.sources.size < 4) acc.sources.add(source);
		bySelector.set(selector, acc);
	};

	for (const ref of scan.refs) {
		const source = sourceLabel(ref.location, names);
		for (const candidate of listCandidates(ref.value)) add(candidate, source, true);
	}
	const chains = scan.fallbackChains?.chains ?? {};
	for (const [key, items] of Object.entries(chains)) {
		add(key, `回退链键 ${key}`, false);
		for (const item of items) add(item, `回退链 ${key}`, true);
	}

	return [...bySelector.values()]
		.sort((a, b) => b.count - a.count || a.selector.localeCompare(b.selector))
		.map((acc) => {
			const sources = [...acc.sources];
			return {
				selector: acc.selector,
				count: acc.count,
				levels: THINKING_LEVELS.filter((l) => acc.levels.has(l)),
				inCatalog: catalogKeys.has(acc.selector),
				referencedAsModel: acc.referencedAsModel,
				sources: sources.slice(0, 3),
				extraSources: Math.max(0, sources.length - 3),
			};
		});
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
}

const chainItemsText = (items: string[] | null): string =>
	items === null ? "（不存在）" : items.length === 0 ? "（空）" : items.join(", ");

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

	const chains = scan.fallbackChains?.chains ?? {};
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
				context: hasExisting ? `回退链键 → ${newKey}（已存在）` : `回退链键 → ${newKey}`,
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
			context: "回退链条目",
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
				reason: p.error ?? (p.status === "missing" ? "目录不存在" : "配置无法读取"),
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
			context: "回退链",
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
			? [`思考等级: ${edit.thinkingBefore ?? "未设置"} → ${edit.thinkingAfter ?? "未设置"}`]
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
