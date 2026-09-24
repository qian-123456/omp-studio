import type { WorktreeInfo } from "../../lib/contracts";
import { gitRemoveWorktree } from "../../lib/ipc";
import { confirmDialog } from "./ui";

/**
 * Interactive worktree cleanup: confirm, refuse silent delete when dirty
 * (explicit force confirm instead), optionally delete the branch.
 * Returns true when the worktree was removed.
 */
export async function removeWorktreeFlow(repo: string, wt: WorktreeInfo): Promise<boolean> {
	const users = wt.sessionIds.length ? `\n仍有 ${wt.sessionIds.length} 个会话使用此目录。` : "";
	if (!(await confirmDialog(`清理 worktree？\n${wt.path}${users}`, { title: "清理 worktree" }))) return false;
	let force = false;
	if (wt.dirty) {
		force = await confirmDialog("该 worktree 有未提交的改动。\n强制删除会永久丢失这些改动，确定吗？", {
			danger: true,
			title: "有未提交的改动",
			okLabel: "强制删除",
		});
		if (!force) return false;
	}
	let deleteBranch = false;
	if (wt.branch) {
		deleteBranch = await confirmDialog(`同时删除分支 ${wt.branch}？`, {
			title: "删除分支",
			okLabel: "删除分支",
		});
	}
	await gitRemoveWorktree(repo, wt.path, deleteBranch, force);
	return true;
}
