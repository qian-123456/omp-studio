/** [B] Codex-style quiet turn footer: one row of ghost icon buttons
 * (always visible on the latest turn, hover-reveal otherwise) with the answer
 * time on hover right after the icons; details in tooltips — no inline meta text,
 * no colored pills. */

import { Copy, FileDiff, GitCommitHorizontal, RotateCcw, Share } from "lucide-react";
import { useMemo, useState } from "react";
import type { TurnCheckpoint } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { gitUndoTurn } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useTurnNav } from "../../stores/turnNav";
import { useUi } from "../../stores/ui";
import { startFork } from "../sessions/forkDraft";
import { canUndoTurn, undoCascade } from "./turnChips";

/** Tiny status letters in the changed-files list; color only on the letter. */
const STATUS_LETTER_STYLE: Record<string, string> = {
	A: "text-[var(--status-success)]",
	M: "text-[var(--status-warning)]",
	D: "text-[var(--status-error)]",
};

/** Codex's "Branch in new chat" glyph (app-initial `KW`), verbatim path. */
const BranchIcon = () => (
	<svg width={13} height={13} viewBox="0 0 20 20" fill="currentColor" aria-hidden>
		<path d="M15.8 11.535c.367 0 .665.298.665.665v5a.665.665 0 0 1-.665.665h-5a.665.665 0 1 1 0-1.33h3.394l-3.565-3.564a.666.666 0 0 1 .942-.942l3.564 3.565V12.2c0-.367.298-.665.665-.665Zm0-9.4c.367 0 .665.298.665.665v5a.665.665 0 0 1-1.33 0V4.405l-5.128 5.128c-.323.324-.558.565-.842.74a2.668 2.668 0 0 1-.771.319c-.324.078-.662.073-1.12.073H1.93a.665.665 0 1 1 0-1.33h5.345c.52 0 .673-.005.809-.037.136-.033.266-.086.385-.16.12-.072.23-.177.598-.545l5.128-5.128H10.8a.665.665 0 0 1 0-1.33h5Z" />
	</svg>
);

/**
 * Confirm, then roll back `cascade` (target turn + every later non-undone
 * turn, newest first). The newest turn keeps the original single-turn
 * wording; an older turn's dialog spells out the whole cascade.
 */
