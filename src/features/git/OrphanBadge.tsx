import clsx from "clsx";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorktreeInfo } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { useEscapeKey, useHomeDir } from "../../lib/hooks";
import { gitRepoRoot, gitScanOrphans } from "../../lib/ipc";
import { shortPath } from "../../lib/paths";
import { ListMore, repoRootFromWorktree } from "./helpers";
import { removeWorktreeFlow } from "./removeWorktree";

// In-memory dismissal tracked per repository root.
const dismissedRepos = new Set<string>();

export interface OrphanBadgeProps {
	cwd: string;
	onChanged?: () => void;
}

/**
 * Compact alert badge (Option 3):
 * Sits unobtrusively in a header or toolbar, displaying "⚠️ N 闲置".
 * Clicking opens a sleek floating Popover to review and reclaim idle worktrees.
 */
export function OrphanBadge({ cwd, onChanged }: OrphanBadgeProps) {
	const [repo, setRepo] = useState<string | null>(null);
	const [orphans, setOrphans] = useState<WorktreeInfo[]>([]);
	const [hidden, setHidden] = useState(false);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const [cleaningPath, setCleaningPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [showAll, setShowAll] = useState(false);
	const home = useHomeDir();
	const containerRef = useRef<HTMLDivElement>(null);

	// Load orphaned worktrees for the current repository
	useEffect(() => {
		let cancelled = false;
		setHidden(false);
		setOrphans([]);
		setOpen(false);
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

	// Close on click outside
	useEffect(() => {
		if (!open) return;
		const handleClickOutside = (e: MouseEvent) => {
			if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [open]);

	// Close on Escape
	useEscapeKey(() => {
		if (open) setOpen(false);
	});

	if (hidden || orphans.length === 0) return null;

	const dismiss = () => {
		dismissedRepos.add(repo ?? cwd);
		setHidden(true);
		setOpen(false);
	};

	const reclaim = async (wt: WorktreeInfo) => {
		setError(null);
		setCleaningPath(wt.path);
		try {
			if (await removeWorktreeFlow(repo ?? cwd, wt)) {
				setOrphans((list) => list.filter((o) => o.path !== wt.path));
				onChanged?.();
			}
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setCleaningPath(null);
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
			onChanged?.();
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="relative inline-block" ref={containerRef}>
			{/* Micro Badge Trigger Button */}
			<button
				type="button"
				onClick={() => setOpen(!open)}
				aria-expanded={open}
				aria-label={`${orphans.length} 个工作树闲置`}
				title={`检测到 ${orphans.length} 个工作树闲置中（未关联任何会话），点击查看或清理`}
				className={clsx(
					"flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all select-none",
					open
						? "bg-amber-500/25 border border-amber-500/50 text-amber-300 shadow-sm"
						: "bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300",
				)}
			>
				<AlertTriangle size={11} className="shrink-0 text-amber-400" />
				<span>{orphans.length} 闲置</span>
			</button>

			{/* Floating Popover */}
			{open && (
				<div className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border border-neutral-700/80 bg-neutral-900/95 p-2.5 text-xs text-neutral-200 shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-100">
					{/* Popover Header */}
					<div className="flex items-center justify-between pb-1.5 border-b border-neutral-800">
						<div className="flex items-center gap-1.5 font-medium text-neutral-100">
							<AlertTriangle size={12} className="text-amber-400" />
							<span>闲置工作树 ({orphans.length})</span>
						</div>
						<div className="flex items-center gap-1">
							<button
								type="button"
								disabled={busy}
								onClick={reclaimAll}
								className="rounded bg-amber-800/80 hover:bg-amber-700 px-2 py-0.5 text-[10px] font-medium text-amber-100 disabled:opacity-50 transition-colors"
								title="一键回收所有闲置工作树"
							>
								{busy ? "回收中…" : "全部回收"}
							</button>
							<button
								type="button"
								onClick={() => setOpen(false)}
								className="rounded p-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
								title="关闭"
								aria-label="关闭"
							>
								<X size={12} />
							</button>
						</div>
					</div>

					<p className="mt-1.5 mb-2 text-[10px] text-neutral-400 leading-relaxed">
						这些工作树已无关联会话，可清理释放磁盘空间并删除废弃分支。
					</p>

					{error && (
						<div className="mb-2 rounded bg-rose-950/60 border border-rose-800/50 p-1.5 text-[11px] text-rose-300">
							{error}
						</div>
					)}

					{/* List of idle worktrees */}
					<ul className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
						{(showAll ? orphans : orphans.slice(0, 5)).map((o) => (
							<li
								key={o.path}
								className="flex items-center justify-between gap-1.5 rounded bg-neutral-950/50 px-2 py-1 border border-neutral-800/60"
							>
								<span className="min-w-0 flex-1 truncate font-mono text-[11px]" title={o.path}>
									{shortPath(o.path, home)}
									{o.dirty > 0 && (
										<span className="ml-1 text-amber-400 font-sans font-medium text-[10px]">
											[未提交]
										</span>
									)}
								</span>
								<button
									type="button"
									disabled={busy || cleaningPath === o.path}
									onClick={() => reclaim(o)}
									className="flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-neutral-400 hover:bg-rose-950/60 hover:text-rose-300 border border-transparent hover:border-rose-800/40 transition-colors disabled:opacity-50"
									title="回收这个工作树"
								>
									{cleaningPath === o.path ? (
										<Loader2 size={10} className="animate-spin text-amber-400" />
									) : (
										<Trash2 size={10} />
									)}
									<span>回收</span>
								</button>
							</li>
						))}
					</ul>

					{orphans.length > 5 && (
						<div className="mt-1.5 pt-1 border-t border-neutral-800/60">
							<ListMore
								n={orphans.length - 5}
								expanded={showAll}
								onToggle={() => setShowAll((v) => !v)}
								unit="个"
								className="text-amber-400/80 hover:bg-amber-900/40 hover:text-amber-200"
							/>
						</div>
					)}

					<div className="mt-2 pt-1.5 border-t border-neutral-800/60 flex items-center justify-between text-[10px] text-neutral-500">
						<button
							type="button"
							onClick={dismiss}
							className="hover:text-neutral-300 hover:underline transition-colors"
							title="本次不再提醒此仓库的闲置工作树"
						>
							对此仓库不再提醒
						</button>
						<span className="font-mono">共 {orphans.length} 个</span>
					</div>
				</div>
			)}
		</div>
	);
}

// Backward compatibility export
export { OrphanBadge as OrphanBanner };
