import { AlertTriangle, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorktreeInfo } from "../../lib/contracts";
import { gitScanOrphans } from "../../lib/ipc";
import { shortPath } from "../../lib/paths";
import { repoRootFromWorktree } from "./helpers";
import { removeWorktreeFlow } from "./removeWorktree";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { useHomeDir } from "../../lib/hooks";

// In-memory dismissal tracked per repository root.
const dismissedRepos = new Set<string>();

/**
 * Dismissible "发现 N 个孤儿 worktree" banner with per-item and batch 回收.
 * Dismissal is scoped per repo root so other repos continue to alert.
 */
export function OrphanBanner({ repo }: { repo?: string }) {
	const [orphans, setOrphans] = useState<WorktreeInfo[]>([]);
	const [hidden, setHidden] = useState(() => (repo ? dismissedRepos.has(repo) : false));
	const [expanded, setExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const home = useHomeDir();

	useEffect(() => {
		if (repo && dismissedRepos.has(repo)) {
			setHidden(true);
			return;
		}
		setHidden(false);
		gitScanOrphans()
			.then((list) => {
				// If a specific repo is provided, filter orphans belonging to this repo
				if (repo) {
					setOrphans(list.filter((o) => repoRootFromWorktree(o.path) === repo));
				} else {
					setOrphans(list);
				}
			})
			.catch(() => setOrphans([]));
	}, [repo]);

	if (hidden || orphans.length === 0) return null;

 	const dismiss = () => {
		const targetRepo = repo || (orphans[0] ? repoRootFromWorktree(orphans[0].path) : "global");
 		dismissedRepos.add(targetRepo);
 		setHidden(true);
 	};

	const reclaim = async (wt: WorktreeInfo) => {
		setError(null);
		try {
			const targetRepo = repo || repoRootFromWorktree(wt.path);
			if (await removeWorktreeFlow(targetRepo, wt)) {
				setOrphans((list) => list.filter((o) => o.path !== wt.path));
			}
		} catch (e) {
			setError(errMsg(e));
		}
	};

	const reclaimAll = async () => {
		if (orphans.length === 0 || busy) return;
		const ok = await confirmDialog(
			`确认要批量回收这 ${orphans.length} 个孤儿工作区吗？\n（检测到有未提交改动的工作区仍会在弹窗中请求确认）`,
			{
				danger: true,
				title: "全部回收确认",
				okLabel: "全部回收",
			},
		);
		if (!ok) return;
		setBusy(true);
		setError(null);
		try {
			for (const wt of [...orphans]) {
				const targetRepo = repo || repoRootFromWorktree(wt.path);
				const removed = await removeWorktreeFlow(targetRepo, wt);
				if (removed) {
					setOrphans((list) => list.filter((o) => o.path !== wt.path));
				}
			}
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="m-2 rounded border border-amber-700/60 bg-amber-950/40 p-2 text-xs text-amber-200">
			<div className="flex items-center gap-1.5">
				<AlertTriangle size={13} className="shrink-0" />
				<button type="button" className="min-w-0 flex-1 text-left font-medium" onClick={() => setExpanded(!expanded)}>
					发现 {orphans.length} 个孤儿 worktree（没有会话在使用）{expanded ? " ▾" : " ▸"}
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={reclaimAll}
					className="shrink-0 rounded bg-amber-800/80 px-2 py-0.5 text-[11px] font-medium text-amber-100 hover:bg-amber-700 disabled:opacity-50"
					title="一键回收所有孤儿 worktree"
				>
					{busy ? "回收中…" : "全部回收"}
				</button>
				<button
					type="button"
					title="忽略此仓库的孤儿提醒"
					onClick={dismiss}
					className="shrink-0 rounded p-0.5 text-amber-400/70 hover:bg-amber-900/50 hover:text-amber-200"
				>
					<X size={13} />
				</button>
			</div>
			{error && <div className="mt-1 text-rose-300">{error}</div>}
			{expanded && (
				<ul className="mt-1.5 space-y-1 border-t border-amber-800/40 pt-1.5">
					{orphans.map((o) => (
						<li key={o.path} className="flex items-center gap-1.5">
							<span className="min-w-0 flex-1 truncate" title={o.path}>
								{shortPath(o.path, home)}
								{o.dirty && <span className="ml-1 text-amber-400">● 有改动</span>}
							</span>
							<button
								type="button"
								disabled={busy}
								onClick={() => reclaim(o)}
								className="flex shrink-0 items-center gap-0.5 rounded bg-amber-800/60 px-1.5 py-0.5 text-[11px] hover:bg-amber-700/60 disabled:opacity-50"
							>
								<Trash2 size={11} /> 回收
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
