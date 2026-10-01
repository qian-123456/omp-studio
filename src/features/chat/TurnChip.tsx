/** [B] Compact chip rendered at the end of a checkpointed agent turn:
 * files changed, commits saved, and 「撤回这一轮」 on the newest turn.
 * Neutral tertiary text — status color only on the per-file letter. */
import { ChevronRight, RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import type { TurnCheckpoint } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { gitUndoTurn } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useTurnNav } from "../../stores/turnNav";

const STATUS_LETTER_STYLE: Record<string, string> = {
	A: "text-[var(--status-success)]",
	M: "text-[var(--status-warning)]",
	D: "text-[var(--status-error)]",
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

export function TurnChip({
	turn,
	cwd,
	sessionFile,
	canUndo,
	onDone,
}: {
	turn: TurnCheckpoint;
	cwd: string;
	sessionFile: string;
	/** Newest turn + restorable + session idle. */
	canUndo: boolean;
	/** Re-fetch checkpoints after a state change (undo). */
	onDone: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const commit = turn.commits[0];

	const rowCls =
		"flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--text-60)]";

	return (
		<div className="flex flex-col items-start gap-0.5">
			<div className="flex flex-wrap items-center gap-1">
				{turn.undone && (
					<span className="px-1.5 py-0.5 text-[11px] text-[var(--text-30)]">
						已撤回
					</span>
				)}
				{!turn.undone && turn.files.length > 0 && (
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						className={rowCls}
						title={open ? "收起这一轮改动的文件列表" : "查看这一轮改动的文件"}
					>
						<ChevronRight
							size={11}
							className={open ? "rotate-90 transition-transform" : "transition-transform"}
						/>
						<span>改了 {turn.files.length} 个文件</span>
					</button>
				)}
				{!turn.undone && commit && (
					<button
						type="button"
						onClick={() => useTurnNav.getState().showCommit(cwd, commit)}
						className={rowCls}
						title="在版本历史里查看这一轮存下的改动"
					>
						<Save size={11} />
						<span>
							已存档{" "}
							<span className="font-mono">{commit.slice(0, 7)}</span>
						</span>
					</button>
				)}
				{canUndo && (
					<button
						type="button"
						disabled={busy}
						onClick={() => {
							setBusy(true);
							void undoTurn(cwd, sessionFile, turn).then((done) => {
								setBusy(false);
								if (done) onDone();
							});
						}}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--text-30)] transition-colors hover:bg-[var(--ghost-hover)] hover:text-[var(--status-error)] disabled:cursor-not-allowed disabled:opacity-50"
						title="把这一轮改动的文件恢复回这一轮开始前的样子"
					>
						<RotateCcw size={11} />
						<span>{busy ? "正在撤回…" : "撤回这一轮"}</span>
					</button>
				)}
			</div>
			{open && !turn.undone && turn.files.length > 0 && (
				<ul className="mt-0.5 w-full max-w-md space-y-px rounded-[10px] border border-[var(--line)] bg-[var(--well-bg)] px-2 py-1">
					{turn.files.map((f) => (
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
