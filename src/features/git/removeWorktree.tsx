import { AlertTriangle, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { WorktreeInfo } from "../../lib/contracts";
import { gitRemoveWorktree } from "../../lib/ipc";

interface ModalProps {
	wt: WorktreeInfo;
	onResolve: (res: { force: boolean; deleteBranch: boolean } | null) => void;
}

function RemoveWorktreeModal({ wt, onResolve }: ModalProps) {
	const [force, setForce] = useState(false);
	const [deleteBranch, setDeleteBranch] = useState(Boolean(wt.branch));

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				onResolve(null);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onResolve]);

	const canConfirm = !wt.dirty || force;

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onResolve(null);
			}}
		>
			<div
				className="w-[440px] rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-300 shadow-xl"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="mb-3 flex items-center justify-between border-b border-neutral-800 pb-2">
					<div className="flex items-center gap-1.5 text-sm font-semibold text-neutral-100">
						<Trash2 size={16} className="text-rose-400" />
						<span>清理 Worktree</span>
					</div>
					<button
						type="button"
						title="关闭 (Esc)"
						onClick={() => onResolve(null)}
						className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
					>
						<X size={15} />
					</button>
				</div>

				<div className="mb-3 text-xs text-neutral-300">
					确定要清理以下工作区吗？
					<div className="mt-1 rounded bg-neutral-950 p-2 font-mono text-[11px] text-neutral-200 break-all select-all">
						{wt.path}
					</div>
					{wt.sessionIds.length > 0 && (
						<div className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-400">
							<AlertTriangle size={13} className="shrink-0" />
							<span>仍有 {wt.sessionIds.length} 个会话关联此工作区，清理后将自动归档这些会话。</span>
						</div>
					)}
				</div>

				<div className="mb-4 space-y-2 rounded border border-neutral-800 bg-neutral-950/50 p-2.5 text-xs">
					{wt.dirty && (
						<label className="flex items-start gap-2 cursor-pointer select-none text-rose-300">
							<input
								type="checkbox"
								checked={force}
								onChange={(e) => setForce(e.target.checked)}
								className="mt-0.5 rounded border-neutral-700 bg-neutral-900"
							/>
							<div>
								<div className="font-medium">强制放弃未提交改动</div>
								<div className="text-[11px] text-neutral-400">
									检测到该工作区有未提交的代码，必须勾选强制删除。
								</div>
							</div>
						</label>
					)}

					{wt.branch && (
						<label className="flex items-start gap-2 cursor-pointer select-none text-neutral-300">
							<input
								type="checkbox"
								checked={deleteBranch}
								onChange={(e) => setDeleteBranch(e.target.checked)}
								className="mt-0.5 rounded border-neutral-700 bg-neutral-900"
							/>
							<div>
								<div>联动删除分支</div>
								<div className="font-mono text-[11px] text-neutral-400">{wt.branch}</div>
							</div>
						</label>
					)}
				</div>

				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={() => onResolve(null)}
						className="rounded px-3 py-1.5 text-xs text-neutral-400 hover:bg-neutral-800"
					>
						取消
					</button>
					<button
						type="button"
						disabled={!canConfirm}
						onClick={() => onResolve({ force, deleteBranch })}
						className="rounded bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-40"
					>
						确认清理
					</button>
				</div>
			</div>
		</div>
	);
}

/**
 * Prompts the user with a single modal containing optional checkboxes:
 * - force: force discard uncommitted changes if dirty
 * - deleteBranch: delete associated branch if present
 */
export function promptRemoveWorktree(wt: WorktreeInfo): Promise<{ force: boolean; deleteBranch: boolean } | null> {
	return new Promise((resolve) => {
		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		const handleResolve = (res: { force: boolean; deleteBranch: boolean } | null) => {
			root.unmount();
			container.remove();
			resolve(res);
		};

		root.render(<RemoveWorktreeModal wt={wt} onResolve={handleResolve} />);
	});
}
/**
 * Interactive worktree cleanup with a single consolidated dialog.
 * Returns true when the worktree was removed.
 */
export async function removeWorktreeFlow(repo: string, wt: WorktreeInfo): Promise<boolean> {
	const choice = await promptRemoveWorktree(wt);
	if (!choice) return false;
	await gitRemoveWorktree(repo, wt.path, choice.deleteBranch, choice.force);
	return true;
}
