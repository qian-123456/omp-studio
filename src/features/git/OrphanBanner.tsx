import clsx from "clsx";
import { AlertTriangle, ChevronDown, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { WorktreeInfo } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { useHomeDir } from "../../lib/hooks";
import { gitRepoRoot, gitScanOrphans } from "../../lib/ipc";
import { shortPath } from "../../lib/paths";
import { ListMore, repoRootFromWorktree } from "./helpers";
import { removeWorktreeFlow } from "./removeWorktree";

// In-memory dismissal tracked per repository root.
const dismissedRepos = new Set<string>();

/**
 * Dismissible "N 个工作树闲置中" banner with per-item and batch 回收.
 * Dismissal is scoped per repo root so other repos continue to alert.
 */
export function OrphanBanner({ cwd }: { cwd: string }) {
	const [repo, setRepo] = useState<string | null>(null);
	const [orphans, setOrphans] = useState<WorktreeInfo[]>([]);
	const [hidden, setHidden] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const home = useHomeDir();
	const [showAll, setShowAll] = useState(false);

	useEffect(() => {
		let cancelled = false;
		setHidden(false);
		setOrphans([]);
		void (async () => {
			const root = await gitRepoRoot(cwd).catch(() => null);
			if (cancelled || !root) return;
			setRepo(root);
			if (dismissedRepos.has(root)) {
				setHidden(true);
				return;
			}
			try {
				const list = await gitScanOrphans();
				if (cancelled) return;
				setOrphans(list.filter((o) => repoRootFromWorktree(o.path) === root));
			} catch {
				if (!cancelled) setOrphans([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [cwd]);

	if (hidden || orphans.length === 0) return null;

	const dismiss = () => {
		dismissedRepos.add(repo ?? cwd);
		setHidden(true);
	};

	const reclaim = async (wt: WorktreeInfo) => {
		setError(null);
		try {
			if (await removeWorktreeFlow(repo ?? cwd, wt)) {
				setOrphans((list) => list.filter((o) => o.path !== wt.path));
			}
		} catch (e) {
			setError(errMsg(e));
		}
	};

	const reclaimAll = async () => {
		if (orphans.length === 0 || busy) return;
		const dirty = orphans.filter((o) => o.dirty > 0);
		const dirtyList =
			dirty.length > 0
				? `\n其中 ${dirty.length} 个有未提交的改动（确认后一并丢弃）：\n${dirty
						.map((o) => `· ${shortPath(o.path, home)}`)
						.join("\n")}`
				: "";
		const ok = await confirmDialog(
			`确定回收这 ${orphans.length} 个闲置的工作树吗？${dirtyList}\n关联的分支会一并删除。`,
			{
				danger: true,
				title: "全部回收",
				okLabel: "全部回收",
			},
		);
		if (!ok) return;
		setBusy(true);
		setError(null);
		try {
			for (const wt of [...orphans]) {
				const removed = await removeWorktreeFlow(repo ?? cwd, wt, {
					force: wt.dirty > 0,
					deleteBranch: Boolean(wt.branch),
				});
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
				<button
					type="button"
					className="flex min-w-0 flex-1 items-center gap-0.5 text-left font-medium"
					onClick={() => setExpanded(!expanded)}
					aria-expanded={expanded}
				>
					<ChevronDown
						size={12}
						className={clsx("shrink-0 transition-transform", !expanded && "-rotate-90")}
					/>
					{orphans.length} 个工作树闲置中
				</button>
				<button
					type="button"
					disabled={busy}
					onClick={reclaimAll}
					className="shrink-0 rounded bg-amber-800/80 px-2 py-0.5 text-[11px] font-medium text-amber-100 hover:bg-amber-700 disabled:opacity-50"
					title="一键回收所有闲置工作树"
				>
					{busy ? "回收中…" : "全部回收"}
				</button>
				<button
					type="button"
					title="忽略此仓库的闲置提醒"
					aria-label="忽略此仓库的闲置提醒"
					onClick={dismiss}
					className="shrink-0 rounded p-0.5 text-amber-400/70 hover:bg-amber-900/50 hover:text-amber-200"
				>
					<X size={13} />
				</button>
			</div>
			{error && <div className="mt-1 text-rose-300">{error}</div>}
			{expanded && (
				<ul className="mt-1.5 space-y-1 border-t border-amber-800/40 pt-1.5">
					{(showAll ? orphans : orphans.slice(0, 5)).map((o) => (
						<li key={o.path} className="flex items-center gap-1.5">
							<span className="min-w-0 flex-1 truncate" title={o.path}>
								{shortPath(o.path, home)}
								{o.dirty > 0 && (
									<span className="ml-1 text-amber-400 font-medium">[未提交]</span>
								)}
							</span>
							<button
								type="button"
								disabled={busy}
								onClick={() => reclaim(o)}
								className="flex shrink-0 items-center gap-0.5 rounded bg-amber-800/60 px-1.5 py-0.5 text-[11px] hover:bg-amber-700/60 disabled:opacity-50"
								title="回收这个工作树"
							>
								<Trash2 size={11} /> 回收
							</button>
						</li>
					))}
					<ListMore
						n={orphans.length - 5}
						expanded={showAll}
						onToggle={() => setShowAll((v) => !v)}
						unit="个"
						className="text-amber-400/80 hover:bg-amber-900/40 hover:text-amber-200"
					/>
				</ul>
			)}
		</div>
	);
}
