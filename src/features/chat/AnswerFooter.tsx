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
import { tNow } from "../../stores/language";

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

	let title = tNow("chat.undo.titleSingle");
	let okLabel = tNow("chat.undo.okSingle");
	let message: string;
	if (laterCount === 0) {
		const n = turn.files.length;
		message =
			n > 0
				? tNow("chat.undo.msgSingleWithFiles", { count: n })
				: tNow("chat.undo.msgSingleNoFiles");
	} else {
		title = tNow("chat.undo.titleMulti", { count: total });
		okLabel = tNow("chat.undo.okMulti", { count: total });
		message = tNow("chat.undo.msgCascade", { laterCount, total, fileCount });
	}
	const ok = await confirmDialog(message, { title, danger: true, okLabel });
	if (!ok) return false;
	try {
		let res = await gitUndoTurn(cwd, sessionFile, turn.turnId, false);
		if (res.conflicts.length > 0) {
			const ok2 = await confirmDialog(
				laterCount === 0
					? tNow("chat.undo.conflictSingle", { conflicts: res.conflicts.join("\n") })
					: tNow("chat.undo.conflictMulti", { total, conflicts: res.conflicts.join("\n") }),
				{ title, danger: true, okLabel: tNow("chat.undo.stillUndo") },
			);
			if (!ok2) return false;
			res = await gitUndoTurn(cwd, sessionFile, turn.turnId, true);
			if (res.conflicts.length > 0) {
				toast.error(tNow("chat.undo.conflictFailed", { files: res.conflicts.join("、") }));
				return false;
			}
		}
		const undone = res.turnsUndone || total;
		const parts: string[] = [
			undone === 1 ? tNow("chat.undo.doneSingle") : tNow("chat.undo.doneMulti", { count: undone }),
		];
		if (res.restored.length > 0)
			parts.push(tNow("chat.undo.restoredFiles", { count: res.restored.length }));
		if (res.deleted.length > 0)
			parts.push(tNow("chat.undo.deletedFiles", { count: res.deleted.length }));
		if (res.headReset) parts.push(tNow("chat.undo.headReset"));
		if (res.warning) parts.push(res.warning);
		toast.success(parts.join("，"), 6000);
		return true;
	} catch (e) {
		toast.error(tNow("chat.undo.failed", { error: errMsg(e) }));
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
	compact,
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
	/** Only the undo / changed-files / commit / fork controls (no copy or share);
	 * used under a stopped turn that has no answer text. */
	compact?: boolean;
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
						title={tNow("chat.message.responseTime")}
					>
						{answerTime}
					</span>
				)}
				{turnCheckpoint?.undone && (
					<span className="mr-1.5 shrink-0 self-center px-1 leading-5" title={tNow("chat.undo.undoneTitle")}>
						{tNow("chat.undo.undoneBadge")}
					</span>
				)}
				<div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover/answer:opacity-100 focus-within:opacity-100">
				{turnCheckpoint && (
					<>

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
										? tNow("chat.undo.collapseFiles")
										: tNow("chat.undo.changedFilesCount", { count: turnCheckpoint.files.length })
								}
								aria-label={tNow("chat.undo.changedFilesAria", { count: turnCheckpoint.files.length })}
							>
								<FileDiff size={12} />
							</button>
						)}

						{!turnCheckpoint.undone && commit && (
							<button
								type="button"
								onClick={() => useTurnNav.getState().showCommit(cwd, commit)}
								className={iconBtn}
								title={tNow("chat.undo.archivedCommit", { commit: commit.slice(0, 7) })}
								aria-label={tNow("chat.undo.archivedCommitAria", { commit: commit.slice(0, 7) })}
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
										? tNow("chat.undo.undoing")
										: cascadeLater > 0
											? tNow("chat.undo.cascadeTooltip", { laterCount: cascadeLater })
											: tNow("chat.undo.singleTooltip")
								}
								aria-label={tNow("chat.undo.btnAria")}
							>
								<RotateCcw size={12} />
							</button>
						)}
					</>
				)}

				{/* Copy / fork ghost icon buttons */}
					{!compact && answerText && (
						<button
							type="button"
							onClick={async () => {
								try {
									await copyText(answerText);
									toast.success(tNow("chat.undo.replyCopied"));
								} catch (e) {
									toast.error(tNow("chat.message.copyFailed", { error: errMsg(e) }));
								}
							}}
							className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
							title={tNow("chat.undo.copyReply")}
							aria-label={tNow("chat.undo.copyReply")}
						>
							<Copy size={12} />
						</button>
					)}

					<button
						type="button"
						onClick={() => void startFork(sessionId, answerItemId)}
						className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
						title={tNow("chat.undo.forkSession")}
						aria-label={tNow("chat.undo.forkSession")}
					>
						<BranchIcon />
					</button>

					{!compact && answerItemId && answerText && (
						<button
							type="button"
							onClick={() =>
								useUi
									.getState()
									.openModal("share-image", { sessionId, itemIds: [answerItemId] })
							}
							className="flex h-5 w-5 items-center justify-center rounded text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text)]"
							title={tNow("chat.undo.shareImage")}
							aria-label={tNow("chat.undo.shareImage")}
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
									className="min-w-0 break-all font-mono text-[var(--text-40)]"
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
