/**
 * App command registry for the slash menu. [B]
 * Static commands either act natively (pickers, new session, RPC calls) or
 * forward `/name args` to omp as a prompt — only commands that have a `handle`
 * in omp's RPC mode actually run there; the rest arrive as command_output.
 */

import {
	Activity,
	ArchiveRestore,
	ArrowRightToLine,
	Bot,
	Brain,
	Cable,
	ChartPie,
	ClipboardCopy,
	Cpu,
	Database,
	Download,
	Expand,
	Eye,
	FilePlus2,
	GitFork,
	Globe,
	KeyRound,
	Layers,
	ListChecks,
	ListTodo,
	Monitor,
	PenLine,
	Puzzle,
	RotateCcw,
	Settings,
	ShieldCheck,
	SquareSlash,
	Wrench,
	Zap,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { copyText } from "../../../lib/dialogs";
import { createSession } from "../../../lib/createSession";
import { createSideChat, sessionExportHtml } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import { buildStatusCard } from "./status";
import { SlashAbort, type SlashCommandDef, type SlashContext } from "./types";

/** Forward the whole `/name args` input to omp; the reply arrives as
 * `command_output` (or a normal turn when the command invokes the agent). */
const sendAsPrompt = async (ctx: SlashContext): Promise<void> => {
	await ctx.sendPromptText(ctx.rawText);
};


export const SLASH_COMMANDS: SlashCommandDef[] = [
	// ---- 会话 ----
	{
		name: "new",
		title: "新会话",
		description: "在当前目录开始一个新会话",
		icon: FilePlus2,
		group: "会话",
		requiresEmptyComposer: true,
		run: async (ctx) => {
			const cwd = ctx.session?.cwd;
			if (!cwd) throw new SlashAbort("无法确定当前目录");
			const { sessionId, stub } = await createSession({ cwd });
			useSessions.getState().upsert([stub]);
			useUi.getState().selectSession(sessionId);
			toast.success("已创建新会话");
		},
	},
	{
		name: "fork",
		title: "分叉",
		description: "带着问题分叉出一个侧聊",
		icon: GitFork,
		group: "会话",
		argHint: "<问题>",
		run: async (ctx) => {
			const question = ctx.args.trim();
			if (!question) {
				toast.info("用法: /fork <问题>");
				throw new SlashAbort();
			}
			const info = await createSideChat(ctx.sessionId, question);
			useUi.getState().setRightTab("sidechat");
			useUi.getState().selectSession(info.sessionId);
		},
	},
	{
		name: "rename",
		title: "重命名",
		description: "修改当前会话的名称",
		icon: PenLine,
		group: "会话",
		argHint: "<名称>",
		run: async (ctx) => {
			const name = ctx.args.trim();
			if (!name) {
				toast.info("用法: /rename <名称>");
				throw new SlashAbort();
			}
			await ctx.rpcSend({ type: "set_session_name", name });
			toast.success(`已重命名为「${name}」`);
		},
	},
	{
		name: "compact",
		title: "压缩上下文",
		description: "压缩会话上下文，可附带自定义指令",
		icon: ArchiveRestore,
		group: "会话",
		argHint: "[指令]",
		settingsTarget: "compaction",
		run: async (ctx) => {
			toast.info("正在压缩上下文…");
			const command: Record<string, unknown> = { type: "compact" };
			if (ctx.args.trim())
				command.customInstructions = ctx.args.trim();
			await ctx.rpcSend(command);
			toast.success("上下文压缩完成");
		},
	},
	{
		name: "handoff",
		title: "交接",
		description: "总结当前会话为交接文档并压缩上下文",
		icon: ArrowRightToLine,
		group: "会话",
		settingsTarget: "compaction",
		run: async (ctx) => {
			toast.info("正在生成交接文档…");
			const resp = await ctx.rpcSend({ type: "handoff" });
			const data = (resp.data ?? resp) as Record<string, unknown> | null;
			const path =
				data && typeof data.savedPath === "string"
					? data.savedPath
					: null;
			toast.success(
				path ? `交接文档已保存: ${path}` : "交接完成",
				6000,
			);
		},
	},
	{
		name: "export",
		title: "导出 HTML",
		description: "导出当前会话为 HTML 并在访达中显示",
		icon: Download,
		group: "会话",
		run: async (ctx) => {
			const outPath = await sessionExportHtml(ctx.sessionId);
			toast.success(`已导出 HTML: ${outPath}`, 6000);
			try {
				await revealItemInDir(outPath);
			} catch {
				/* reveal failure is non-fatal */
			}
		},
	},
	{
		name: "copy",
		title: "复制回复",
		description: "复制最近一条助手回复到剪贴板",
		icon: ClipboardCopy,
		group: "会话",
		run: async (ctx) => {
			const resp = await ctx.rpcSend({ type: "get_last_assistant_text" });
			const data = resp.data ?? resp;
			const text =
				typeof data === "string"
					? data
					: typeof (data as Record<string, unknown>)?.text ===
							"string"
						? ((data as Record<string, unknown>).text as string)
						: "";
			if (!text.trim()) {
				toast.info("暂无可复制的助手回复");
				return;
			}
			await copyText(text);
			toast.success("已复制最近一条助手回复");
		},
	},
	{
		name: "retry",
		title: "重试",
		description: "重试上一次失败的回合",
		icon: RotateCcw,
		group: "会话",
		run: sendAsPrompt,
	},

	// ---- 模型 ----
	{
		name: "model",
		aliases: ["models"],
		title: "切换模型",
		description: "打开模型选择器切换当前会话模型",
		icon: Cpu,
		group: "模型",
		settingsTarget: "models",
		run: (ctx) => ctx.openModelPicker(),
	},
	{
		name: "thinking",
		title: "思考等级",
		description: "打开思考等级选择器",
		icon: Brain,
		group: "模型",
		settingsTarget: "thinking",
		run: (ctx) => ctx.openThinkingPicker(),
	},
	{
		name: "fast",
		title: "快速模式",
		description: "切换快速服务档位",
		icon: Zap,
		group: "模型",
		settingsTarget: "fastMode",
		run: async (ctx) => {
			const enabled = ctx.live?.state?.fastModeEnabled === true;
			await ctx.rpcSend({ type: "set_fast_mode", enabled: !enabled });
			toast.success(enabled ? "已关闭快速模式" : "已开启快速模式");
		},
	},
	{
		name: "advisor",
		title: "顾问模型",
		description: "切换顾问模型介入",
		icon: Eye,
		group: "模型",
		settingsTarget: "advisor",
		run: sendAsPrompt,
	},

	// ---- 状态 ----
	{
		name: "status",
		title: "会话状态",
		description: "查看模型、上下文、用量与队列概况",
		icon: Activity,
		group: "状态",
		run: async (ctx) => {
			const card = await buildStatusCard(ctx);
			ctx.pushOutput("status", card);
		},
	},
	{
		name: "context",
		title: "上下文占用",
		description: "查看上下文窗口的占用明细",
		icon: Layers,
		group: "状态",
		run: sendAsPrompt,
	},
	{
		name: "usage",
		title: "用量",
		description: "查看供应商用量与限额",
		icon: ChartPie,
		group: "状态",
		run: sendAsPrompt,
	},
	{
		name: "tools",
		title: "工具列表",
		description: "列出当前对代理可见的工具",
		icon: Wrench,
		group: "状态",
		run: sendAsPrompt,
	},
	{
		name: "jobs",
		title: "后台任务",
		description: "查看异步后台任务状态",
		icon: ListChecks,
		group: "状态",
		run: sendAsPrompt,
	},
	{
		name: "todo",
		title: "待办",
		description: "查看或修改待办列表",
		icon: ListTodo,
		group: "状态",
		argHint: "[操作]",
		run: sendAsPrompt,
	},
	{
		name: "stats",
		title: "统计",
		description: "查看会话统计数据",
		icon: ChartPie,
		group: "状态",
		run: sendAsPrompt,
	},

	// ---- 集成 ----
	{
		name: "mcp",
		title: "MCP 服务器",
		description: "管理 MCP 服务器",
		icon: Cable,
		group: "集成",
		settingsTarget: "mcp",
		run: sendAsPrompt,
	},
	{
		name: "plugins",
		aliases: ["plugin", "marketplace"],
		title: "插件",
		description: "管理插件与扩展市场",
		icon: Puzzle,
		group: "集成",
		settingsTarget: "plugins",
		run: sendAsPrompt,
	},
	{
		name: "memory",
		title: "记忆",
		description: "维护记忆后端",
		icon: Database,
		group: "集成",
		settingsTarget: "memory",
		run: sendAsPrompt,
	},
	{
		name: "browser",
		title: "浏览器",
		description: "切换浏览器可见模式",
		icon: Globe,
		group: "集成",
		settingsTarget: "browser",
		run: sendAsPrompt,
	},
	{
		name: "computer",
		title: "计算机操作",
		description: "切换计算机操作能力",
		icon: Monitor,
		group: "集成",
		settingsTarget: "computerUse",
		run: sendAsPrompt,
	},
	{
		name: "extended-context",
		title: "扩展上下文",
		description: "切换扩展上下文窗口",
		icon: Expand,
		group: "集成",
		settingsTarget: "extendedContext",
		run: sendAsPrompt,
	},

	// ---- 设置 ----
	{
		name: "agents",
		title: "子代理",
		description: "配置子代理",
		icon: Bot,
		group: "设置",
		settingsTarget: "subagents",
		run: (ctx) => ctx.openSettingsTarget("subagents"),
	},
	{
		name: "approvals",
		title: "审批",
		description: "配置工具审批规则",
		icon: ShieldCheck,
		group: "设置",
		settingsTarget: "approvals",
		run: (ctx) => ctx.openSettingsTarget("approvals"),
	},
	{
		name: "login",
		title: "登录",
		description: "管理供应商登录",
		icon: KeyRound,
		group: "设置",
		settingsTarget: "providers",
		run: (ctx) => ctx.openSettingsTarget("providers"),
	},
	{
		name: "settings",
		title: "设置",
		description: "打开应用设置",
		icon: Settings,
		group: "设置",
		run: (ctx) => ctx.openSettings(),
	},
];

/** Lookup by command name or alias (typed `/x` uses the primary name). */
export function findSlashCommand(name: string): SlashCommandDef | undefined {
	const n = name.toLowerCase();
	return SLASH_COMMANDS.find(
		(c) => c.name === n || c.aliases?.some((a) => a.toLowerCase() === n),
	);
}

/** Icon used for commands that only exist inside omp (no app executor). */
export const DYNAMIC_COMMAND_ICON = SquareSlash;
