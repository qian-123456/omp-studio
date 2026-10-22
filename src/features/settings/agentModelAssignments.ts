/**
 * [D] Pure helpers behind Settings ▸ 模型角色 (single 角色分配 table).
 *
 * Agent resolution is decided by the backend snapshot (`omp_model_roles_read`).
 * These helpers only shape rows for display, check typed values, and follow
 * role references through the layers the way `settings_model_roles.rs` does
 * (`split_candidates`, `alias_target`, `resolve_candidates`, `resolve_role`), so
 * a note in the UI never disagrees with the model the backend resolves.
 */
import type { AgentModelAssignment } from "../../lib/contracts";
import { BUILTIN_ROLES, splitRoleValue } from "./modelRoles";

export type AssignmentScope = "global" | "project";
export type AssignmentTable = "modelRoles" | "agentModelOverrides";

/** Role layers in precedence order: project first, then global. The first layer holding a key wins. */
export type RoleLayers = readonly Record<string, string>[];

/** Built-in role ids (omp MODEL_ROLES). An unset built-in is not an error: resolution moves on. */
const BUILTIN_ROLE_IDS: ReadonlySet<string> = new Set(BUILTIN_ROLES.map((r) => r.id));
/** Limits and character sets mirror backend `validate_value` / `validate_name`; `is_alphanumeric` is \p{Alphabetic} or \p{N}. */
const MAX_VALUE_CHARS = 256;
const MAX_NAME_CHARS = 128;
const VALUE_CHARS_RE = /^[\p{Alphabetic}\p{N}\-_.\/:+@]+$/u;
const NAME_CHARS_RE = /^[\p{Alphabetic}\p{N}\-_.]+$/u;
/** Model part of a literal selector: backend `validate_value` allows alphanumerics and - _ . / : +. */
const MODEL_CHARS_RE = /^[\p{Alphabetic}\p{N}\-_.\/:+]+$/u;

/** Trimmed value of an own key of one layer, or null when the layer does not set it. */
function own(layer: Record<string, string>, key: string): string | null {
	return Object.prototype.hasOwnProperty.call(layer, key) ? layer[key].trim() : null;
}

/** Raw value of a key from the first layer that holds it; null when no layer does. */
function lookup(layers: RoleLayers, key: string): string | null {
	for (const layer of layers) {
		if (Object.prototype.hasOwnProperty.call(layer, key)) return layer[key];
	}
	return null;
}

function hasKey(layers: RoleLayers, key: string): boolean {
	return layers.some((layer) => Object.prototype.hasOwnProperty.call(layer, key));
}

/** Candidates of a value (backend `split_candidates`): comma-separated, trimmed, empties dropped. */
function splitCandidates(value: string): string[] {
	return value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s !== "");
}

/** `name[:level]`, split at the first colon (backend `split_level`). */
function splitLevel(ref: string): { name: string; level: string | null } {
	const i = ref.indexOf(":");
	return i < 0 ? { name: ref, level: null } : { name: ref.slice(0, i), level: ref.slice(i + 1) };
}

interface RoleRef {
	name: string;
	level: string | null;
}

/**
 * The role one candidate refers to, or null for a literal model. Mirrors backend
 * `alias_target`: `@role[:level]`; legacy `pi/role[:level]` only when the role is
 * known (built-in or configured); `*` and `*:level` name the default role.
 */
function roleRefOf(candidate: string, layers: RoleLayers): RoleRef | null {
	if (candidate.startsWith("@")) return splitLevel(candidate.slice(1));
	if (candidate.startsWith("pi/")) {
		const ref = splitLevel(candidate.slice("pi/".length));
		return BUILTIN_ROLE_IDS.has(ref.name) || hasKey(layers, ref.name) ? ref : null;
	}
	if (candidate === "*") return { name: "default", level: null };
	if (candidate.startsWith("*:")) return { name: "default", level: candidate.slice(2) };
	return null;
}

