import {
	ChevronRight,
	Copy,
	GitFork,
	RotateCcw,
	Save,
} from "lucide-react";
import { useState } from "react";
import type { TurnCheckpoint } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { createSideChat, gitUndoTurn } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useTurnNav } from "../../stores/turnNav";
import { useUi } from "../../stores/ui";
import { formatDurationChinese, formatShortModel } from "./turnGrouping";

const STATUS_STYLE: Record<string, string> = {
	A: "text-emerald-400",
	M: "text-amber-400",
	D: "text-rose-400",
};

const STATUS_LABEL: Record<string, string> = {
	A: "新建",
	M: "修改",
	D: "删除",
};

async function undoTurn(
	cwd: string,
	sessionFile: string,
	turn: TurnCheckpoint,
): Promise<boolean> {
	const n = turn.files.length;
	const ok = await confirmDialog(
		n > 0
			? `撤回这一轮？这 ${n} 个文件会回到这一轮开始前的样子（这一轮新建的文件会被删除）。Agent 下一轮会收到通知。`
			: "撤回这一轮？Agent 下一轮会收到通知。",
		{ title: "撤回这一轮", danger: true, okLabel: "撤回" },
	);
	if (!ok) return false;
	try {
		let res = await gitUndoTurn(cwd, sessionFile, turn.turnId, false);
		if (res.conflicts.length > 0) {
			const ok2 = await confirmDialog(
				`这些文件在这一轮之后又被改过，继续撤回会丢掉后来的修改：\n${res.conflicts.join("\n")}`,
				{ title: "撤回这一轮", danger: true, okLabel: "仍然撤回" },
			);
			if (!ok2) return false;
			res = await gitUndoTurn(cwd, sessionFile, turn.turnId, true);
			if (res.conflicts.length > 0) {
				toast.error(`撤回失败：${res.conflicts.join("、")} 已无法恢复`);
				return false;
			}
		}
		const parts: string[] = ["已撤回这一轮"];
		if (res.restored.length > 0)
			parts.push(`恢复 ${res.restored.length} 个文件`);
		if (res.deleted.length > 0)
			parts.push(`删除 ${res.deleted.length} 个新建文件`);
		if (res.headReset) parts.push("版本历史已回退");
		if (res.warning) parts.push(res.warning);
		toast.success(parts.join("，"), 6000);
		return true;
	} catch (e) {
		toast.error(`撤回失败: ${errMsg(e)}`);
		return false;
	}
}

