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
	ChartColumn,
	ChartPie,
	ClipboardCheck,
	ClipboardCopy,
	Cpu,
	Database,
	Download,
	Expand,
	Eye,
	FilePlus2,
	Gauge,
	GitFork,
	Globe,
	KeyRound,
	Layers,
	ListChecks,
	MessagesSquare,
	Monitor,
	NotebookPen,
	PenLine,
	Play,
	Puzzle,
	RotateCcw,
	ScrollText,
	Settings,
	Share2,
	ShieldAlert,
	ShieldCheck,
	Sparkles,
	SquareSlash,
	Target,
	Wrench,
	Zap,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { copyText, confirmDialog } from "../../../lib/dialogs";
import { createSession } from "../../../lib/createSession";
import { ensureLive } from "../../../lib/ensureLive";
import { createSideChat, sessionExportHtml, sessionShare } from "../../../lib/ipc";
import { useChatUi } from "../chatUi";
import { sideChatDefaultModelArg } from "../../sidechat/modelDefault";
import { useComposer } from "../../../stores/composer";
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

/** `/fork` side chat opener (real forked session). */
const openSideChat = async (ctx: SlashContext, question: string) => {
	const info = await createSideChat(
		ctx.sessionId,
		question,
		undefined,
		sideChatDefaultModelArg() ?? undefined,
	);
	useUi.getState().setRightTab("sidechat");
	useUi.getState().selectSession(info.sessionId);
};

/** Goal mode state mirrored into get_state/goal_updated payloads. */
interface GoalModeLike {
	enabled?: boolean;
	mode?: string;
	goal?: { objective?: string; status?: string } | null;
}

const goalModeOf = (ctx: SlashContext): GoalModeLike | null => {
	const g = ctx.live?.state?.goal;
	return g && typeof g === "object" ? (g as GoalModeLike) : null;
};

