import { AlertTriangle, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useT } from "../../stores/language";
import { mountPromptDialog } from "../../lib/dialogs";
import type { WorktreeInfo } from "../../lib/contracts";
import { gitRemoveWorktree } from "../../lib/ipc";
import { claimEscape } from "../../lib/escapeClaim";

interface ModalProps {
	wt: WorktreeInfo;
	onResolve: (res: { force: boolean; deleteBranch: boolean } | null) => void;
}

function RemoveWorktreeModal({ wt, onResolve }: ModalProps) {
	const { t } = useT();
	const [force, setForce] = useState(false);
	const [deleteBranch, setDeleteBranch] = useState(Boolean(wt.branch));

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				claimEscape(e);
				onResolve(null);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [onResolve]);

	const canConfirm = wt.dirty === 0 || force;

	return (
		<div
			className="fixed inset-0 z-(--z-modal) flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-6"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onResolve(null);
			}}
		>
			<div
				className="w-[440px] rounded-2xl bg-[var(--bg-panel)] p-5 text-neutral-300 shadow-apple-modal hairline"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="mb-3 flex items-center justify-between border-b border-[var(--border-divider)] pb-2">
					<div className="flex items-center gap-1.5 text-sm font-semibold text-neutral-100">
						<Trash2 size={16} className="text-rose-400" />
						<span>{t("worktree.remove.title")}</span>
					</div>
					<button
						type="button"
						title={t("worktree.remove.close")}
						aria-label={t("worktree.remove.close")}
						className="rounded-lg p-1 text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200 transition-colors"
					>
						<X size={15} />
					</button>
				</div>

				<div className="mb-3 text-xs text-neutral-300">
					{t("worktree.remove.confirmPrompt")}
					<div className="mt-1 rounded-lg bg-[var(--well-bg)] hairline p-2 font-mono text-[11px] text-neutral-200 break-all select-all">
						{wt.path}
					</div>
					{wt.sessionIds.length > 0 && (
						<div className="mt-1.5 flex items-center gap-1 text-[11px] text-amber-400">
							<AlertTriangle size={13} className="shrink-0" />
							<span>{t("worktree.remove.linkedSessionsWarning", { count: wt.sessionIds.length })}</span>
						</div>
					)}
				</div>

				<div className="mb-4 space-y-2 rounded-xl hairline bg-[var(--well-bg)] p-2.5 text-xs">
					{wt.dirty > 0 && (
						<label className="flex items-start gap-2 cursor-pointer select-none text-rose-300">
							<input
								type="checkbox"
								checked={force}
								onChange={(e) => setForce(e.target.checked)}
								className="mt-0.5 rounded border-neutral-700 bg-neutral-900"
							/>
							<div>
								<div className="font-medium">{t("worktree.remove.forceDiscard")}</div>
								<div className="text-[11px] text-neutral-400">
									{t("worktree.remove.forceDiscardDesc")}
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
								<div>{t("worktree.remove.deleteBranch")}</div>
								<div className="font-mono text-[11px] text-neutral-400">{wt.branch}</div>
							</div>
						</label>
					)}
				</div>

				<div className="flex justify-end gap-2">
					<button
						type="button"
						onClick={() => onResolve(null)}
						className="rounded-lg px-3 py-1.5 text-xs text-neutral-400 hover:bg-[var(--bg-hover)] transition-colors"
					>
						{t("common.cancel")}
					</button>
					<button
						type="button"
						disabled={!canConfirm}
						onClick={() => onResolve({ force, deleteBranch })}
						className="rounded bg-rose-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-rose-500 disabled:opacity-40"
					>
						{t("worktree.remove.confirm")}
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
	return mountPromptDialog<{ force: boolean; deleteBranch: boolean } | null>((resolve) => (
		<RemoveWorktreeModal wt={wt} onResolve={resolve} />
	));
}
/**
 * Interactive worktree cleanup with a single consolidated dialog.
 * Pass `choice` to skip the prompt (batch flows that confirm once up front).
 * Returns true when the worktree was removed.
 */
export async function removeWorktreeFlow(
	repo: string,
	wt: WorktreeInfo,
	choice?: { force: boolean; deleteBranch: boolean },
	orphanOnly = false,
): Promise<boolean> {
	const resolved = choice ?? (await promptRemoveWorktree(wt));
	if (!resolved) return false;
	await gitRemoveWorktree(repo, wt.path, resolved.deleteBranch, resolved.force, orphanOnly);
	return true;
}
