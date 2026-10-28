/**
 * Pure rules behind the composer's model chip while plan mode is on: which model the
 * `plan` role names, which config layer an edit is written to, and the saved value.
 */
import { parseSelection, resolveRole } from "../../../components/modelSelectLogic";
import type { ModelRoleSnapshot } from "../../../lib/contracts";
import { type ModelOption, toModelKey } from "../../../lib/models";

export const PLAN_ROLE = "plan";

export interface PlanChoice {
	/** Raw role spec this choice came from (`provider/id[:level]` or `@role[:level]`). */
	spec: string;
	/** Spec without the thinking suffix; kept so a level edit does not flatten an `@role`. */
	selector: string;
	/** Concrete `provider/id` key. */
	key: string;
	/** Concrete thinking level, or null when the spec follows the model's own (none / auto / inherit). */
	level: string | null;
}

/** A level the session can be set to: not empty, `auto` or `inherit`. */
export function concreteLevel(level: string | null | undefined): string | null {
	const l = (level ?? "").trim();
	return !l || l === "auto" || l === "inherit" ? null : l;
}

/** Global layer overlaid by the project layer, per key (the project wins). */
export function effectiveRoles(snapshot: ModelRoleSnapshot | null): Record<string, unknown> {
	if (!snapshot) return {};
	return { ...snapshot.global.modelRoles, ...(snapshot.project?.modelRoles ?? {}) };
}

function nonEmpty(v: unknown): string | null {
	return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Model the chip shows in plan mode. Precedence: this visit's picker edit, then the
 * status frame's `planModel`, then the effective `modelRoles.plan`. Null when none of
 * them resolves to a model (the chip then keeps the session's model).
 */
export function resolvePlanChoice(input: {
	edit: string | null;
	statusSpec: string | null | undefined;
	roles: Record<string, unknown>;
	models: ModelOption[] | null;
}): PlanChoice | null {
	const spec = nonEmpty(input.edit) ?? nonEmpty(input.statusSpec) ?? nonEmpty(input.roles[PLAN_ROLE]);
	if (!spec) return null;
	const r = resolveRole({ ...input.roles, [PLAN_ROLE]: spec }, PLAN_ROLE, input.models);
	if (r.kind !== "model") return null;
	const key = r.selector.includes("/")
		? r.selector
		: r.model
			? toModelKey(r.model.provider, r.model.id)
			: null;
	if (!key) return null;
	return { spec, selector: parseSelection(spec).selector, key, level: concreteLevel(r.level) };
}

/**
 * Layer an edit of the `plan` role is written to: the project layer only when it already
 * pins its own `plan` (otherwise that pin would keep shadowing the edit), else global.
 */
export function planRoleScope(snapshot: ModelRoleSnapshot | null): "global" | "project" {
	const own = snapshot?.project?.modelRoles;
	return own && nonEmpty(own[PLAN_ROLE]) ? "project" : "global";
}

/** Value stored for the role: `selector`, plus `:level` only for a concrete level. */
export function savedPlanValue(selector: string, level: string | null | undefined): string {
	const sel = selector.trim();
	const l = concreteLevel(level);
	return l ? `${sel}:${l}` : sel;
}
