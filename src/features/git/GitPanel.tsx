import clsx from "clsx";
import { FolderTree, RefreshCw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitCommit, GitSummary, TmRun, WorktreeInfo } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { useShortPath } from "../../lib/hooks";
import { gitDiff, gitListWorktrees, gitLog, gitRepoRoot, gitSummary, tmList } from "../../lib/ipc";
import { basename } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { HoverScrollText } from "../../components/HoverScrollText";
import { WorktreeHoverCard } from "./WorktreeHoverCard";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useTurnNav } from "../../stores/turnNav";
import { ChangesSection } from "./ChangesSection";
import { CheckpointsCard } from "./CheckpointsCard";
import { DiffModal } from "./DiffModal";
import { toplevelFor } from "./helpers";
import { TimelineSection } from "./TimelineSection";
import { WorktreeSection } from "./WorktreeSection";

const POLL_MS = 10_000;
const LOG_PAGE = 50;

type PaneTab = "changes" | "history";

/** [C] Right tab: worktree map on top; the selected worktree's changes/history below. */
export function GitPanel() {
	const sid = useUi((s) => s.selectedSessionId);
	const session = useSessions((s) => (sid ? s.sessions[sid] : undefined));
	return (
		<div className="flex min-h-full flex-col">
			{session?.cwd ? (
				<RepoView key={session.cwd} cwd={session.cwd} tick={session.file} />
			) : (
				<div className="p-3 text-xs text-neutral-500">
					没有选中的会话，或该会话未关联工作目录
				</div>
			)}
		</div>
	);
}

interface DiffReq {
	title: string;
	load: () => Promise<string>;
}

/** Calls the latest `refresh` every POLL_MS while visible, on un-hide and on window focus.
 * Pauses while document.visibilityState === "hidden" and skips overlapping runs.
 */
function useAutoRefresh(refresh: () => void | Promise<unknown>) {
	const latest = useRef(refresh);
	latest.current = refresh;

	useEffect(() => {
		let timer: number | null = null;
		let inFlight = false;
		let cancelled = false;

		const scheduleNext = () => {
			if (cancelled || document.visibilityState === "hidden") return;
			timer = window.setTimeout(() => {
				void run();
			}, POLL_MS);
		};

		const run = async () => {
			if (cancelled || document.visibilityState === "hidden") return;
			if (inFlight) return;
			inFlight = true;
			try {
				await latest.current();
			} finally {
				inFlight = false;
				scheduleNext();
			}
		};

		const onVisibility = () => {
			if (document.visibilityState === "visible") {
				if (timer !== null) {
					window.clearTimeout(timer);
					timer = null;
				}
				void run();
			} else {
				if (timer !== null) {
					window.clearTimeout(timer);
					timer = null;
				}
			}
		};

		const onFocus = () => {
			if (document.visibilityState === "visible") {
				void run();
			}
		};

		document.addEventListener("visibilitychange", onVisibility);
		window.addEventListener("focus", onFocus);
		scheduleNext();

		return () => {
			cancelled = true;
			if (timer !== null) window.clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisibility);
			window.removeEventListener("focus", onFocus);
		};
	}, []);
}

