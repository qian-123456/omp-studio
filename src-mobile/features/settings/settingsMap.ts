import type { SchemePref } from "../../core/stores/prefs";

/* ---------------------------------------------------------------- OMP config rows (allowlisted by the server) */

export type SettingDef =
	| { key: string; type: "bool"; name: string; hint: string }
	| { key: string; type: "enum"; name: string; hint: string; options: ReadonlyArray<readonly [string, string]> }
	| { key: string; type: "int"; name: string; hint: string; min: number; max: number; step: number; unit: string };

export interface SettingGroup {
	title: string;
	items: SettingDef[];
}

const MODE_ALL = [
	["one-at-a-time", "逐条"],
	["all", "一次全部"],
] as const;

/**
 * Every key is in the server allowlist (`MOBILE_SETTINGS` in `left.rs`). `tools.approvalMode` is NOT here:
 * the 权限模式 section owns approval and writes the desktop default through its own endpoint.
 */
export const SETTING_GROUPS: SettingGroup[] = [
	{
		title: "执行与审批",
		items: [
			{ key: "ask.enabled", type: "bool", name: "允许智能体向我提问", hint: "关闭后智能体不会再弹出选择题或确认框。" },
			{
				key: "ask.notify",
				type: "enum",
				name: "等待回答时提醒",
				hint: "智能体在等你回答时是否发出通知。",
				options: [
					["on", "开"],
					["off", "关"],
				],
			},
			{ key: "ask.timeout", type: "int", name: "提问自动选择等待", hint: "超时后自动选推荐项；0 表示一直等待。未响应的审批会被拒绝。", min: 0, max: 3600, step: 10, unit: "秒" },
			{ key: "bash.autoBackground.enabled", type: "bool", name: "长命令自动转后台", hint: "耗时很长的命令自动放到后台，完成后再通知智能体。" },
			{ key: "tools.maxTimeout", type: "int", name: "工具最长超时", hint: "智能体可给单个工具设置的最长超时；0 表示不限制。", min: 0, max: 86400, step: 60, unit: "秒" },
		],
	},
	{
		title: "对话与上下文",
		items: [
			{ key: "hideThinkingBlock", type: "bool", name: "隐藏思考内容", hint: "开启后回复里不再显示模型的思考过程。" },
			{ key: "compaction.enabled", type: "bool", name: "自动压缩上下文", hint: "上下文过长时自动压缩，避免超出模型窗口。" },
			{ key: "compaction.autoContinue", type: "bool", name: "压缩后自动继续", hint: "压缩完成后智能体自动接着干活，无需你再发消息。" },
			{ key: "steeringMode", type: "enum", name: "运行中追加消息", hint: "智能体工作时你发的消息怎么处理：逐条依次，或一次全部送入。", options: MODE_ALL },
			{ key: "followUpMode", type: "enum", name: "完成后追问", hint: "一轮结束后排队的追问是逐条处理还是一次全部处理。", options: MODE_ALL },
			{
				key: "interruptMode",
				type: "enum",
				name: "打断工具执行",
				hint: "追加的消息何时打断正在执行的工具：立即，或等它执行完。",
				options: [
					["immediate", "立即"],
					["wait", "等待完成"],
				],
			},
		],
	},
	{
		title: "出错重试",
		items: [
			{ key: "retry.enabled", type: "bool", name: "出错自动重试", hint: "接口报错（限流、网络波动）时自动重试。" },
			{ key: "retry.maxRetries", type: "int", name: "最多重试次数", hint: "超过次数后才算失败。", min: 0, max: 100, step: 1, unit: "次" },
			{ key: "retry.maxDelayMs", type: "int", name: "单次最长等待", hint: "服务端要求等待更久时直接失败；0 表示不设上限。", min: 0, max: 3_600_000, step: 30_000, unit: "毫秒" },
			{ key: "retry.waitForUsageReset", type: "bool", name: "额度用尽时等待重置", hint: "额度耗尽且知道重置时间时一直等到重置，期间子代理也会被占用。" },
		],
	},
];

export type OmpValue = boolean | number | string | null | undefined;

/** Groups restricted to the keys the server actually returned (unreadable config → no groups). */
export function visibleGroups(omp: Record<string, OmpValue> | undefined): SettingGroup[] {
	if (!omp) return [];
	return SETTING_GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => it.key in omp) })).filter((g) => g.items.length > 0);
}

export function clampInt(def: { min: number; max: number }, n: number): number {
	return Math.min(def.max, Math.max(def.min, Math.round(n)));
}

/** Parse a typed number field; `null` for empty / non-numeric text (caller restores the old value). */
export function parseIntInput(def: { min: number; max: number }, text: string): number | null {
	if (text.trim() === "") return null;
	const n = Number(text);
	return Number.isFinite(n) ? clampInt(def, n) : null;
}

/* ---------------------------------------------------------------- permission mode */

export type ApprovalMode = "always-ask" | "write" | "yolo";

export const APPROVAL_MODES: ReadonlyArray<{ value: ApprovalMode; label: string; effect: string }> = [
	{ value: "always-ask", label: "每步都问", effect: "智能体每次改文件、执行命令前都会停下来等你点同意。最安全，但需要你随时在手机或电脑前。" },
	{ value: "write", label: "改动前问", effect: "只读取、搜索这类不改动东西的操作会直接执行；修改文件或运行命令前才会问你。" },
	{ value: "yolo", label: "全自动", effect: "智能体不再征求同意，会直接改文件、跑命令，包括删除操作。省心，但出错时无法事先拦下，请只在可信的项目里使用。" },
];

export function isApprovalMode(v: unknown): v is ApprovalMode {
	return v === "always-ask" || v === "write" || v === "yolo";
}

export function approvalEffect(mode: ApprovalMode): string {
	return APPROVAL_MODES.find((m) => m.value === mode)?.effect ?? "";
}

/* ---------------------------------------------------------------- local display prefs <-> core prefs */

export const SCHEMES: ReadonlyArray<{ value: SchemePref; label: string }> = [
	{ value: "system", label: "跟随系统" },
	{ value: "light", label: "浅色" },
	{ value: "dark", label: "深色" },
];

export type MsgSize = "s" | "m" | "l" | "xl";

export const MSG_SIZES: ReadonlyArray<{ value: MsgSize; label: string; px: number }> = [
	{ value: "s", label: "小", px: 14 },
	{ value: "m", label: "标准", px: 16 },
	{ value: "l", label: "大", px: 18 },
	{ value: "xl", label: "特大", px: 20 },
];

/** Keys inside `usePrefs().extra` shared with the chat slice. */
export const MSG_SIZE_KEY = "msgSize";
export const FOLD_OPEN_KEY = "foldOpen";

export function isMsgSize(v: unknown): v is MsgSize {
	return v === "s" || v === "m" || v === "l" || v === "xl";
}

/** Stored extra value → valid size (unknown / missing → 标准). */
export function msgSizeFromPref(v: unknown): MsgSize {
	return isMsgSize(v) ? v : "m";
}

export function msgSizePx(size: MsgSize): number {
	return MSG_SIZES.find((s) => s.value === size)?.px ?? 16;
}
