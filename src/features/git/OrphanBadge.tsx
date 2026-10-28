import clsx from "clsx";
import { AlertTriangle, GitBranch, Loader2, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { WorktreeInfo } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { useHomeDir } from "../../lib/hooks";
import { gitRepoRoot, gitScanOrphans } from "../../lib/ipc";
import { basename, shortPath } from "../../lib/paths";
import { ListMore, repoRootFromWorktree } from "./helpers";
import { removeWorktreeFlow } from "./removeWorktree";
import { HoverScrollText } from "../../components/HoverScrollText";
import { Notice } from "../../components/Notice";
import { useWorktrees } from "../../stores/worktrees";
import { useT } from "../../stores/language";

// In-memory dismissal tracked per repository root.
const dismissedRepos = new Set<string>();

export interface OrphanBadgeProps {
	cwd: string;
	onChanged?: () => void;
}

/**
 * Hook to manage orphaned (idle) worktrees state and actions for a repository.
 */
export function useOrphans(cwd: string, onChanged?: () => void) {
	const [repo, setRepo] = useState<string | null>(null);
	const [orphans, setOrphans] = useState<WorktreeInfo[]>([]);
	const [hidden, setHidden] = useState(false);
	const [busy, setBusy] = useState(false);
	const [cleaningPath, setCleaningPath] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const home = useHomeDir();
	const { t } = useT();
	const scope = useRef({ cwd });
	if (scope.current.cwd !== cwd) scope.current = { cwd };

	useEffect(() => {
		let cancelled = false;
		setHidden(false);
		setOrphans([]);
		setBusy(false);
		setCleaningPath(null);
		setError(null);
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

	const dismiss = () => {
		dismissedRepos.add(repo ?? cwd);
		setHidden(true);
		setOrphans([]);
	};

	const reclaim = async (wt: WorktreeInfo) => {
		const owner = scope.current;
		setError(null);
		setCleaningPath(wt.path);
		try {
			if (await removeWorktreeFlow(repo ?? cwd, wt, undefined, true)) {
				if (scope.current === owner) setOrphans((list) => list.filter((o) => o.path !== wt.path));
			}
		} catch (e) {
			if (scope.current === owner) setError(errMsg(e));
		} finally {
			// Directory removal can succeed before branch deletion fails.
			// Always reconcile from disk while preserving the branch error.
			void useWorktrees.getState().refresh();
			const current = await gitScanOrphans().catch(() => []);
			if (scope.current === owner) {
				setOrphans(current.filter((o) => repoRootFromWorktree(o.path) === (repo ?? cwd)));
				onChanged?.();
				setCleaningPath(null);
			}
		}
	};

	const reclaimAll = async () => {
		const owner = scope.current;
		if (orphans.length === 0 || busy) return;
		const dirty = orphans.filter((o) => o.dirty > 0);
		const dirtyList =
			dirty.length > 0
				? t("worktree.orphan.dirtyWarning", {
						count: dirty.length,
						list: dirty
							.map((o) => `· ${o.branch ?? basename(o.path)} (${shortPath(o.path, home)})`)
							.join("\n"),
					})
				: "";
		const ok = await confirmDialog(
			t("worktree.orphan.reclaimAllConfirm", { count: orphans.length, dirtyList }),
			{
				danger: true,
				title: t("worktree.orphan.reclaimAllTitle"),
				okLabel: t("worktree.orphan.reclaimAllTitle"),
			},
		);
		if (!ok || scope.current !== owner) return;
		setBusy(true);
		setError(null);
		try {
			for (const wt of [...orphans]) {
				const removed = await removeWorktreeFlow(repo ?? cwd, wt, {
					force: wt.dirty > 0,
					deleteBranch: Boolean(wt.branch),
				}, true);
				if (removed) {
					if (scope.current === owner) setOrphans((list) => list.filter((o) => o.path !== wt.path));
				}
			}
		} catch (e) {
			if (scope.current === owner) setError(errMsg(e));
		} finally {
			void useWorktrees.getState().refresh();
			const current = await gitScanOrphans().catch(() => []);
			if (scope.current === owner) {
				setOrphans(current.filter((o) => repoRootFromWorktree(o.path) === (repo ?? cwd)));
				onChanged?.();
				setBusy(false);
			}
		}
	};

	return {
		repo,
		orphans: hidden ? [] : orphans,
		busy,
		cleaningPath,
		error,
		home,
		reclaim,
		reclaimAll,
		dismiss,
	};
}

/**
 * Inline card panel (zero z-index/overflow issues) that smoothly pushes the content
 * underneath instead of floating and getting clipped by parent containers.
 */
export function OrphanInlinePanel({
	orphans,
	busy,
	cleaningPath,
	error,
	home,
	onReclaim,
	onReclaimAll,
	onClose,
	onDismiss,
}: {
	orphans: WorktreeInfo[];
	busy: boolean;
	cleaningPath: string | null;
	error: string | null;
	home: string | null;
	onReclaim: (wt: WorktreeInfo) => void;
	onReclaimAll: () => void;
	onClose: () => void;
	onDismiss: () => void;
}) {
	const { t } = useT();
	const [showAll, setShowAll] = useState(false);

	if (orphans.length === 0) return null;

	return (
		<div className="mb-2 rounded-lg border border-amber-600/40 bg-neutral-900 p-2.5 text-xs text-neutral-200 shadow-lg animate-in fade-in duration-100 select-none">
			{/* Panel Header */}
			<div className="flex items-center justify-between pb-1.5 border-b border-neutral-800">
				<div className="flex items-center gap-1.5 font-medium text-neutral-100">
					<AlertTriangle size={12} className="text-amber-400 shrink-0" />
					<span>{t("worktree.orphan.panelHeader", { count: orphans.length })}</span>
				</div>
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						disabled={busy}
						onClick={onReclaimAll}
						className="rounded bg-amber-800/80 hover:bg-amber-700 px-2 py-0.5 text-[10px] font-medium text-amber-100 disabled:opacity-50 transition-colors"
						title={t("worktree.orphan.reclaimAllBtnTitle")}
					>
						{busy ? t("worktree.orphan.reclaiming") : t("worktree.orphan.reclaimAllBtn")}
					</button>
					<button
						type="button"
						onClick={onClose}
						className="rounded p-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
						title={t("worktree.orphan.collapsePanel")}
						aria-label={t("worktree.orphan.collapsePanel")}
					>
						<X size={13} />
					</button>
				</div>
			</div>

			<p className="mt-1.5 mb-2 text-[10px] text-neutral-400 leading-relaxed">
				{t("worktree.orphan.panelDesc")}
			</p>

			{error && (
				<div className="mb-2">
					<Notice tone="danger">{error}</Notice>
				</div>
			)}

			{/* List of idle worktrees - perfectly fits any container width without horizontal overflow */}
			<ul className="space-y-1 max-h-48 overflow-y-auto pr-0.5">
				{(showAll ? orphans : orphans.slice(0, 5)).map((o) => {
					const name = o.branch || basename(o.path);
					return (
						<li
							key={o.path}
							className="flex items-center justify-between gap-2 rounded bg-neutral-950/80 px-2.5 py-1.5 border border-neutral-800/70 hover:border-neutral-700 transition-colors"
						>
							<div className="flex items-center gap-1.5 min-w-0 flex-1">
								<GitBranch size={12} className="shrink-0 text-amber-400/80" />
								<HoverScrollText
									text={name}
									className="min-w-0 flex-1 font-mono text-[11px] font-medium text-neutral-200"
									title={t("worktree.orphan.itemTitle", { branch: o.branch ?? t("common.none"), path: shortPath(o.path, home) })}
								/>
								{o.dirty > 0 && (
									<span className="shrink-0 rounded bg-amber-950/70 border border-amber-800/50 px-1 py-0.2 text-amber-300 font-sans text-[9px] font-medium">
										{t("worktree.orphan.dirtyBadge", { count: o.dirty })}
									</span>
								)}
							</div>
							<button
								type="button"
								disabled={busy || cleaningPath === o.path}
								onClick={() => onReclaim(o)}
								className="flex shrink-0 items-center gap-1 rounded bg-neutral-900 px-2 py-0.5 text-[10px] text-neutral-400 hover:bg-rose-950/60 hover:text-rose-300 border border-neutral-800 hover:border-rose-800/40 transition-colors disabled:opacity-50"
								title={t("worktree.orphan.reclaimWorktreeTitle", { name })}
							>
								{cleaningPath === o.path ? (
									<Loader2 size={10} className="animate-spin text-amber-400" />
								) : (
									<Trash2 size={10} />
								)}
								<span>{t("worktree.orphan.reclaim")}</span>
							</button>
						</li>
					);
				})}
			</ul>

			{orphans.length > 5 && (
				<div className="mt-1.5 pt-1 border-t border-neutral-800/60">
					<ListMore
						n={orphans.length - 5}
						expanded={showAll}
						onToggle={() => setShowAll((v) => !v)}
						className="text-amber-400/80 hover:bg-amber-900/40 hover:text-amber-200"
					/>
				</div>
			)}

			<div className="mt-2 pt-1.5 border-t border-neutral-800/60 flex items-center justify-between text-[10px] text-neutral-500">
				<button
					type="button"
					onClick={onDismiss}
					className="hover:text-neutral-300 hover:underline transition-colors"
					title={t("worktree.orphan.dismissTitle")}
				>
					{t("worktree.orphan.dismiss")}
				</button>
				<span className="font-mono">{t("worktree.orphan.totalCount", { count: orphans.length })}</span>
			</div>
		</div>
	);
}

/**
 * Compact alert badge (Option 3):
 * Provides the clickable badge button.
 */
export function OrphanBadge({
	count,
	open,
	onToggle,
}: {
	count: number;
	open: boolean;
	onToggle: () => void;
}) {
	const { t } = useT();
	if (count <= 0) return null;

	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={open}
			aria-label={t("worktree.orphan.badgeAria", { count })}
			title={t("worktree.orphan.badgeTitle", { count })}
			className={clsx(
				"flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium transition-all select-none",
				open
					? "bg-amber-500/25 border border-amber-500/50 text-amber-300 shadow-sm"
					: "bg-amber-500/10 border border-amber-500/25 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300",
			)}
		>
			<AlertTriangle size={11} className="shrink-0 text-amber-400" />
			<span>{t("worktree.orphan.badgeText", { count })}</span>
		</button>
	);
}

// Backward compatibility export
export { OrphanBadge as OrphanBanner };