/** Repo-level state: is-repo check, worktree map, time-machine runs, focus selection. */
function RepoView({ cwd, tick }: { cwd: string; tick: string }) {
	const [isRepo, setIsRepo] = useState<boolean | null>(null);
	const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
	const [runs, setRuns] = useState<TmRun[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	/** Explicitly selected worktree; null follows the session's own worktree. */
	const [focus, setFocus] = useState<string | null>(null);
	const [tab, setTab] = useState<PaneTab>("changes");
	/** Bumped to make the focus pane reload (manual refresh, session activity). */
	const [paneNonce, setPaneNonce] = useState(0);
	const [diff, setDiff] = useState<DiffReq | null>(null);

	// Top bar HoverCard state
	const [topHoverOpen, setTopHoverOpen] = useState(false);
	const [topAnchorRect, setTopAnchorRect] = useState<DOMRect | null>(null);
	const topHoverTimer = useRef<number | null>(null);
	const topCloseTimer = useRef<number | null>(null);

	const handleTopMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
		if (topCloseTimer.current !== null) {
			window.clearTimeout(topCloseTimer.current);
			topCloseTimer.current = null;
		}
		const rect = e.currentTarget.getBoundingClientRect();
		topHoverTimer.current = window.setTimeout(() => {
			setTopAnchorRect(rect);
			setTopHoverOpen(true);
		}, 400);
	};

	const handleTopMouseLeave = () => {
		if (topHoverTimer.current !== null) {
			window.clearTimeout(topHoverTimer.current);
			topHoverTimer.current = null;
		}
		topCloseTimer.current = window.setTimeout(() => {
			setTopHoverOpen(false);
			setTopAnchorRect(null);
		}, 150);
	};
	/** Chat → git jump (contract §Frontend shared pieces). */
	const revealCommit = useTurnNav((s) => s.revealCommit);
	const handledReveal = useRef(0);
	const short = useShortPath();
	// A response applies only while it is still the newest request.
	const reqSeq = useRef(0);
	const lastTick = useRef(0);

	const load = useCallback(
		async (spinner: boolean) => {
			const seq = ++reqSeq.current;
			if (spinner) setLoading(true);
			try {
				const root = await gitRepoRoot(cwd);
				if (seq !== reqSeq.current) return;
				setIsRepo(root != null);
				setError(null);
				if (root == null) return;
				const [wts, tms] = await Promise.all([
					gitListWorktrees(cwd).catch(() => [] as WorktreeInfo[]),
					tmList().catch(() => [] as TmRun[]),
				]);
				if (seq !== reqSeq.current) return;
				setWorktrees(wts);
				setRuns(tms);
			} catch (e) {
				// Background polls fail quietly; visible loads surface the error.
				if (spinner && seq === reqSeq.current) setError(errMsg(e));
			} finally {
				if (spinner && seq === reqSeq.current) setLoading(false);
			}
		},
		[cwd],
	);

	const reloadAll = useCallback(() => {
		void load(true);
		setPaneNonce((n) => n + 1);
	}, [load]);

	// Mount, and session activity (throttled): reload map + pane.
	// biome-ignore lint/correctness/useExhaustiveDependencies: tick is a change signal
	useEffect(() => {
		if (Date.now() - lastTick.current < 5_000) return;
		lastTick.current = Date.now();
		reloadAll();
	}, [reloadAll, tick]);

	useAutoRefresh(() => void load(false));

	const top = toplevelFor(
		cwd,
		worktrees.map((w) => w.path),
	);
	const selected = focus && worktrees.some((w) => w.path === focus) ? focus : top;
	const selectedWt = worktrees.find((w) => w.path === selected);
	const mainRoot = worktrees[0]?.path;
	const repoRuns = runs.filter((r) => !mainRoot || r.repo === mainRoot);
	const selectedName = selectedWt
		? (selectedWt.branch ?? `历史版本 ${selectedWt.head.slice(0, 7)}`)
		: null;

	// Chat → git jump: select the target worktree and open 版本历史. The
	// timeline flashes the row and clears the request; every revealCommit (not
	// just the newest) is handled once its worktree list is known.
	useEffect(() => {
		if (!revealCommit || revealCommit.nonce <= handledReveal.current) return;
		if (worktrees.length === 0) return;
		handledReveal.current = revealCommit.nonce;
		useUi.getState().setRightTab("git");
		setFocus(
			revealCommit.cwd === top
				? null
				: worktrees.some((w) => w.path === revealCommit.cwd)
					? revealCommit.cwd
					: null,
		);
		setTab("history");
	}, [revealCommit, worktrees, top]);

	return (
		<div>
			{/* Compact repo header: repo name + path + refresh */}
			<div className="flex items-center justify-between border-b border-neutral-800/80 bg-neutral-900/40 px-3 py-1.5 text-xs">
				<div
					onMouseEnter={handleTopMouseEnter}
					onMouseLeave={handleTopMouseLeave}
					className="flex items-center gap-1.5 min-w-0 flex-1 cursor-pointer"
				>
					<FolderTree size={13} className="text-emerald-400 shrink-0" />
					<HoverScrollText
						text={basename(mainRoot ?? cwd)}
						title=""
						className="font-semibold text-neutral-200 text-xs truncate max-w-[140px]"
					/>
					<span className="text-[10px] text-neutral-500 truncate">
						· {short(mainRoot ?? cwd)}
					</span>
				</div>
				<div className="flex items-center gap-1 shrink-0 ml-1.5">
					<button
						type="button"
						title="刷新 (⌘R)"
						aria-label="刷新"
						onClick={reloadAll}
						className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
					>
						<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
					</button>
				</div>
			</div>

			{error && (
				<div className="m-3 flex items-center justify-between rounded border border-rose-800/60 bg-rose-950/40 p-2 text-xs text-rose-300">
					<span className="min-w-0 flex-1 truncate">{error}</span>
					<button
						type="button"
						onClick={reloadAll}
						className="ml-2 shrink-0 rounded bg-rose-900/60 px-2 py-0.5 text-[11px] font-medium text-rose-200 hover:bg-rose-800/80 transition-colors"
					>
						重试
					</button>
				</div>
			)}

			{isRepo === null && !error && <div className="p-3 text-xs text-neutral-500">加载中…</div>}
			{isRepo === false && (
				<div className="p-3 text-xs text-neutral-500">{short(cwd)} 不是 git 仓库</div>
			)}

			{isRepo && (
				<div className="space-y-2.5 p-2.5">
					<WorktreeSection
						repo={mainRoot ?? cwd}
						worktrees={worktrees}
						current={top}
						selected={selected}
						selectedExplicit={focus !== null}
						onSelect={(path) => setFocus(path === top ? null : path)}
						onChanged={() => void load(false)}
					/>

					<section className="rounded-lg border border-neutral-800 bg-neutral-900/50">
						{selected !== top && selectedName && (
							<div className="flex items-center gap-1.5 border-b border-neutral-800 bg-indigo-500/5 px-3 py-1.5 text-[11px] text-indigo-200">
								<span className="min-w-0 flex-1 truncate" title={`正在查看: ${selectedName}`}>
									正在查看 <span className="font-mono">{selectedName}</span>
								</span>
								<button
									type="button"
									onClick={() => setFocus(null)}
									className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
								>
									<Undo2 size={11} />
									回到当前
								</button>
							</div>
						)}
						{/* First-use turn-checkpoints consent, top of the selected worktree pane. */}
						<CheckpointsCard />
						<FocusPane
							key={selected}
							path={selected}
							tab={tab}
							onTab={setTab}
							nonce={paneNonce}
							runs={repoRuns}
							onRunsChange={(next) =>
								setRuns([...runs.filter((r) => !repoRuns.includes(r)), ...next])
							}
							onRepoChanged={() => void load(false)}
							onDiff={setDiff}
						/>
					</section>
				</div>
			)}

			{diff && <DiffModal title={diff.title} load={diff.load} onClose={() => setDiff(null)} />}

			{/* Floating preview card to the LEFT for top repo */}
			<WorktreeHoverCard
				title={basename(mainRoot ?? cwd)}
				path={mainRoot ?? cwd}
				anchorRect={topAnchorRect}
				open={topHoverOpen && topAnchorRect !== null}
				isCurrent={true}
			/>
		</div>
	);
}