/**
 * Outcome of resolving a role or a value. `unset` is a built-in with nothing
 * configured (the chain moves on); `unresolved` is an unknown name or a cycle.
 */
export type Resolution =
	| { status: "model"; selector: string }
	| { status: "unset" }
	| { status: "unresolved"; reason: string };

/** Backend `resolve_selector`: a literal model, or the role an alias names. */
function resolveSelector(selector: string, layers: RoleLayers, trail: string[]): Resolution {
	const ref = roleRefOf(selector, layers);
	return ref === null ? { status: "model", selector } : resolveRole(ref.name, ref.level, layers, trail);
}

/**
 * Backend `resolve_candidates`: the first candidate that is not unset decides.
 * Unset candidates move on; unknown aliases and cycles are reported, never skipped.
 */
function resolveCandidates(value: string, layers: RoleLayers, trail: string[]): Resolution {
	let result: Resolution = { status: "unset" };
	for (const candidate of splitCandidates(value)) {
		const r = resolveSelector(candidate, layers, trail);
		if (r.status !== "unset") return r;
		result = r;
	}
	return result;
}

/**
 * Backend `resolve_role`: a configured value resolves through its candidates, an
 * unset built-in moves on, and any other unknown name is unresolved. A `:level` on
 * the reference is appended to the model that resolves.
 */
function resolveRole(name: string, level: string | null, layers: RoleLayers, trail: string[]): Resolution {
	if (trail.includes(name)) {
		return { status: "unresolved", reason: `循环引用：${[...trail, name].map((n) => `@${n}`).join(" → ")}` };
	}
	const value = lookup(layers, name);
	trail.push(name);
	let outcome: Resolution;
	if (value !== null) outcome = resolveCandidates(value, layers, trail);
	else if (BUILTIN_ROLE_IDS.has(name)) outcome = { status: "unset" };
	else outcome = { status: "unresolved", reason: `未知角色 @${name}（未配置）` };
	trail.pop();
	if (outcome.status === "model" && level !== null) {
		return { status: "model", selector: `${outcome.selector}:${level}` };
	}
	return outcome;
}

/** Resolve one role name through the layers (project first, then global). */
export function resolveRoleValue(name: string, layers: RoleLayers): Resolution {
	return resolveRole(name, null, layers, []);
}

export interface ValueNote {
	tone: "ok" | "muted" | "error";
	text: string;
}

/**
 * Explain a value that refers to other roles: the model it reaches, the
 * fall-through of an unset built-in, or the reason it cannot resolve. Plain
 * selectors and empty values need no note.
 */
export function describeAliasValue(value: string | null, layers: RoleLayers): ValueNote | null {
	if (value === null || !splitCandidates(value).some((c) => roleRefOf(c, layers) !== null)) return null;
	const r = resolveCandidates(value, layers, []);
	if (r.status === "model") return { tone: "ok", text: `→ ${r.selector}` };
	if (r.status === "unset") {
		return { tone: "muted", text: "未配置：所引角色尚未设置，解析时跳过，回退到 modelRoles.task → 会话模型" };
	}
	return { tone: "error", text: `无法解析：${r.reason}` };
}

/** Names of the roles a declared or stored value refers to, candidates expanded, in order and without repeats. */
export function referencedRoles(value: string | null | undefined, layers: RoleLayers): string[] {
	const names: string[] = [];
	for (const candidate of splitCandidates(value ?? "")) {
		const ref = roleRefOf(candidate, layers);
		if (ref !== null && !names.includes(ref.name)) names.push(ref.name);
	}
	return names;
}

/**
 * Who calls each role, from the rows of one scope: an agent whose applying value (named
 * override, else its definition's `model:`) refers to the role, another role whose value
 * refers to it, or the model switcher's `cycleOrder`. Direct references only; a role is
 * never listed as its own user.
 */
