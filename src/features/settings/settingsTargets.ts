/**
 * [D] Stable settings deep-link targets (contract C4).
 *
 * Slash commands and other features that need configuration call
 * `openSettingsTarget(...)` instead of hand-picking a section id. Each target
 * names a section (nav id) plus an optional focusKey: a native row
 * (`data-field-id`) or an OMP config key (`data-omp-key` on ConfigRow) that
 * SettingsPage scrolls to and highlights.
 */

import { useUi } from "../../stores/ui";

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
	| "modelContext";

export const SETTINGS_TARGETS: Record<
	SettingsTarget,
	{ section: string; focusKey?: string; label: string }
> = {
	// Native sections anchor on a data-field-id; OMP sections anchor on the
	// config key rendered as data-omp-key inside OmpConfigSection.
	models: {
		section: "omp-roles",
		focusKey: "modelRolesPanel",
		label: "模型角色",
	},
	thinking: {
		section: "omp-thinking",
		focusKey: "defaultThinkingLevel",
		label: "思考级别",
	},
	fastMode: {
		// Service tiers (`tier.*` / omp `/fast`) live in the Thinking tab.
		section: "omp-thinking",
		focusKey: "tier.openai",
		label: "快速模式（服务层级）",
	},
	advisor: {
		section: "omp-tasks",
		focusKey: "advisor.enabled",
		label: "顾问（Advisor）",
	},
	extendedContext: {
		section: "omp-context",
		focusKey: "extendedContext",
		label: "扩展上下文",
	},
	browser: {
		section: "omp-tools",
		focusKey: "browser.enabled",
		label: "浏览器工具",
	},
	computerUse: {
		section: "omp-tools",
		focusKey: "computer.enabled",
		label: "电脑操控",
	},
	memory: {
		section: "omp-context",
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
		section: "omp-tasks",
		focusKey: "task.maxConcurrency",
		label: "任务与子代理",
	},
	// The app always passes --approval-mode to omp from this native setting,
	// so it is the real control for approvals (omp's tools.approvalMode key is
	// superseded by the spawn flag).
	approvals: {
		section: "sessions",
		focusKey: "defaultApprovalMode",
		label: "默认审批模式",
	},
	providers: {
		section: "providers",
		focusKey: "providerList",
		label: "API 供应商",
	},
	compaction: {
		section: "omp-context",
		focusKey: "compaction.enabled",
		label: "上下文压缩",
	},
	modelContext: {
		section: "model-context",
		focusKey: "modelContextGroups",
		label: "统一模型上下文",
	},
};

/** Open Settings on the target's section and scroll+highlight its control. */
export function openSettingsTarget(target: SettingsTarget): void {
	const t = SETTINGS_TARGETS[target];
	useUi
		.getState()
		.openSettings(t.section, t.focusKey ? { focusKey: t.focusKey } : undefined);
}
