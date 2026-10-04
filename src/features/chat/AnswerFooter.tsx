/** [B] Codex-style quiet turn footer: one row of ghost icon buttons
 * (always visible on the latest turn, hover-reveal otherwise), details in
 * tooltips — no inline meta text, no colored pills. */

import { Copy, FileDiff, GitCommitHorizontal, RotateCcw } from "lucide-react";
import { useState } from "react";
import type { TurnCheckpoint } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { createSideChat, gitUndoTurn } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useTurnNav } from "../../stores/turnNav";
import { useUi } from "../../stores/ui";

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
	answerText,
	isLatestTurn,
}: {
	sessionId: string;
	cwd: string;
	sessionFile: string;
	turnCheckpoint?: TurnCheckpoint;
	canUndo?: boolean;
	onDoneUndo?: () => void;
	/** Accepted for contract stability; no longer rendered (duration lives
	 * in ExecutionDisclosure). */
	completionTime?: string | number | null;
	durationMs?: number;
	model?: string | null;
	answerText?: string;
	/** Always-visible footer on the newest turn (Codex shows it without hover). */
	isLatestTurn?: boolean;
}) {
	const [filesOpen, setFilesOpen] = useState(false);
	const [undoBusy, setUndoBusy] = useState(false);

	const commit = turnCheckpoint?.commits?.[0];
	const iconBtn =
		"flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]";

	return (
		<div
			className={
				"mt-1.5 flex min-h-5 flex-col gap-1 text-[11px] text-[var(--text-30)] " +
				(isLatestTurn
					? "opacity-100"
					: "opacity-0 transition-opacity group-hover/answer:opacity-100 focus-within:opacity-100")
			}
		>
			<div className="flex items-center gap-0.5">
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

						{canUndo && !turnCheckpoint.undone && (
							<button
								type="button"
								disabled={undoBusy}
								onClick={() => {
									setUndoBusy(true);
									void undoTurn(cwd, sessionFile, turnCheckpoint).then(
										(done) => {
											setUndoBusy(false);
											if (done) onDoneUndo?.();
										},
									);
								}}
								className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-50"
								title={
									undoBusy
										? "正在撤回…"
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
						onClick={async () => {
							try {
								const snippet = answerText ? answerText.slice(0, 60) : "";
								const prompt = snippet
									? `基于回复继续：${snippet}…`
									: "分叉侧聊";
								const info = await createSideChat(
									sessionId,
									prompt,
									answerText || undefined,
								);
								void useSessions.getState().load().catch(() => {});
								useUi.getState().setRightTab("sidechat");
								useUi.getState().selectSession(info.sessionId);
								toast.success("已分叉到侧聊");
							} catch (e) {
								toast.error(`分叉失败: ${errMsg(e)}`);
							}
						}}
						className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						title="分叉此回复到侧聊"
						aria-label="分叉此回复到侧聊"
					>
						<BranchIcon />
					</button>
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
