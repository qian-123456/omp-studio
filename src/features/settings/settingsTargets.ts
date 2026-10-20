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
	{ section: string; focusKey?: string; label: string }
> = {
	// Native sections anchor on a data-field-id; OMP sections anchor on the
	// config key rendered as data-omp-key inside OmpSettingRow.
	models: {
		section: "omp-roles",
		focusKey: "modelRolesPanel",
		label: "模型角色",
	},
	thinking: {
		section: "thinking",
		focusKey: "defaultThinkingLevel",
		label: "思考级别",
	},
	fastMode: {
		// Service tiers (`tier.*` / omp `/fast`) live in the Thinking tab.
		section: "thinking",
		focusKey: "tier.openai",
		label: "快速模式（服务层级）",
	},
	advisor: {
		section: "helper-models",
		focusKey: "advisor.enabled",
		label: "顾问（Advisor）",
	},
	extendedContext: {
		section: "context-window",
		focusKey: "extendedContext",
		label: "扩展上下文",
	},
	browser: {
		section: "tools",
		focusKey: "browser.enabled",
		label: "浏览器工具",
	},
	computerUse: {
		section: "tools",
		focusKey: "computer.enabled",
		label: "电脑操控",
	},
	memory: {
		section: "memory",
		focusKey: "memory.backend",
		label: "记忆后端",
	},
	mcp: {
		section: "mcp",
		focusKey: "mcpServerList",
		label: "MCP 服务器",
	},
	plugins: {
		section: "plugins",
		focusKey: "pluginList",
		label: "插件",
	},
	subagents: {
		section: "subagents",
		focusKey: "task.maxConcurrency",
		label: "任务与子代理",
	},
	// The app always passes --approval-mode to omp from this native setting,
	// so it is the real control for approvals (omp's tools.approvalMode key is
	// superseded by the spawn flag).
	approvals: {
		section: "general",
		focusKey: "defaultApprovalMode",
		label: "默认审批模式",
	},
	providers: {
		section: "providers",
		focusKey: "providerList",
		label: "API 供应商",
	},
	compaction: {
		section: "context-window",
		focusKey: "compaction",
		label: "自动压缩",
	},
	modelContext: {
		section: "context-window",
		label: "上下文窗口",
	},
	// ProvidersSection flips to the 订阅与配额 tab when it holds the focus key.
	quota: {
		section: "providers",
		focusKey: "quotaDashboard",
		label: "订阅与配额",
	},
	about: {
		section: "about",
		label: "关于与更新",
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

/** First provider (workbench, then OMP-managed) that lists `modelId`. */
function findProviderForModel(modelId: string): string | null {
	const { providers, ompProviders } = useProviders.getState();
	const own = providers.find((p) => p.models.some((m) => (typeof m === "string" ? m : m.id) === modelId));
	if (own) return own.id;
	return ompProviders.find((p) => p.modelIds.includes(modelId))?.id ?? null;
}
