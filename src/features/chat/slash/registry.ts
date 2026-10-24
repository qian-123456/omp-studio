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
	Vibrate,
} from "lucide-react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { copyText, confirmDialog, errMsg } from "../../../lib/dialogs";
import { createSession } from "../../../lib/createSession";
import { ensureLive, isResumeCancelled } from "../../../lib/ensureLive";
import { sessionExportHtml, sessionShare } from "../../../lib/ipc";
import { useLive } from "../../../stores/live";
import { useChatUi } from "../chatUi";
import { openSideChatTab } from "../../sidechat/sideChatActions";
import { forkAndSend, isForkDraftId, startFork } from "../../sessions/forkDraft";
import { sendPrompt } from "../send";
import { useComposer } from "../../../stores/composer";
import { toast } from "../../../lib/toast";
import { tNow } from "../../../stores/language";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import { buildStatusCard } from "./status";
import { runCompaction } from "./compaction";
import { SlashAbort, type SlashCommandDef, type SlashContext } from "./types";

/** Forward the whole `/name args` input to omp; the reply arrives as
 * `command_output` (or a normal turn when the command invokes the agent). */
const sendAsPrompt = async (ctx: SlashContext): Promise<void> => {
	await ctx.sendPromptText(ctx.rawText);
};

/** Native handler only for the bare command; any args (`/fast on`, `/plugins
 * enable x`, …) are omp subcommands and go to omp unchanged. */