/** Changes | history tabs for one worktree; remounted (keyed) per selected path. */
function FocusPane({
	path,
	tab,
	onTab,
	nonce,
	runs,
	onRunsChange,
	onRepoChanged,
	onDiff,
}: {
	path: string;
	tab: PaneTab;
	onTab: (tab: PaneTab) => void;
	nonce: number;
	runs: TmRun[];
	onRunsChange: (runs: TmRun[]) => void;
	onRepoChanged: () => void;
	onDiff: (req: DiffReq) => void;
}) {
	const [summary, setSummary] = useState<GitSummary | null>(null);
	const [commits, setCommits] = useState<GitCommit[]>([]);
	const [forkPoint, setForkPoint] = useState<string | null>(null);
	const [baseBranch, setBaseBranch] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(false);
	const [loadingMore, setLoadingMore] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const reqSeq = useRef(0);
	const limit = useRef(LOG_PAGE);

	const load = useCallback(async () => {
		const seq = ++reqSeq.current;
		try {
			const [s, log] = await Promise.all([gitSummary(path), gitLog(path, limit.current)]);
			if (seq !== reqSeq.current) return;
			setSummary(s);
			setCommits(log.commits);
			setForkPoint(log.forkPoint);
			setBaseBranch(log.base);
			setHasMore(log.commits.length >= limit.current);
			setError(null);
		} catch (e) {
			if (seq === reqSeq.current) setError(errMsg(e));
		}
	}, [path]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: nonce is a reload signal
	useEffect(() => {
		void load();
	}, [load, nonce]);

	useAutoRefresh(() => void load());

	const loadMore = async () => {
		if (loadingMore) return;
		const seq = ++reqSeq.current;
		limit.current += LOG_PAGE;
		setLoadingMore(true);
		try {
			const log = await gitLog(path, limit.current);
			setCommits(log.commits);
			setForkPoint(log.forkPoint);
			setBaseBranch(log.base);
			setHasMore(log.commits.length >= limit.current);
		} catch (e) {
			if (seq === reqSeq.current) toast.error(errMsg(e));
		} finally {
			setLoadingMore(false);
		}
	};

	/** A mutation here also changes the map (change counts, heads). */
	const changed = () => {
		void load();
		onRepoChanged();
	};

	const fileCount = summary?.files.length ?? 0;

	return (
		<div>
			<div role="tablist" className="flex items-center gap-1 px-2 pt-2">
				{(["changes", "history"] as const).map((t) => (
					<button
						key={t}
						type="button"
						role="tab"
						aria-selected={tab === t}
						onClick={() => onTab(t)}
						className={clsx(
							"flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors",
							tab === t
								? "bg-neutral-800 font-medium text-neutral-100"
								: "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200",
						)}
					>
						{t === "changes" ? "提交改动" : "版本历史"}
						{t === "changes" && fileCount > 0 && (
							<span className="rounded-full bg-amber-500/15 px-1.5 font-mono text-[10px] text-amber-400">
								{fileCount}
							</span>
						)}
					</button>
				))}
				<span className="flex-1" />
				{tab === "changes" && fileCount > 0 && (
					<button
						type="button"
						onClick={() =>
							onDiff({ title: "全部未提交的改动", load: () => gitDiff(path) })
						}
						className="rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
					>
						全部 diff
					</button>
				)}
			</div>

			<div role="tabpanel" className="px-2 pb-2">
				{error && <div className="px-1 pt-2 text-[11px] text-rose-400">{error}</div>}
				{!summary && !error && <div className="px-1 py-2 text-xs text-neutral-500">加载中…</div>}
				{summary &&
					(tab === "changes" ? (
						<ChangesSection
							cwd={path}
							summary={summary}
							toplevel={path}
							onDiff={(file) =>
								onDiff({
									title: file ?? "全部未提交的改动",
									load: () => gitDiff(path, file),
								})
							}
							onChanged={changed}
						/>
					) : (
						<TimelineSection
							cwd={path}
							summary={summary}
							commits={commits}
							forkPoint={forkPoint}
							baseBranch={baseBranch}
							runs={runs}
							hasMore={hasMore}
							loadingMore={loadingMore}
							onLoadMore={loadMore}
							onDiff={(sha, title) =>
								onDiff({
									title: title ?? sha ?? "diff",
									load: () => gitDiff(path, undefined, sha),
								})
							}
							onRunsChange={onRunsChange}
							onChanged={changed}
						/>
					))}
			</div>
		</div>
	);
}
