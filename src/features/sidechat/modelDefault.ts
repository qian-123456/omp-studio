/**
 * Pure resolution of the model used for a new side chat fork.
 *
 * Priority:
 *  1. An explicit pick in the side-chat composer picker (per-panel override).
 *  2. The `sideChatModel` setting (侧聊专属模型), when its selector is usable —
 *     a known role (smol/default/slow) or, once the catalog has loaded, a
 *     catalog key. A stale/unavailable selector falls back to inheriting the
 *     parent session's model, silently (no error).
 *  3. Inherit the parent session's model (no `--model` passed to the fork).
 */
import {
	composeSelection,
	parseSelection,
	RESOLVABLE_ROLES,
	roleIdOf,
} from "../../components/modelSelectLogic";
import { type ModelOption, toModelKey } from "../../lib/models";
import { useModelCatalog } from "../../stores/modelCatalog";
import { useSettings } from "../settings/store";

export type SideChatModelSource = "picker" | "setting" | "parent";

export interface SideChatModelPick {
	/** Bare `provider/id` (or role) selector; "" when inheriting the parent. */
	selector: string;
	/** Thinking level carried by the dedicated setting, if any. */
	level: string | null;
	source: SideChatModelSource;
}

/** True when `selector` can be handed to `omp --model`. */
export function sideChatSelectorUsable(
	selector: string,
	catalog: readonly ModelOption[] | null,
): boolean {
	if (!selector) return false;
	if (roleIdOf(selector)) return true;
	// Catalog not loaded yet → assume usable rather than silently dropping it.
	if (!catalog) return true;
	return catalog.some((m) => toModelKey(m.provider, m.id) === selector);
}

export function resolveSideChatModel(
	picked: string,
	setting: string | null | undefined,
	catalog: readonly ModelOption[] | null,
): SideChatModelPick {
	const pickSel = parseSelection(picked).selector;
	if (pickSel) return { selector: pickSel, level: null, source: "picker" };
	const dedicated = parseSelection(setting);
	if (dedicated.selector && sideChatSelectorUsable(dedicated.selector, catalog)) {
		return { ...dedicated, source: "setting" };
	}
	return { selector: "", level: null, source: "parent" };
}

/** Label for the dedicated option, e.g. "claude-sonnet-4-5 · high". */
export function sideChatModelLabel(
	value: string | null | undefined,
	catalog: readonly ModelOption[] | null,
): string {
	const { selector, level } = parseSelection(value);
	if (!selector) return "";
	const role = roleIdOf(selector);
	const model = catalog?.find((m) => toModelKey(m.provider, m.id) === selector);
	const base = role ? RESOLVABLE_ROLES[role] : (model?.id ?? selector);
	return level ? `${base} · ${level}` : base;
}

/**
 * `--model` arg for a side chat fork when the caller offers no picker of its
 * own: the dedicated setting verbatim when usable, else null (inherit parent).
 * Reads the settings + catalog stores directly.
 */
export function sideChatDefaultModelArg(): string | null {
	const setting = useSettings.getState().settings?.sideChatModel;
	const catalog = useModelCatalog.getState().models;
	const resolved = resolveSideChatModel("", setting, catalog);
	return resolved.selector ? composeSelection(resolved.selector, resolved.level) : null;
}