export function roleUsers(rows: readonly AssignmentRow[], layers: RoleLayers, cycleOrder: readonly string[]): Map<string, string[]> {
	const users = new Map<string, string[]>();
	const add = (role: string, user: string) => {
		const list = users.get(role) ?? [];
		if (!list.includes(user)) list.push(user);
		users.set(role, list);
	};
	for (const row of rows) {
		if (row.kind === "agent") {
			const applying = row.steps.find((s) => (s.level === 1 || s.level === 2) && s.value !== null)?.value ?? null;
			for (const role of referencedRoles(applying, layers)) add(role, `子代理 ${row.name}`);
		} else {
			for (const role of referencedRoles(row.projectValue ?? row.globalValue, layers)) {
				if (role !== row.name) add(role, `角色 ${row.name}`);
			}
		}
	}
	for (const role of cycleOrder) add(role, "模型切换轮换（cycleOrder）");
	return users;
}

export type ValueCheck = { ok: true; value: string } | { ok: false; error: string };

/**
 * Check a typed value before it is sent to the backend: `provider/model[:level]` or
 * `@role[:level]`. Mirrors `validate_value`: each part uses the backend's character class
 * and split point. A reference's role must pass `checkName`; a level must be non-empty.
 * Every role accepts a `:level` suffix.
 */
export function checkAssignmentValue(raw: string): ValueCheck {
	const value = raw.trim();
	if (!value) return { ok: false, error: "值不能为空；要清除请使用「删除」" };
	if (/\s/.test(value)) return { ok: false, error: "值中不能包含空格" };
	if (Array.from(value).length > MAX_VALUE_CHARS) {
		return { ok: false, error: `值不能超过 ${MAX_VALUE_CHARS} 字符` };
	}
	if (!VALUE_CHARS_RE.test(value) || (value.includes("@") && !value.startsWith("@"))) {
		return { ok: false, error: "值只允许字母、数字与 - _ . / : + @，且 @ 只能作为角色引用的开头" };
	}
	if (value.startsWith("@")) {
		// Same split as the backend: the role is everything before the first colon, and an
		// optional level after that colon must be a non-empty token (backend `valid_level`).
		const { name, level } = splitLevel(value.slice(1));
		if (name === "") return { ok: false, error: "角色引用 @ 之后需要角色名" };
		const role = checkName(name);
		if (!role.ok) return { ok: false, error: role.error };
		if (level !== null && !NAME_CHARS_RE.test(level)) {
			return { ok: false, error: "层级只允许字母、数字与 - _ .，且不能为空" };
		}
	} else {
		// Literal `provider/model[:level]`: split at the first slash, as backend `validate_value` does.
		const slash = value.indexOf("/");
		if (slash < 0) return { ok: false, error: "模型值需写作 provider/模型[:思考级别]，或 @角色" };
		if (!NAME_CHARS_RE.test(value.slice(0, slash))) {
			return { ok: false, error: "provider 只允许字母、数字与 - _ .，且不能为空" };
		}
		if (!MODEL_CHARS_RE.test(value.slice(slash + 1))) {
			return { ok: false, error: "模型名只允许字母、数字与 - _ . / : +，且不能为空" };
		}
	}
	return { ok: true, value };
}

/** Check a new role or agent name. Mirrors `validate_name`. */
export function checkName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
	const name = raw.trim();
	const valid = name !== "" && Array.from(name).length <= MAX_NAME_CHARS && NAME_CHARS_RE.test(name);
	return valid ? { ok: true, name } : { ok: false, error: "名称只允许字母、数字与 - _ .，且不超过 128 字符" };
}

/** Case-insensitive substring match over any of the fields; an empty query matches everything. */
export function matchesQuery(query: string, fields: readonly (string | null | undefined)[]): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;
	return fields.some((f) => typeof f === "string" && f.toLowerCase().includes(q));
}

export type PriorityLevel = 1 | 2 | 3 | 4;

