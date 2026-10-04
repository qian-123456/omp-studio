import type { Model, ModelEntry, ModelSpec, ProviderConfig } from "../../lib/contracts";
import { confirmDialog } from "../../lib/dialogs";
import { listModels } from "../../lib/ipc";
import {
	catalogWindowFor,
	loadRules,
	pickRule,
	resolveNewModelWindow,
	type ContextWindowRule,
} from "../settings/contextWindow/core";
import { formatTokens, modelEntryId, modelEntrySpec } from "./modelEntry";

/** A new model that already has an explicit window differing from its matching rule. */
export interface RuleConflict {
	modelId: string;
	current: number;
	ruleValue: number;
}

export interface WindowPlan {
	/** Windows to write for models that currently have none. */
	fills: Map<string, number>;
	/** Rule overrides that need user confirmation (D9). */
	conflicts: RuleConflict[];
}

/**
 * D8(b)/D15: only models newly added in `after` (vs `before`) or lacking an explicit
 * window are considered. Unset models get the D15-resolved value; existing explicit
 * values on new models are only replaced by a differing rule after confirmation.
 */
export function planContextWindows(
	before: ProviderConfig | null,
	after: ProviderConfig,
	rules: ContextWindowRule[],
	catalog: readonly Model[],
): WindowPlan {
	const oldIds = new Set((before?.models ?? []).map(modelEntryId));
	const fills = new Map<string, number>();
	const conflicts: RuleConflict[] = [];
	for (const entry of after.models) {
		const spec = modelEntrySpec(entry);
		const isNew = !oldIds.has(spec.id);
		const current = spec.contextWindow ?? null;
		if (current == null) {
			const r = resolveNewModelWindow({
				modelId: spec.id,
				rules,
				catalogWindow: catalogWindowFor(spec.id, catalog),
				providerDefault: after.defaultContextWindow,
			});
			if (r) fills.set(spec.id, r.value);
		} else if (isNew) {
			const rule = pickRule(rules, spec.id);
			if (rule && rule.contextWindow !== current) {
				conflicts.push({ modelId: spec.id, current, ruleValue: rule.contextWindow });
			}
		}
	}
	return { fills, conflicts };
}

function withWindows(config: ProviderConfig, windows: Map<string, number>): ProviderConfig {
	if (windows.size === 0) return config;
	const models: ModelEntry[] = config.models.map((e) => {
		const id = modelEntryId(e);
		const w = windows.get(id);
		if (w == null) return e;
		const spec: ModelSpec = { ...modelEntrySpec(e), contextWindow: w };
		return spec;
	});
	return { ...config, models };
}

/** Workbench (providers.json) models have no upstream window, so no D10 grow warning applies. */
function conflictMessage(conflicts: RuleConflict[]): string {
	const lines = conflicts.map((c) => `• ${c.modelId}：${formatTokens(c.current)} → ${formatTokens(c.ruleValue)}`);
	return `以下新增模型已填写的窗口与上下文窗口规则不一致：\n${lines.join("\n")}`;
}

/**
 * Applies D15 windows to `after` before it is saved. Never touches
 * `defaultContextWindow` or secrets. Returns the config to save and how many
 * model windows were set.
 */
export async function applyContextWindowsOnSave(
	before: ProviderConfig | null,
	after: ProviderConfig,
): Promise<{ config: ProviderConfig; count: number }> {
	let catalog: Model[] = [];
	try {
		catalog = await listModels();
	} catch {
		// Catalog is optional for D15; rules and provider default still apply.
	}
	const plan = planContextWindows(before, after, loadRules(), catalog);
	const windows = new Map(plan.fills);
	if (plan.conflicts.length > 0) {
		const overwrite = await confirmDialog(conflictMessage(plan.conflicts), {
			title: "规则覆盖确认",
			okLabel: "全部覆盖",
			cancelLabel: "保留原值",
		});
		if (overwrite) for (const c of plan.conflicts) windows.set(c.modelId, c.ruleValue);
	}
	return { config: withWindows(after, windows), count: windows.size };
}