const nativeOrForward =
	(native: (ctx: SlashContext) => void | Promise<void>) =>
	(ctx: SlashContext): void | Promise<void> =>
		ctx.args.trim() ? sendAsPrompt(ctx) : native(ctx);

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
		get title() { return tNow("slash.cmd.new.title"); },
		get description() { return tNow("slash.cmd.new.desc"); },
		icon: FilePlus2,
		group: "session",
		requiresEmptyComposer: true,
		run: async (ctx) => {
			const cwd = ctx.session?.cwd;
			if (!cwd) throw new SlashAbort(tNow("slash.cmd.new.abortNoCwd"));
			const { sessionId, stub } = await createSession({ cwd });
			useSessions.getState().upsert([stub]);
			useUi.getState().selectSession(sessionId);
			toast.success(tNow("slash.cmd.new.success"));
		},
	},
	{
		name: "fork",
		get title() { return tNow("slash.cmd.fork.title"); },
		get description() { return tNow("slash.cmd.fork.desc"); },
		icon: GitFork,
		group: "session",
		get argHint() { return tNow("slash.cmd.fork.argHint"); },
		run: async (ctx) => {
			if (isForkDraftId(ctx.sessionId)) {
				throw new SlashAbort(tNow("slash.cmd.fork.abortInFork"));
			}
			const text = ctx.args.trim();
			if (!text) {
				await startFork(ctx.sessionId);
				return;
			}
			await forkAndSend(ctx.sessionId, text, (id) => sendPrompt(id, text));
		},
	},
	{
		name: "btw",
		get title() { return tNow("slash.cmd.btw.title"); },
		get description() { return tNow("slash.cmd.btw.desc"); },
		icon: MessagesSquare,
		group: "session",
		get argHint() { return tNow("slash.cmd.btw.argHint"); },
		run: async (ctx) => {
			const question = ctx.args.trim();
			if (!question) {
				await openSideChatTab(ctx.sessionId);
				return;
			}
			await openSideChatTab(ctx.sessionId, { question });
		},
	},
	{
		name: "rename",
		get title() { return tNow("slash.cmd.rename.title"); },
		get description() { return tNow("slash.cmd.rename.desc"); },
		icon: PenLine,
		group: "session",
		get argHint() { return tNow("slash.cmd.rename.argHint"); },
		run: async (ctx) => {
			const name = ctx.args.trim();
			if (!name) {
				toast.info(tNow("slash.cmd.rename.usage"));
				throw new SlashAbort();
			}
			ctx.track("rename", tNow("slash.cmd.rename.tracking"), async () => {
				await ctx.rpcSend({ type: "set_session_name", name });
				return tNow("slash.cmd.rename.result", { name });
			});
		},
	},
	{
		name: "compact",
		get title() { return tNow("slash.cmd.compact.title"); },
		get description() { return tNow("slash.cmd.compact.desc"); },
		icon: ArchiveRestore,
		group: "session",
		get argHint() { return tNow("slash.cmd.compact.argHint"); },
		settingsTarget: "compaction",
		run: async (ctx) => {
			// Fire and forget: runCompaction owns the transcript status row.
			void runCompaction({
				sessionId: ctx.sessionId,
				instructions: ctx.args,
				rpcSend: ctx.rpcSend,
				ensureAlive: async () => {
					if (!ctx.live?.alive) await ensureLive(ctx.sessionId);
				},
				errorText: (err) => (isResumeCancelled(err) ? null : errMsg(err)),
			});
		},
	},
	{
		name: "handoff",
		get title() { return tNow("slash.cmd.handoff.title"); },
		get description() { return tNow("slash.cmd.handoff.desc"); },
		icon: ArrowRightToLine,
		group: "session",
		settingsTarget: "compaction",
		run: async (ctx) => {
			// One divider in the thread: running → done/error in place.
			const live = useLive.getState();
			const running = live.sessions[ctx.sessionId]?.flowNotices.some(
				(n) => n.kind === "handoff" && n.status === "running",
			);
			if (running) return;
			const noticeId = live.beginFlowNotice(ctx.sessionId, "handoff");
			void ctx.rpcSend({ type: "handoff" }).then(
				(resp) => {
					useLive.getState().finishFlowNotice(ctx.sessionId, noticeId, { status: "done" });
					const data = (resp.data ?? resp) as Record<string, unknown> | null;
					if (data && typeof data.savedPath === "string") {
						ctx.pushOutput("handoff", tNow("slash.cmd.handoff.saved", { path: data.savedPath }));
					}
				},
				(err) => {
					if (isResumeCancelled(err)) {
						useLive.getState().dismissFlowNotice(ctx.sessionId, noticeId);
						return;
					}
					useLive
						.getState()
						.finishFlowNotice(ctx.sessionId, noticeId, { status: "error", detail: errMsg(err) });
				},
			);
		},
	},
	{
		name: "shake",
		get title() { return tNow("slash.cmd.shake.title"); },
		get description() { return tNow("slash.cmd.shake.desc"); },
		icon: Vibrate,
		group: "session",
		argHint: "[elide|images|thinking]",
		settingsTarget: "compaction",
		run: async (ctx) => {
			await sendAsPrompt(ctx);
			// omp frees tokens but pushes no state frame; resync so the context
			// ring and usage popover show the post-shake size.
			await ctx.rpcSend({ type: "get_state" }).catch(() => {});
		},
	},
	{
		name: "export",
		get title() { return tNow("slash.cmd.export.title"); },
		get description() { return tNow("slash.cmd.export.desc"); },
		icon: Download,
		group: "session",
		run: async (ctx) => {
			ctx.track("export", tNow("slash.cmd.export.tracking"), async () => {
				const outPath = await sessionExportHtml(ctx.sessionId);
				try {
					await revealItemInDir(outPath);
				} catch {
					/* reveal failure is non-fatal */
				}
				return tNow("slash.cmd.export.result", { path: outPath });
			});
		},
	},
	{
		name: "copy",
		get title() { return tNow("slash.cmd.copy.title"); },
		get description() { return tNow("slash.cmd.copy.desc"); },
		icon: ClipboardCopy,
		group: "session",
		run: async (ctx) => {
			ctx.track("copy", tNow("slash.cmd.copy.tracking"), async () => {
				const resp = await ctx.rpcSend({ type: "get_last_assistant_text" });
				const data = resp.data ?? resp;
				const text =
					typeof data === "string"
						? data
						: typeof (data as Record<string, unknown>)?.text === "string"
							? ((data as Record<string, unknown>).text as string)
							: "";
				if (!text.trim()) return tNow("slash.cmd.copy.empty");
				await copyText(text);
				return tNow("slash.cmd.copy.result");
			});
		},
	},
	{
		name: "retry",
		get title() { return tNow("slash.cmd.retry.title"); },
		get description() { return tNow("slash.cmd.retry.desc"); },
		icon: RotateCcw,
		group: "session",
		run: sendAsPrompt,
	},
	{
		name: "resume",
		get title() { return tNow("slash.cmd.resume.title"); },
		get description() { return tNow("slash.cmd.resume.desc"); },
		icon: Play,
		group: "session",
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
			toast.info(tNow("slash.cmd.resume.noTurn"));
			throw new SlashAbort();
		},
	},
	{
		name: "plan",
		get title() { return tNow("slash.cmd.plan.title"); },
		get description() { return tNow("slash.cmd.plan.desc"); },
		icon: NotebookPen,
		group: "session",
		// Client-side plan mode (prompt prefix + composer badge); the
		// produced plan shows in the right-side 计划 tab. omp exposes no
		// plan-mode RPC toggle for hosts.
		run: async (ctx) => {
			const composer = useComposer.getState();
			const on = !(composer.planModes[ctx.sessionId] === true);
			composer.setPlanMode(ctx.sessionId, on);
			if (on) useUi.getState().setRightTab("plan");
			ctx.pushOutput("plan", on ? tNow("slash.cmd.plan.on") : tNow("slash.cmd.plan.off"));
		},
	},
	{
		name: "goal",
		get title() { return tNow("slash.cmd.goal.title"); },
		get description() { return tNow("slash.cmd.goal.desc"); },
		icon: Target,
		group: "session",
		get argHint() { return tNow("slash.cmd.goal.argHint"); },
		run: async (ctx) => {
			let arg = ctx.args.trim();
			// omp subcommands: `show` = bare `/goal`; `set <text>` = `<text>`;
			// pause/resume/drop are handled below like their aliases.
			if (/^show$/i.test(arg)) arg = "";
			else arg = arg.replace(/^set\s+(?=\S)/i, "");
			if (!arg) {
				const g = goalModeOf(ctx)?.goal;
				ctx.pushOutput("goal", g?.objective ? tNow("slash.cmd.goal.current", { goal: g.objective }) : tNow("slash.cmd.goal.noGoal"));
				return;
			}
			if (/^(?:off|drop)$/i.test(arg)) {
				ctx.track("goal", tNow("slash.cmd.goal.dropTracking"), async () => {
					await sendGoalOp(ctx, "drop");
					return tNow("slash.cmd.goal.dropResult");
				});
				return;
			}
			if (/^(?:pause|暂停)$/i.test(arg)) {
				ctx.track("goal", tNow("slash.cmd.goal.pauseTracking"), async () => {
					await sendGoalOp(ctx, "pause");
					return tNow("slash.cmd.goal.pauseResult");
				});
				return;
			}
			if (/^(?:resume|继续)$/i.test(arg)) {
				ctx.track("goal", tNow("slash.cmd.goal.resumeTracking"), async () => {
					await sendGoalOp(ctx, "resume");
					return tNow("slash.cmd.goal.resumeResult");
				});
				return;
			}
			// Creating requires no active goal — drop the existing one first
			// (same outcome as editing the objective).
			const hadGoal = Boolean(goalModeOf(ctx)?.goal?.objective);
			ctx.track("goal", tNow("slash.cmd.goal.setTracking"), async () => {
				if (hadGoal) await sendGoalOp(ctx, "drop");
				await sendGoalOp(ctx, "create", { objective: arg });
				return tNow("slash.cmd.goal.setResult", { goal: arg });
			});
		},
	},

	// ---- 模型 ----
	{
		name: "model",
		aliases: ["models"],
		get title() { return tNow("slash.cmd.model.title"); },
		get description() { return tNow("slash.cmd.model.desc"); },
		icon: Cpu,
		group: "model",
		settingsTarget: "models",
		run: (ctx) => ctx.openModelPicker(),
	},
	{
		name: "thinking",
		get title() { return tNow("slash.cmd.thinking.title"); },
		get description() { return tNow("slash.cmd.thinking.desc"); },
		icon: Brain,
		group: "model",
		settingsTarget: "thinking",
		run: (ctx) => ctx.openThinkingPicker(),
	},
	{
		name: "fast",
		get title() { return tNow("slash.cmd.fast.title"); },
		get description() { return tNow("slash.cmd.fast.desc"); },
		icon: Zap,
		group: "model",
		settingsTarget: "fastMode",
		run: nativeOrForward(async (ctx) => {
			const enabled = ctx.live?.state?.fastModeEnabled === true;
			ctx.track("fast", tNow("slash.cmd.fast.tracking"), async () => {
				await ctx.rpcSend({ type: "set_fast_mode", enabled: !enabled });
				return enabled ? tNow("slash.cmd.fast.off") : tNow("slash.cmd.fast.on");
			});
		}),
	},
	{
		name: "slow",
		get title() { return tNow("slash.cmd.slow.title"); },
		get description() { return tNow("slash.cmd.slow.desc"); },
		icon: Gauge,
		group: "model",
		run: nativeOrForward(async (ctx) => {
			const enabled = ctx.live?.state?.slowModeEnabled === true;
			ctx.track("slow", tNow("slash.cmd.slow.tracking"), async () => {
				if (!ctx.live?.alive) await ensureLive(ctx.sessionId);
				await ctx.rpcSend({ type: "set_slow_mode", enabled: !enabled });
				return enabled ? tNow("slash.cmd.slow.off") : tNow("slash.cmd.slow.on");
			});
		}),
	},
	{
		name: "advisor",
		get title() { return tNow("slash.cmd.advisor.title"); },
		get description() { return tNow("slash.cmd.advisor.desc"); },
		icon: Eye,
		group: "model",
		run: nativeOrForward((ctx) => ctx.openSettingsTarget("advisor")),
	},

	// ---- 状态 ----
	{
		name: "status",
		get title() { return tNow("slash.cmd.status.title"); },
		get description() { return tNow("slash.cmd.status.desc"); },
		icon: Activity,
		group: "status",
		run: async (ctx) => {
			const card = await buildStatusCard(ctx);
			ctx.pushOutput("status", card);
		},
	},
	{
		name: "context",
		get title() { return tNow("slash.cmd.context.title"); },
		get description() { return tNow("slash.cmd.context.desc"); },
		icon: Layers,
		group: "status",
		run: (ctx) => ctx.openContextPopover(),
	},
	{
		name: "usage",
		get title() { return tNow("slash.cmd.usage.title"); },
		get description() { return tNow("slash.cmd.usage.desc"); },
		icon: ChartPie,
		group: "status",
		run: nativeOrForward((ctx) => ctx.openSettingsTarget("quota")),
	},
	{
		name: "tools",
		get title() { return tNow("slash.cmd.tools.title"); },
		get description() { return tNow("slash.cmd.tools.desc"); },
		icon: Wrench,
		group: "status",
		run: sendAsPrompt,
	},
	{
		name: "jobs",
		get title() { return tNow("slash.cmd.jobs.title"); },
		get description() { return tNow("slash.cmd.jobs.desc"); },
		icon: ListChecks,
		group: "status",
		run: sendAsPrompt,
	},
	{
		name: "stats",
		get title() { return tNow("slash.cmd.stats.title"); },
		get description() { return tNow("slash.cmd.stats.desc"); },
		icon: ChartPie,
		group: "status",
		run: () => useChatUi.getState().setStatsOpen(true),
	},

	// ---- 集成 ----
	{
		name: "mcp",
		get title() { return tNow("slash.cmd.mcp.title"); },
		get description() { return tNow("slash.cmd.mcp.desc"); },
		icon: Cable,
		group: "integration",
		get argHint() { return tNow("slash.subcommandHint"); },
		run: (ctx) => {
			if (ctx.args.trim()) return sendAsPrompt(ctx);
			ctx.openSettingsTarget("mcp");
			return undefined;
		},
	},
	{
		name: "plugins",
		aliases: ["plugin", "marketplace"],
		get title() { return tNow("slash.cmd.plugins.title"); },
		get description() { return tNow("slash.cmd.plugins.desc"); },
		icon: Puzzle,
		group: "integration",
		run: nativeOrForward((ctx) => ctx.openSettingsTarget("plugins")),
	},
	{
		name: "memory",
		get title() { return tNow("slash.cmd.memory.title"); },
		get description() { return tNow("slash.cmd.memory.desc"); },
		icon: Database,
		group: "integration",
		run: nativeOrForward((ctx) => ctx.openSettingsTarget("memory")),
	},
	{
		name: "browser",
		get title() { return tNow("slash.cmd.browser.title"); },
		get description() { return tNow("slash.cmd.browser.desc"); },
		icon: Globe,
		group: "integration",
		run: nativeOrForward((ctx) => ctx.openSettingsTarget("browser")),
	},
	{
		name: "computer",
		get title() { return tNow("slash.cmd.computer.title"); },
		get description() { return tNow("slash.cmd.computer.desc"); },
		icon: Monitor,
		group: "integration",
		run: nativeOrForward((ctx) => ctx.openSettingsTarget("computerUse")),
	},
	{
		name: "extended-context",
		get title() { return tNow("slash.cmd.extendedContext.title"); },
		get description() { return tNow("slash.cmd.extendedContext.desc"); },
		icon: Expand,
		group: "integration",
		run: nativeOrForward((ctx) => ctx.openSettingsTarget("extendedContext")),
	},

	// ---- 设置 ----
	{
		name: "agents",
		get title() { return tNow("slash.cmd.agents.title"); },
		get description() { return tNow("slash.cmd.agents.desc"); },
		icon: Bot,
		group: "settings",
		settingsTarget: "subagents",
		run: (ctx) => ctx.openSettingsTarget("subagents"),
	},
	{
		name: "approvals",
		get title() { return tNow("slash.cmd.approvals.title"); },
		get description() { return tNow("slash.cmd.approvals.desc"); },
		icon: ShieldCheck,
		group: "settings",
		settingsTarget: "approvals",
		run: (ctx) => ctx.openSettingsTarget("approvals"),
	},
	{
		name: "login",
		get title() { return tNow("slash.cmd.login.title"); },
		get description() { return tNow("slash.cmd.login.desc"); },
		icon: KeyRound,
		group: "settings",
		settingsTarget: "providers",
		run: (ctx) => ctx.openSettingsTarget("providers"),
	},
	{
		name: "settings",
		get title() { return tNow("slash.cmd.settings.title"); },
		get description() { return tNow("slash.cmd.settings.desc"); },
		icon: Settings,
		group: "settings",
		run: (ctx) => ctx.openSettings(),
	},

	// ---- 更多 OMP 命令 (registry mirrors so they get Chinese labels; the
	// same-named dynamic omp commands are shadowed) ----
	{
		name: "init",
		get title() { return tNow("slash.cmd.init.title"); },
		get description() { return tNow("slash.cmd.init.desc"); },
		icon: Sparkles,
		group: "omp",
		run: sendAsPrompt,
	},
	{
		name: "share",
		get title() { return tNow("slash.cmd.share.title"); },
		get description() { return tNow("slash.cmd.share.desc"); },
		icon: Share2,
		group: "omp",
		// Same flow as CenterHeader's 分享链接: confirm, sessionShare, copy.
		run: async (ctx) => {
			const ok = await confirmDialog(
				tNow("slash.cmd.share.confirmMessage"),
				{ title: tNow("slash.cmd.share.confirmTitle"), okLabel: tNow("slash.cmd.share.confirmOk") },
			);
			if (!ok) throw new SlashAbort();
			ctx.track("share", tNow("slash.cmd.share.tracking"), async () => {
				const url = await sessionShare(ctx.sessionId);
				await copyText(url);
				return tNow("slash.cmd.share.result", { url });
			});
		},
	},
	{
		name: "review",
		get title() { return tNow("slash.cmd.review.title"); },
		get description() { return tNow("slash.cmd.review.desc"); },
		icon: ClipboardCheck,
		group: "omp",
		get argHint() { return tNow("slash.cmd.review.argHint"); },
		run: sendAsPrompt,
	},
	{
		name: "changelog",
		get title() { return tNow("slash.cmd.changelog.title"); },
		get description() { return tNow("slash.cmd.changelog.desc"); },
		icon: ScrollText,
		group: "omp",
		// omp's changelog text has no transcript-less GUI surface; the About
		// section is the app's version/update surface.
		run: nativeOrForward((ctx) => ctx.openSettingsTarget("about")),
	},
	{
		name: "security",
		get title() { return tNow("slash.cmd.security.title"); },
		get description() { return tNow("slash.cmd.security.desc"); },
		icon: ShieldAlert,
		group: "omp",
		run: sendAsPrompt,
	},
	// ---- 技能 ----
	{
		name: "skill:visualize",
		aliases: ["visualize"],
		get title() { return tNow("slash.cmd.visualize.title"); },
		get description() { return tNow("slash.cmd.visualize.desc"); },
		icon: ChartColumn,
		group: "skill",
		get argHint() { return tNow("slash.cmd.visualize.argHint"); },
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