export interface PriorityStep {
	level: PriorityLevel;
	/** Field shown to users, e.g. "task.agentModelOverrides.scout", "scout 定义里的 model:", "modelRoles.task", "当前会话模型". */
	field: string;
	/** Raw stored value at this level; null = not set. Level 1 in project scope: the value that applies (global first). */
	value: string | null;
	/** Layer the value came from (levels 1 and 3); null otherwise. */
	layer: "global" | "project" | null;
	/** Model the value reaches after alias resolution; null when unset/unresolved. */
	model: string | null;
	/** Non-null when the value cannot resolve (unknown role or cycle) — resolution stops here. */
	error: string | null;
}

export interface AssignmentRow {
	kind: "role" | "agent";
	/** Section for ordering: chat roles, custom roles, agents, service (modelKind) roles. */
	group: "chat" | "custom" | "agent" | "service";
	name: string;
	/** Chinese label/description for built-in roles; null otherwise. */
	label: string | null;
	// role rows (kind "role"): modelRoles values per layer; project* are null in global scope.
	globalValue: string | null;
	projectValue: string | null;
	// agent rows (kind "agent"): null/false for role rows.
	agentSource: "builtin" | "user" | "project" | null;
	declared: string | null;
	globalOverride: string | null;
	projectOverride: string | null;
	/** Project override exists but a global override wins. */
	projectShadowed: boolean;
	/** Agent rows: 4 steps in priority order. Role rows: []. */
	steps: PriorityStep[];
	/** Final result shown in the collapsed row. */
	effective: {
		/** null when unresolved / nothing. */
		model: string | null;
		/** Agent rows: winning level; role rows: null. */
		level: PriorityLevel | null;
		/** The "@role" that produced the model, if any. */
		via: string | null;
		/** Project scope, role row: value comes from global. */
		inherited: boolean;
		error: string | null;
	};
	/** Thinking level of the effective value (e.g. "high"), or null. */
	thinking: string | null;
}

interface LayerSet {
	modelRoles: Record<string, string>;
	agentModelOverrides: Record<string, string>;
}

/** The `@role` the first non-unset candidate of a value goes through, or null for a literal model. */
function viaOf(value: string, layers: RoleLayers): string | null {
	for (const candidate of splitCandidates(value)) {
		if (resolveSelector(candidate, layers, []).status === "unset") continue;
		const ref = roleRefOf(candidate, layers);
		return ref === null ? null : `@${ref.name}`;
	}
	return null;
}

interface Resolved {
	model: string | null;
	error: string | null;
	via: string | null;
}

function resolveValue(value: string | null, layers: RoleLayers): Resolved {
	if (value === null) return { model: null, error: null, via: null };
	const r = resolveCandidates(value, layers, []);
	if (r.status === "model") return { model: r.selector, error: null, via: viaOf(value, layers) };
	if (r.status === "unresolved") return { model: null, error: r.reason, via: null };
	return { model: null, error: null, via: null };
}

function thinkingOf(model: string | null): string | null {
	return model === null ? null : splitRoleValue(model).thinkingSuffix;
}

const EMPTY_ROLE_FIELDS = {
	agentSource: null,
	declared: null,
	globalOverride: null,
	projectOverride: null,
	projectShadowed: false,
	steps: [] as PriorityStep[],
};

/**
 * Rows of the single 角色分配 table: chat roles, custom roles, discovered agents,
 * then service roles. Agent rows carry the 4-level priority chain
 * (override → definition `model:` → `modelRoles.task` → session model).
 */
