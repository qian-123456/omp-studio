/**
 * [D] Stable settings deep-link targets (contract C4).
 *
 * Slash commands and other features that need configuration call
 * `openSettingsTarget(...)` instead of hand-picking a section id. Each target
 * names a section (nav id) plus an optional focusKey: a native row
 * (`data-field-id`) or an OMP config key (`data-omp-key` on OmpSettingRow) that
 * SettingsPage scrolls to and highlights.
 */

import { useUi } from "../../stores/ui";
import { useProviders } from "../providers/store";

export type SettingsTarget =
	| "models"
	| "thinking"
	| "fastMode"
	| "advisor"
	| "extendedContext"
	| "browser"
	| "computerUse"
	| "memory"
	| "mcp"
	| "plugins"
	| "subagents"
	| "approvals"
	| "providers"
	| "compaction"
	| "modelContext"
	| "quota"
	| "about";

export const SETTINGS_TARGETS: Record<
	SettingsTarget,
	{ section: string; focusKey?: string }
> = {
	// Native sections anchor on a data-field-id; OMP sections anchor on the
	// config key rendered as data-omp-key inside OmpSettingRow.
	models: {
		section: "omp-roles",
		focusKey: "modelRolesPanel",
	},
	thinking: {
		section: "thinking",
		focusKey: "defaultThinkingLevel",
	},
	fastMode: {
		// Service tiers (`tier.*` / omp `/fast`) live in the Thinking tab.
		section: "thinking",
		focusKey: "tier.openai",
	},
	advisor: {
		section: "helper-models",
		focusKey: "advisor.enabled",
	},
	extendedContext: {
		section: "context-window",
		focusKey: "extendedContext",
	},
	browser: {
		section: "tools",
		focusKey: "browser.enabled",
	},
	computerUse: {
		section: "tools",
		focusKey: "computer.enabled",
	},
	memory: {
		section: "memory",
		focusKey: "memory.backend",
	},
	mcp: {
		section: "mcp",
		focusKey: "mcpServerList",
	},
	plugins: {
		section: "plugins",
		focusKey: "pluginList",
	},
	subagents: {
		section: "subagents",
		focusKey: "task.maxConcurrency",
	},
	// The app always passes --approval-mode to omp from this native setting,
	// so it is the real control for approvals (omp's tools.approvalMode key is
	// superseded by the spawn flag).
	approvals: {
		section: "general",
		focusKey: "defaultApprovalMode",
	},
	providers: {
		section: "providers",
		focusKey: "providerList",
	},
	compaction: {
		section: "context-window",
		focusKey: "compaction",
	},
	modelContext: {
		section: "context-window",
	},
	// ProvidersSection flips to the 订阅与配额 tab when it holds the focus key.
	quota: {
		section: "providers",
		focusKey: "quotaDashboard",
	},
	about: {
		section: "about",
	},
};

/** Open Settings on the target's section and scroll+highlight its control. */
export function openSettingsTarget(target: SettingsTarget): void {
	const t = SETTINGS_TARGETS[target];
	useUi
		.getState()
		.openSettings(t.section, t.focusKey ? { focusKey: t.focusKey } : undefined);
}

/**
 * Open Settings ▸ 上下文窗口 focused on one model row
 * (`data-field-id="cw-model:<providerId>/<modelId>"`). With a null providerId
 * the first configured provider listing `modelId` is used; when no row matches
 * the page opens unfocused.
 */
export function openContextWindowForModel(providerId: string | null, modelId: string): void {
	const pid = providerId ?? findProviderForModel(modelId);
	useUi
		.getState()
		.openSettings("context-window", pid ? { focusKey: `cw-model:${pid}/${modelId}` } : undefined);
}

/** First OMP provider row that lists `modelId`. */
function findProviderForModel(modelId: string): string | null {
	const { rows } = useProviders.getState();
	return rows.find((p) => p.models.some((m) => (typeof m === "string" ? m : m.id) === modelId))?.id ?? null;
}
