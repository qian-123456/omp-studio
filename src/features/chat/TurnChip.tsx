/** [B] Compact chip rendered at the end of a checkpointed agent turn:
 * files changed, commits saved, and 「撤回这一轮」 on the newest turn. */
import { ChevronRight, RotateCcw, Save } from "lucide-react";
import { useState } from "react";
import type { TurnCheckpoint } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { gitUndoTurn } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useTurnNav } from "../../stores/turnNav";

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

	return (
		<div className="flex flex-col items-start gap-0.5">
			<div className="flex flex-wrap items-center gap-1">
				{turn.undone && (
					<span className="rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] text-neutral-600">
						已撤回
					</span>
				)}
				{!turn.undone && turn.files.length > 0 && (
					<button
						type="button"
						onClick={() => setOpen((v) => !v)}
						className="press-scale flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
						title={open ? "收起这一轮改动的文件列表" : "查看这一轮改动的文件"}
					>
						<ChevronRight
							size={10}
							className={open ? "rotate-90 transition-transform" : "transition-transform"}
						/>
						<span>改了 {turn.files.length} 个文件</span>
					</button>
				)}
				{!turn.undone && commit && (
					<button
						type="button"
						onClick={() => useTurnNav.getState().showCommit(cwd, commit)}
						className="press-scale flex items-center gap-1 rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-0.5 text-[10px] text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200"
						title="在版本历史里查看这一轮存下的改动"
					>
						<Save size={10} />
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
						className="press-scale flex items-center gap-1 rounded-lg px-1.5 py-0.5 text-[10px] text-rose-300/90 transition-colors hover:bg-rose-500/10 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
						title="把这一轮改动的文件恢复回这一轮开始前的样子"
					>
						<RotateCcw size={10} />
						<span>{busy ? "正在撤回…" : "撤回这一轮"}</span>
					</button>
				)}
			</div>
			{open && !turn.undone && turn.files.length > 0 && (
				<ul className="mt-0.5 w-full max-w-md space-y-px rounded-lg hairline bg-[var(--bg-active-fill)] px-2 py-1">
					{turn.files.map((f) => (
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