export function buildAssignmentRows(input: {
	global: LayerSet;
	project: LayerSet | null;
	agents: AgentModelAssignment[];
	sessionModel: string | null;
}): AssignmentRow[] {
	const { global, project } = input;
	const layers: RoleLayers = project ? [project.modelRoles, global.modelRoles] : [global.modelRoles];
	const sessionModel = input.sessionModel?.trim() ? input.sessionModel.trim() : null;

	const roleRow = (name: string, group: AssignmentRow["group"], label: string | null): AssignmentRow => {
		const globalValue = own(global.modelRoles, name);
		const projectValue = project ? own(project.modelRoles, name) : null;
		const r = resolveRoleValue(name, layers);
		const model = r.status === "model" ? r.selector : null;
		const merged = projectValue ?? globalValue;
		return {
			kind: "role",
			group,
			name,
			label,
			globalValue,
			projectValue,
			...EMPTY_ROLE_FIELDS,
			effective: {
				model,
				level: null,
				via: model !== null && merged !== null ? viaOf(merged, layers) : null,
				inherited: project !== null && projectValue === null && globalValue !== null,
				error: r.status === "unresolved" ? r.reason : null,
			},
			thinking: thinkingOf(model),
		};
	};

	const agentRow = (a: AgentModelAssignment): AssignmentRow => {
		const name = a.name;
		const globalOverride = own(global.agentModelOverrides, name);
		const projectOverride = project ? own(project.agentModelOverrides, name) : null;
		const overrideValue = globalOverride ?? projectOverride;
		const declared = a.declaredModel?.trim() ? a.declaredModel.trim() : null;
		const projectTask = project ? own(project.modelRoles, "task") : null;
		const taskValue = projectTask ?? own(global.modelRoles, "task");
		const taskLayer: "global" | "project" | null =
			projectTask !== null ? "project" : taskValue !== null ? "global" : null;

		const raw: { step: PriorityStep; via: string | null }[] = [];
		const push = (
			level: PriorityLevel,
			field: string,
			value: string | null,
			layer: PriorityStep["layer"],
		) => {
			const r = resolveValue(value, layers);
			raw.push({ step: { level, field, value, layer, model: r.model, error: r.error }, via: r.via });
		};
		push(
			1,
			`task.agentModelOverrides.${name}`,
			overrideValue,
			overrideValue === null ? null : globalOverride !== null ? "global" : "project",
		);
		push(2, `${name} 定义里的 model:`, declared, null);
		push(3, "modelRoles.task", taskValue, taskLayer);
		raw.push({
			step: { level: 4, field: "当前会话模型", value: sessionModel, layer: null, model: sessionModel, error: null },
			via: null,
		});

		const winner = raw.find((x) => x.step.model !== null || x.step.error !== null) ?? raw[3];
		const model = winner.step.model;
		return {
			kind: "agent",
			group: "agent",
			name,
			label: null,
			globalValue: null,
			projectValue: null,
			agentSource: a.source,
			declared,
			globalOverride,
			projectOverride,
			projectShadowed: globalOverride !== null && projectOverride !== null,
			steps: raw.map((x) => x.step),
			effective: {
				model,
				level: winner.step.level,
				via: winner.via,
				inherited: false,
				error: winner.step.error,
			},
			thinking: thinkingOf(model),
		};
	};

	const chat = BUILTIN_ROLES.filter((r) => r.kind === "chat");
	const service = BUILTIN_ROLES.filter((r) => r.kind === "modelKind");
	const custom = [...new Set([...Object.keys(global.modelRoles), ...Object.keys(project?.modelRoles ?? {})])]
		.filter((k) => !BUILTIN_ROLE_IDS.has(k))
		.sort();
	const roleNames = new Set<string>([...BUILTIN_ROLE_IDS, ...custom]);
	const agents = input.agents.filter(
		(a) =>
			!roleNames.has(a.name) ||
			own(global.agentModelOverrides, a.name) !== null ||
			(project !== null && own(project.agentModelOverrides, a.name) !== null),
	);

	return [
		...chat.map((r) => roleRow(r.id, "chat", r.zhLabel)),
		...custom.map((name) => roleRow(name, "custom", null)),
		...agents.map(agentRow),
		...service.map((r) => roleRow(r.id, "service", r.zhLabel)),
	];
}

/** The @role chosen by "复用角色模型" when nothing is overridden: the agent's declared role, else "@task". */
export function agentFallbackRole(row: AssignmentRow): string {
	for (const candidate of splitCandidates(row.declared ?? "")) {
		if (candidate.startsWith("@")) return `@${splitLevel(candidate.slice(1)).name}`;
	}
	return "@task";
}