async function undoTurn(
	cwd: string,
	sessionFile: string,
	turn: TurnCheckpoint,
	cascade: TurnCheckpoint[],
): Promise<boolean> {
	const laterCount = Math.max(0, cascade.length - 1);
	const total = cascade.length;
	const fileCount = new Set(cascade.flatMap((t) => t.files.map((f) => f.path)))
		.size;

	let title = "撤回这一轮";
	let okLabel = "撤回";
	let message: string;
	if (laterCount === 0) {
		const n = turn.files.length;
		message =
			n > 0
				? `撤回这一轮？这 ${n} 个文件会回到这一轮开始前的样子（这一轮新建的文件会被删除）。Agent 下一轮会收到通知。`
				: "撤回这一轮？Agent 下一轮会收到通知。";
	} else {
		title = `撤回 ${total} 轮`;
		okLabel = `撤回这 ${total} 轮`;
		message =
			`撤回这一轮会连带撤回之后的 ${laterCount} 轮，共 ${total} 轮、` +
			`${fileCount} 个文件会回到这一轮开始前的样子（这些轮次里新建的文件会被删除），` +
			`这一轮之后的文件工作都会丢失。Agent 下一轮会收到通知。`;
	}
	const ok = await confirmDialog(message, { title, danger: true, okLabel });
	if (!ok) return false;
	try {
		let res = await gitUndoTurn(cwd, sessionFile, turn.turnId, false);
		if (res.conflicts.length > 0) {
			const ok2 = await confirmDialog(
				laterCount === 0
					? `这些文件在这一轮之后又被改过，继续撤回会丢掉后来的修改：\n${res.conflicts.join("\n")}`
					: `这些文件在要撤回的 ${total} 轮之后又被改过，继续撤回会丢掉后来的修改：\n${res.conflicts.join("\n")}`,
				{ title, danger: true, okLabel: "仍然撤回" },
			);
			if (!ok2) return false;
			res = await gitUndoTurn(cwd, sessionFile, turn.turnId, true);
			if (res.conflicts.length > 0) {
				toast.error(`撤回失败：${res.conflicts.join("、")} 已无法恢复`);
				return false;
			}
		}
		const undone = res.turnsUndone || total;
		const parts: string[] = [
			undone === 1 ? "已撤回这一轮" : `已撤回 ${undone} 轮`,
		];
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
	turns,
	sessionWorking,
	onDoneUndo,
	answerText,
	answerTime,
	answerItemId,
}: {
	sessionId: string;
	cwd: string;
	sessionFile: string;
	turnCheckpoint?: TurnCheckpoint;
	/** All session checkpoints (oldest first) — the undo cascade of an older
	 * turn also rolls back every later non-undone turn. */
	turns?: TurnCheckpoint[];
	sessionWorking?: boolean;
	onDoneUndo?: () => void;
	/** Accepted for contract stability; no longer rendered (duration lives
	 * in ExecutionDisclosure). */
	completionTime?: string | number | null;
	durationMs?: number;
	model?: string | null;
	answerText?: string;
	/** Answer timestamp (HH:mm), always visible at the row's left end. */
	answerTime?: string;
	/** Id of the answer transcript item; enables the share-as-image button. */
	answerItemId?: string;
}) {
	const [filesOpen, setFilesOpen] = useState(false);
	const [undoBusy, setUndoBusy] = useState(false);

	const commit = turnCheckpoint?.commits?.[0];
	const undoable =
		turnCheckpoint !== undefined &&
		canUndoTurn(turnCheckpoint, sessionWorking === true);
	const cascade = useMemo(
		() =>
			turnCheckpoint && turns ? undoCascade(turns, turnCheckpoint) : undefined,
		[turns, turnCheckpoint],
	);
	const cascadeLater = cascade ? Math.max(0, cascade.length - 1) : 0;
	const iconBtn =
		"flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]";

	return (
		<div className="mt-1.5 flex min-h-5 w-full flex-col gap-1 text-[11px] text-[var(--text-30)]">
			<div className="flex items-center gap-0.5">
				{/* Answer time: fixed at the row's left edge so it stays put whether or
				 * not the (hover-only) icon buttons after it are showing. */}
				{answerTime && (
					<span
						className="mr-1.5 shrink-0 self-center tabular-nums leading-5"
						title="回复时间"
					>
						{answerTime}
					</span>
				)}
				<div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/answer:opacity-100 focus-within:opacity-100">
				{turnCheckpoint && (
					<>
						{turnCheckpoint.undone && (
							<span className="px-1 leading-none">已撤回</span>
						)}

						{!turnCheckpoint.undone && turnCheckpoint.files.length > 0 && (
							<button
								type="button"
								onClick={() => setFilesOpen((v) => !v)}
								className={
									iconBtn + (filesOpen ? " bg-[var(--ghost-hover)] text-[var(--text)]" : "")
								}
								aria-expanded={filesOpen}
								title={
									filesOpen
										? "收起改动文件"
										: `这一轮改了 ${turnCheckpoint.files.length} 个文件，点击查看`
								}
								aria-label={`改了 ${turnCheckpoint.files.length} 个文件`}
							>
								<FileDiff size={12} />
							</button>
						)}

						{!turnCheckpoint.undone && commit && (
							<button
								type="button"
								onClick={() => useTurnNav.getState().showCommit(cwd, commit)}
								className={iconBtn}
								title={`已存档 ${commit.slice(0, 7)} · 在版本历史里查看`}
								aria-label={`已存档 ${commit.slice(0, 7)}`}
							>
								<GitCommitHorizontal size={12} />
							</button>
						)}

						{undoable && (
							<button
								type="button"
								disabled={undoBusy}
								onClick={() => {
									setUndoBusy(true);
									void undoTurn(
										cwd,
										sessionFile,
										turnCheckpoint,
										cascade ?? [turnCheckpoint],
									).then((done) => {
										setUndoBusy(false);
										if (done) onDoneUndo?.();
									});
								}}
								className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-50"
								title={
									undoBusy
										? "正在撤回…"
										: cascadeLater > 0
											? `撤回这一轮：工作区回到这一轮开始前的样子，之后的 ${cascadeLater} 轮也会被一并撤回`
											: "撤回这一轮：把改动的文件恢复回这一轮开始前的样子"
								}
								aria-label="撤回这一轮"
							>
								<RotateCcw size={12} />
							</button>
						)}
					</>
				)}

				{/* Copy / fork ghost icon buttons */}
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
							className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
							title="复制回复"
							aria-label="复制回复"
						>
							<Copy size={12} />
						</button>
					)}

					<button
						type="button"
						onClick={() => void startFork(sessionId, answerItemId)}
						className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						title="从此回复分支出新会话"
						aria-label="从此回复分支出新会话"
					>
						<BranchIcon />
					</button>

					{answerItemId && answerText && (
						<button
							type="button"
							onClick={() =>
								useUi
									.getState()
									.openModal("share-image", { sessionId, itemIds: [answerItemId] })
							}
							className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
							title="分享为图片"
							aria-label="分享为图片"
						>
							<Share size={12} />
						</button>
					)}
				</div>

			</div>

			{/* Expandable changed-files list — status letter carries the color */}
			{filesOpen &&
				turnCheckpoint &&
				!turnCheckpoint.undone &&
				turnCheckpoint.files.length > 0 && (
					<ul className="mt-1 w-full max-w-md space-y-px rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] p-2">
						{turnCheckpoint.files.map((f) => (
							<li
								key={f.path}
								className="flex items-center gap-1.5 text-[11px] leading-4"
							>
								<span
									className={`shrink-0 font-mono ${STATUS_LETTER_STYLE[f.status] ?? "text-[var(--text-40)]"}`}
								>
									{f.status}
								</span>
								<span
									className="truncate font-mono text-[var(--text-40)]"
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