export function AnswerFooter({
	sessionId,
	cwd,
	sessionFile,
	turnCheckpoint,
	canUndo,
	onDoneUndo,
	completionTime,
	durationMs,
	model,
	answerText,
}: {
	sessionId: string;
	cwd: string;
	sessionFile: string;
	turnCheckpoint?: TurnCheckpoint;
	canUndo?: boolean;
	onDoneUndo?: () => void;
	completionTime?: string | number | null;
	durationMs?: number;
	model?: string | null;
	answerText?: string;
}) {
	const [filesOpen, setFilesOpen] = useState(false);
	const [undoBusy, setUndoBusy] = useState(false);

	// Format completion time to e.g. "14:32"
	let formattedTime = "";
	if (completionTime) {
		try {
			const d =
				typeof completionTime === "number"
					? new Date(completionTime)
					: new Date(completionTime);
			if (!isNaN(d.getTime())) {
				formattedTime = d.toLocaleTimeString([], {
					hour: "2-digit",
					minute: "2-digit",
					hour12: false,
				});
			}
		} catch {
			// ignore formatting error
		}
	}

	const durationStr = durationMs ? formatDurationChinese(durationMs) : "";
	const shortModel = formatShortModel(model);
	const commit = turnCheckpoint?.commits?.[0];

	return (
		<div className="group/footer mt-2 flex flex-col gap-1 text-[11px] text-neutral-500">
			<div className="flex flex-wrap items-center justify-between gap-2">
				{/* Metadata & Checkpoint Chips */}
				<div className="flex flex-wrap items-center gap-1.5 leading-none">
					{formattedTime && (
						<span className="font-mono text-neutral-500" title={`完成时间 ${formattedTime}`}>
							{formattedTime}
						</span>
					)}

					{durationStr && (
						<>
							<span className="text-neutral-700">·</span>
							<span className="text-neutral-500" title={`耗时 ${durationStr}`}>
								{durationStr}
							</span>
						</>
					)}

					{shortModel && (
						<>
							<span className="text-neutral-700">·</span>
							<span className="text-neutral-500" title={`模型: ${model}`}>
								{shortModel}
							</span>
						</>
					)}

					{/* Git Checkpoint Status */}
					{turnCheckpoint && (
						<>
							{turnCheckpoint.undone && (
								<span className="rounded hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-500">
									已撤回
								</span>
							)}

							{!turnCheckpoint.undone && commit && (
								<button
									type="button"
									onClick={() => useTurnNav.getState().showCommit(cwd, commit)}
									className="press-scale flex items-center gap-1 rounded hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
									title="在版本历史里查看这一轮存档"
								>
									<Save size={10} />
									<span>已存档</span>
									<span className="font-mono">{commit.slice(0, 7)}</span>
								</button>
							)}

							{!turnCheckpoint.undone && turnCheckpoint.files.length > 0 && (
								<button
									type="button"
									onClick={() => setFilesOpen((v) => !v)}
									className="press-scale flex items-center gap-1 rounded hairline bg-[var(--bg-active-fill)] px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
									title={filesOpen ? "收起改动文件" : "查看这一轮改动的文件"}
								>
									<ChevronRight
										size={10}
										className={filesOpen ? "rotate-90 transition-transform" : "transition-transform"}
									/>
									<span>改了 {turnCheckpoint.files.length} 个文件</span>
								</button>
							)}

							{canUndo && !turnCheckpoint.undone && (
								<button
									type="button"
									disabled={undoBusy}
									onClick={() => {
										setUndoBusy(true);
										void undoTurn(cwd, sessionFile, turnCheckpoint).then((done) => {
											setUndoBusy(false);
											if (done) onDoneUndo?.();
										});
									}}
									className="press-scale flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-rose-400/90 hover:bg-rose-500/10 hover:text-rose-300 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
									title="把这一轮改动的文件恢复回这一轮开始前的样子"
								>
									<RotateCcw size={10} />
									<span>{undoBusy ? "正在撤回…" : "撤回这一轮"}</span>
								</button>
							)}
						</>
					)}
				</div>

				{/* Copy / Fork Actions (subtle on hover) */}
				<div className="flex items-center gap-0.5 opacity-0 group-hover/footer:opacity-100 focus-within:opacity-100 transition-opacity">
					{answerText && (
						<button
							type="button"
							onClick={async () => {
								try {
									await copyText(answerText);
									toast.success("回复已复制");
								} catch (e) {
									toast.error(`复制失败: ${errMsg(e)}`);
								}
							}}
							className="press-scale flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
							title="复制回复"
							aria-label="复制回复"
						>
							<Copy size={12} />
						</button>
					)}

					<button
						type="button"
						onClick={async () => {
							try {
								const snippet = answerText ? answerText.slice(0, 60) : "";
								const prompt = snippet ? `基于回复继续：${snippet}…` : "分叉侧聊";
								const info = await createSideChat(sessionId, prompt, answerText || undefined);
								void useSessions.getState().load().catch(() => {});
								useUi.getState().setRightTab("sidechat");
								useUi.getState().selectSession(info.sessionId);
								toast.success("已分叉到侧聊");
							} catch (e) {
								toast.error(`分叉失败: ${errMsg(e)}`);
							}
						}}
						className="press-scale flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
						title="分叉此回复到侧聊"
						aria-label="分叉此回复到侧聊"
					>
						<GitFork size={12} />
					</button>
				</div>
			</div>

			{/* Expandable Files Changed List */}
			{filesOpen && turnCheckpoint && !turnCheckpoint.undone && turnCheckpoint.files.length > 0 && (
				<ul className="mt-1 w-full max-w-md space-y-px rounded-lg hairline bg-[var(--bg-panel)] p-2">
					{turnCheckpoint.files.map((f) => (
						<li
							key={f.path}
							className="flex items-center gap-1.5 text-[10px] leading-4"
						>
							<span
								className={`shrink-0 font-mono ${STATUS_STYLE[f.status] ?? "text-neutral-400"}`}
							>
								{STATUS_LABEL[f.status] ?? f.status}
							</span>
							<span
								className="truncate font-mono text-neutral-400"
								title={f.path}
							>
								{f.path}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