const sendGoalOp = async (ctx: SlashContext, op: string, extra: Record<string, unknown> = {}) => {
	if (!ctx.live?.alive) await ensureLive(ctx.sessionId);
	await ctx.rpcSend({ type: "goal", op, ...extra });
	await ctx.rpcSend({ type: "get_state" });
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
			await openSideChat(ctx, question);
		},
	},
	{
		name: "btw",
		title: "顺便问一句",
		description: "开一个侧聊提问，不打断当前会话",
		icon: MessagesSquare,
		group: "会话",
		argHint: "[问题]",
		run: async (ctx) => {
			const question = ctx.args.trim();
			if (!question) {
				useUi.getState().setRightTab("sidechat");
				return;
			}
			await openSideChat(ctx, question);
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
	{
		name: "resume",
		title: "继续",
		description: "恢复上一次被打断的回合",
		icon: Play,
		group: "会话",
		run: async (ctx) => {
			const items = ctx.live?.items ?? [];
			for (let i = items.length - 1; i >= 0; i--) {
				const it = items[i];
				if (it.kind !== "assistant") continue;
				if (it.stopReason === "aborted") {
					await ctx.sendPromptText("Continue");
					return;
				}
				break;
			}
			toast.info("没有可恢复的回合");
			throw new SlashAbort();
		},
	},
	{
		name: "plan",
		title: "规划模式",
		description: "切换规划模式：先出计划再执行",
		icon: NotebookPen,
		group: "会话",
		// Client-side plan mode (prompt prefix + composer badge); the
		// produced plan shows in the right-side 计划 tab. omp exposes no
		// plan-mode RPC toggle for hosts.
		run: async (ctx) => {
			const composer = useComposer.getState();
			const on = !(composer.planModes[ctx.sessionId] === true);
			composer.setPlanMode(ctx.sessionId, on);
			if (on) useUi.getState().setRightTab("plan");
			toast.info(on ? "规划模式已开启：发送需求后生成计划" : "规划模式已关闭");
		},
	},
	{
		name: "goal",
		title: "目标",
		description: "设置或更新持续追求的目标",
		icon: Target,
		group: "会话",
		argHint: "<目标描述 | pause | resume | off>",
		run: async (ctx) => {
			const arg = ctx.args.trim();
			if (!arg) {
				const g = goalModeOf(ctx)?.goal;
				ctx.pushOutput("goal", g?.objective ? `当前目标：${g.objective}` : "当前没有目标");
				return;
			}
			if (/^(?:off|drop)$/i.test(arg)) {
				await sendGoalOp(ctx, "drop");
				toast.success("已清除目标");
				return;
			}
			if (/^(?:pause|暂停)$/i.test(arg)) {
				await sendGoalOp(ctx, "pause");
				toast.success("已暂停目标");
				return;
			}
			if (/^(?:resume|继续)$/i.test(arg)) {
				await sendGoalOp(ctx, "resume");
				toast.success("已恢复目标");
				return;
			}
			// Creating requires no active goal — drop the existing one first
			// (same outcome as editing the objective).
			if (goalModeOf(ctx)?.goal?.objective) await sendGoalOp(ctx, "drop");
			await sendGoalOp(ctx, "create", { objective: arg });
			toast.success(`已设置目标：${arg.length > 40 ? `${arg.slice(0, 40)}…` : arg}`);
		},
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
		name: "slow",
		title: "慢速模式",
		description: "切换低优先级/经济服务档位",
		icon: Gauge,
		group: "模型",
		run: async (ctx) => {
			const enabled = ctx.live?.state?.slowModeEnabled === true;
			if (!ctx.live?.alive) await ensureLive(ctx.sessionId);
			await ctx.rpcSend({ type: "set_slow_mode", enabled: !enabled });
			toast.success(enabled ? "已关闭慢速模式" : "已开启慢速模式");
		},
	},
	{
		name: "advisor",
		title: "顾问模型",
		description: "切换顾问模型介入",
		icon: Eye,
		group: "模型",
		run: (ctx) => ctx.openSettingsTarget("advisor"),
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
		run: (ctx) => ctx.openContextPopover(),
	},
	{
		name: "usage",
		title: "用量",
		description: "查看供应商订阅与配额",
		icon: ChartPie,
		group: "状态",
		run: (ctx) => ctx.openSettingsTarget("quota"),
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
		name: "stats",
		title: "统计",
		description: "查看会话统计数据",
		icon: ChartPie,
		group: "状态",
		run: () => useChatUi.getState().setStatsOpen(true),
	},

	// ---- 集成 ----
	{
		name: "mcp",
		title: "MCP 服务器",
		description: "管理 MCP 服务器",
		icon: Cable,
		group: "集成",
		run: (ctx) => ctx.openSettingsTarget("mcp"),
	},
	{
		name: "plugins",
		aliases: ["plugin", "marketplace"],
		title: "插件",
		description: "管理插件与扩展市场",
		icon: Puzzle,
		group: "集成",
		run: (ctx) => ctx.openSettingsTarget("plugins"),
	},
	{
		name: "memory",
		title: "记忆",
		description: "维护记忆后端",
		icon: Database,
		group: "集成",
		run: (ctx) => ctx.openSettingsTarget("memory"),
	},
	{
		name: "browser",
		title: "浏览器",
		description: "切换浏览器可见模式",
		icon: Globe,
		group: "集成",
		run: (ctx) => ctx.openSettingsTarget("browser"),
	},
	{
		name: "computer",
		title: "计算机操作",
		description: "切换计算机操作能力",
		icon: Monitor,
		group: "集成",
		run: (ctx) => ctx.openSettingsTarget("computerUse"),
	},
	{
		name: "extended-context",
		title: "扩展上下文",
		description: "切换扩展上下文窗口",
		icon: Expand,
		group: "集成",
		run: (ctx) => ctx.openSettingsTarget("extendedContext"),
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

	// ---- 更多 OMP 命令 (registry mirrors so they get Chinese labels; the
	// same-named dynamic omp commands are shadowed) ----
	{
		name: "init",
		title: "初始化项目",
		description: "为当前项目生成 AGENTS.md 等配置",
		icon: Sparkles,
		group: "更多 OMP 命令",
		run: sendAsPrompt,
	},
	{
		name: "share",
		title: "分享会话",
		description: "生成当前会话的分享链接",
		icon: Share2,
		group: "更多 OMP 命令",
		// Same flow as CenterHeader's 分享链接: confirm, sessionShare, copy.
		run: async (ctx) => {
			const ok = await confirmDialog(
				"将把本会话加密后上传到 OMP 分享服务。拿到链接的任何人都能查看内容，已知密钥会自动脱敏。继续？",
				{ title: "创建分享链接", okLabel: "创建并复制" },
			);
			if (!ok) throw new SlashAbort();
			toast.info("正在生成分享链接…");
			const url = await sessionShare(ctx.sessionId);
			await copyText(url);
			toast.success("分享链接已复制");
		},
	},
	{
		name: "review",
		title: "代码审查",
		description: "让代理审查当前改动",
		icon: ClipboardCheck,
		group: "更多 OMP 命令",
		argHint: "[说明]",
		run: sendAsPrompt,
	},
	{
		name: "changelog",
		title: "更新日志",
		description: "查看 omp 版本更新内容",
		icon: ScrollText,
		group: "更多 OMP 命令",
		// omp's changelog text has no transcript-less GUI surface; the About
		// section is the app's version/update surface.
		run: (ctx) => ctx.openSettingsTarget("about"),
	},
	{
		name: "security",
		title: "安全检查",
		description: "检查环境与权限配置",
		icon: ShieldAlert,
		group: "更多 OMP 命令",
		run: sendAsPrompt,
	},
	// ---- 技能 ----
	{
		name: "skill:visualize",
		aliases: ["visualize"],
		title: "Visualize",
		description: "创建可视化和交互工具",
		icon: ChartColumn,
		group: "技能",
		argHint: "<要可视化的内容>",
		feature: "visualize",
		// omp registers skills as `/skill:<name>`; normalize the friendlier
		// `/visualize` alias so both invocations reach the bundled skill.
		run: async (ctx) => {
			await ctx.sendPromptText(`/skill:visualize ${ctx.args.trim()}`.trim());
		},
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
