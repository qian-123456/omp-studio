/** [B] Right-panel "计划" tab: while the composer's plan mode is on it
 * renders the session's latest assistant answer — the produced plan — as
 * full markdown, with actions to execute it (plan mode off + execute
 * prompt) or leave plan mode. */

import { CheckCheck, Lightbulb, NotebookPen, X } from "lucide-react";
import { useMemo } from "react";
import { errMsg } from "../../lib/dialogs";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import { Markdown } from "./markdown";
import { sendPrompt } from "./send";

/** Latest assistant text in the transcript — the plan while plan mode is on. */
function useLatestAssistantText(sessionId: string | null): string | null {
	return useLive((s) => {
		const items = sessionId ? s.sessions[sessionId]?.items : undefined;
		if (!items) return null;
		for (let i = items.length - 1; i >= 0; i--) {
			const it = items[i];
			if (it.kind === "assistant" && typeof it.text === "string" && it.text.trim()) {
				return it.text;
			}
		}
		return null;
	});
}

export function PlanPanel() {
	const sessionId = useUi((s) => s.selectedSessionId);
	const planMode = useComposer((s) =>
		sessionId ? s.planModes[sessionId] === true : false,
	);
	const streaming = useLive((s) =>
		sessionId ? s.sessions[sessionId]?.streaming === true : false,
	);
	const planText = useLatestAssistantText(sessionId);
	const generating = planMode && streaming;

	const execute = async () => {
		if (!sessionId) return;
		useComposer.getState().setPlanMode(sessionId, false);
		try {
			await sendPrompt(
				sessionId,
				"计划已确认。请按照上面的计划开始执行。",
			);
		} catch (err) {
			toast.error(`执行计划失败: ${errMsg(err)}`);
		}
	};

	const exitPlanMode = () => {
		if (sessionId) useComposer.getState().setPlanMode(sessionId, false);
	};

	const body = useMemo(() => {
		if (!sessionId) {
			return <EmptyHint text="选择一个会话后，在这里查看规划模式生成的计划" />;
		}
		if (!planMode) {
			return <EmptyHint text="在输入框输入 /plan 或点击 + 菜单开启规划模式" />;
		}
		if (generating && !planText) {
			return <EmptyHint text="正在生成计划…" />;
		}
		if (!planText) {
			return <EmptyHint text="规划模式已开启：发送需求后，最新回复将作为计划显示在这里" />;
		}
		return <Markdown text={planText} sessionId={sessionId} />;
	}, [sessionId, planMode, generating, planText]);

	return (
		<div className="flex h-full flex-col">
			<div className="flex items-center justify-between gap-2 border-b border-[var(--border-divider)] px-3 py-2">
				<div className="flex min-w-0 items-center gap-1.5 text-[12px]">
					<NotebookPen size={13} className="shrink-0 text-amber-500" />
					<span className="truncate font-medium text-[var(--text)]">计划</span>
					{planMode ? (
						<span className="flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-px text-[10px] text-amber-600">
							<Lightbulb size={10} />
							规划模式
						</span>
					) : (
						<span className="shrink-0 text-[10px] text-[var(--text-40,var(--text-dim))]">未开启</span>
					)}
				</div>
				{planMode && (
					<div className="flex shrink-0 items-center gap-1">
						<button
							type="button"
							onClick={() => void execute()}
							disabled={!planText || generating}
							title="关闭规划模式并开始执行该计划"
							className="flex items-center gap-1 rounded-md bg-[var(--text)] px-2 py-1 text-[11px] font-medium text-[var(--bg)] transition-opacity hover:opacity-85 disabled:opacity-40"
						>
							<CheckCheck size={11} />
							执行计划
						</button>
						<button
							type="button"
							onClick={exitPlanMode}
							title="关闭规划模式"
							className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-[var(--text-60,var(--text-muted))] transition-colors hover:bg-[var(--ghost-hover,var(--bg-hover))] hover:text-[var(--text)]"
						>
							<X size={11} />
							退出
						</button>
					</div>
				)}
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-3">{body}</div>
		</div>
	);
}

function EmptyHint({ text }: { text: string }) {
	return (
		<div className="flex h-full items-center justify-center px-6 text-center text-[12px] leading-5 text-[var(--text-40,var(--text-dim))]">
			{text}
		</div>
	);
}
