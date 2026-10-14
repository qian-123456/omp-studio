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
import { countCrossedEmpty, type GitPaneTab, paneTab, toplevelFor } from "./helpers";
import { TimelineSection } from "./TimelineSection";
import { BranchAssetSection } from "./BranchAssetSection";
import { WorktreeSection } from "./WorktreeSection";
const POLL_MS = 10_000;
const LOG_PAGE = 50;

type PaneTab = GitPaneTab;
type RepoMode = "worktrees" | "branches";

/** Minimum heights (px) of the split's top list and bottom detail pane. */
const MIN_LIST_H = 80;
const MIN_DETAIL_H = 140;

/** [C] Right tab: worktree map on top; the selected worktree's changes/history below. */
export function GitPanel() {
	const sid = useUi((s) => s.selectedSessionId);
	const session = useSessions((s) => (sid ? s.sessions[sid] : undefined));
	return (
		<div className="flex h-full min-h-0 flex-col">
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
	/** Manual segmented pick, keyed to the worktree it was made on; cleared when the
	 * selection changes or the change count crosses the empty/non-empty boundary. */
	const [manualTab, setManualTab] = useState<{ path: string; tab: PaneTab } | null>(null);
	/** null until the first successful worktree load picks a default; a manual pick is kept
	 * for this RepoView's lifetime (remounted per cwd, so repo switches start fresh). */
	const [mode, setMode] = useState<RepoMode | null>(null);
	const listHeight = useUi((s) => s.gitListHeight);
	const splitRef = useRef<HTMLDivElement>(null);
	/** Bumped to make the focus pane reload (manual refresh, session activity). */
	const [paneNonce, setPaneNonce] = useState(0);
	const [diff, setDiff] = useState<DiffReq | null>(null);
	/** Loaded change count for `selected`; `n` is null until FocusPane reports one. */
	const [fileCount, setFileCount] = useState<{ path: string; n: number | null } | null>(null);

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
					gitListWorktrees(cwd).catch(() => null),
					tmList().catch(() => [] as TmRun[]),
				]);
				if (seq !== reqSeq.current) return;
				setWorktrees(wts ?? []);
				setRuns(tms);
				// Adaptive default, applied once: a lone checkout has nothing to map, so start on
				// branches; multiple worktrees start on the map. Failed lists fall back to worktrees.
				setMode((m) => m ?? (wts?.length === 1 ? "branches" : "worktrees"));
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

	// Effective tab: manual pick wins; while the count is still loading keep the
	// last shown tab (no flash); once loaded, empty → history, dirty → changes.
	const count = fileCount?.path === selected ? fileCount.n : null;
	const lastTab = useRef<PaneTab>("changes");
	const prevCount = useRef<number | null>(null);
	const tab = paneTab(count, manualTab?.path === selected ? manualTab.tab : null, lastTab.current);
	useEffect(() => {
		lastTab.current = tab;
		// A stale keyed pick (leftover when returning to a worktree) expires here; a
		// same-batch pick already targets the new path so the guard keeps it alive.
		if (manualTab && manualTab.path !== selected) setManualTab(null);
		// Manual picks are also forgotten when the count crosses empty/non-empty.
		if (countCrossedEmpty(prevCount.current, count)) setManualTab(null);
		prevCount.current = count;
	}, [selected, count, tab, manualTab]);

	// Chat → git jump: select the target worktree and open 版本历史. The
	// timeline flashes the row and clears the request; every revealCommit (not
	// just the newest) is handled once its worktree list is known.
	useEffect(() => {
		if (!revealCommit || revealCommit.nonce <= handledReveal.current) return;
		if (worktrees.length === 0) return;
		handledReveal.current = revealCommit.nonce;
		useUi.getState().setRightTab("git");
		setMode("worktrees");
		const nextFocus =
			revealCommit.cwd === top
				? null
				: worktrees.some((w) => w.path === revealCommit.cwd)
					? revealCommit.cwd
					: null;
		setFocus(nextFocus);
		setManualTab({ path: nextFocus ?? top, tab: "history" });
	}, [revealCommit, worktrees, top]);

	const selectWorktree = (path: string) => setFocus(path === top ? null : path);

	/** Divider drag: live update via setState, persist once on release (same as dock widths). */
	const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		const box = splitRef.current?.getBoundingClientRect();
		if (!box) return;
		e.preventDefault();
		const target = e.currentTarget;
		target.setPointerCapture(e.pointerId);
		const clamp = (y: number) =>
			Math.max(MIN_LIST_H, Math.min(box.height - MIN_DETAIL_H, y - box.top));
		let last = listHeight;
		const onMove = (ev: PointerEvent) => {
			last = clamp(ev.clientY);
			useUi.setState({ gitListHeight: Math.round(last) });
		};
		const onUp = () => {
			target.removeEventListener("pointermove", onMove);
			target.removeEventListener("pointerup", onUp);
			target.removeEventListener("pointercancel", onUp);
			useUi.getState().setGitListHeight(last);
		};
		target.addEventListener("pointermove", onMove);
		target.addEventListener("pointerup", onUp);
		target.addEventListener("pointercancel", onUp);
	};

	return (
		<div className="flex h-full min-h-0 flex-col">
			{/* Compact repo header: repo name + view switch + refresh (path lives in the hover card) */}
			<div className="flex shrink-0 items-center justify-between gap-1.5 border-b border-neutral-800/80 bg-neutral-900/40 px-3 py-1.5 text-xs">
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
				</div>
				<div className="flex items-center gap-1 shrink-0">
					{isRepo && mode && (
						<Segmented
							value={mode}
							onChange={setMode}
							options={[
								{ value: "worktrees", label: "工作树" },
								{ value: "branches", label: "分支" },
							]}
						/>
					)}
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
				<div className="m-3 flex shrink-0 items-center justify-between rounded border border-rose-800/60 bg-rose-950/40 p-2 text-xs text-rose-300">
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

			{(isRepo === null || (isRepo && mode === null)) && !error && (
				<div className="p-3 text-xs text-neutral-500">加载中…</div>
			)}
			{isRepo === false && (
				<div className="p-3 text-xs text-neutral-500">{short(cwd)} 不是 git 仓库</div>
			)}

			{isRepo && mode === "branches" && (
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
					<BranchAssetSection
						repo={mainRoot ?? cwd}
						currentWorktreePath={selected}
						onSelectWorktree={(path) => {
							selectWorktree(path);
							setMode("worktrees");
						}}
						onWorktreeChanged={() => void load(false)}
					/>
				</div>
			)}

			{isRepo && mode === "worktrees" && (
				<div ref={splitRef} className="flex min-h-0 flex-1 flex-col">
					<div
						className={clsx("overflow-auto p-2.5", worktrees.length > 1 && "shrink-0")}
						style={
							worktrees.length > 1
								? {
										height: listHeight,
										minHeight: MIN_LIST_H,
										maxHeight: `calc(100% - ${MIN_DETAIL_H}px)`,
									}
								: { flexShrink: 0, maxHeight: `calc(100% - ${MIN_DETAIL_H}px)` }
						}
					>
						<WorktreeSection
							repo={mainRoot ?? cwd}
							worktrees={worktrees}
							current={top}
							selected={selected}
							selectedExplicit={focus !== null}
							onSelect={selectWorktree}
							onChanged={() => void load(false)}
							onOpenPane={(path, t) => {
								selectWorktree(path);
								setManualTab({ path, tab: t });
							}}
							onDiff={setDiff}
						/>
					</div>

					{worktrees.length > 1 && (
						// biome-ignore lint/a11y/useSemanticElements: draggable splitter, not a static rule
						<div
							role="separator"
							aria-orientation="horizontal"
							aria-label="拖动调整高度"
							tabIndex={-1}
							onPointerDown={startDrag}
							className="group relative h-1.5 shrink-0 cursor-row-resize touch-none border-y border-neutral-800 bg-neutral-900 hover:bg-indigo-500/30"
						/>
					)}
					{worktrees.length <= 1 && <div className="h-px shrink-0 bg-neutral-800" />}

					<div className="flex min-h-0 flex-1 flex-col">
						{/* Detail pane header: which worktree, back-to-current, tab switch, diff */}
						<div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-800 bg-neutral-900/40 px-2 py-1 text-xs">
							<span
								className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral-200"
								title={selectedName ?? selected}
							>
								{selectedName ?? basename(selected)}
							</span>
							{selected !== top && (
								<button
									type="button"
									title="回到当前"
									aria-label="回到当前"
									onClick={() => setFocus(null)}
									className="shrink-0 rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
								>
									<Undo2 size={12} />
								</button>
							)}
							<Segmented
								value={tab}
								onChange={(t) => setManualTab({ path: selected, tab: t })}
								options={[
									{ value: "changes", label: `改动 ${count ?? 0}` },
									{ value: "history", label: "历史" },
								]}
							/>
							{tab === "changes" && (count ?? 0) > 0 && (
								<button
									type="button"
									onClick={() =>
										setDiff({ title: "全部未提交的改动", load: () => gitDiff(selected) })
									}
									className="shrink-0 whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
								>
									全部 diff
								</button>
							)}
						</div>
						<div className="min-h-0 flex-1 overflow-auto">
							{/* First-use turn-checkpoints consent, top of the selected worktree pane. */}
							<CheckpointsCard />
							<FocusPane
								key={selected}
								path={selected}
								tab={tab}
								nonce={paneNonce}
								onFileCount={setFileCount}
								runs={repoRuns}
								onRunsChange={(next) =>
									setRuns([...runs.filter((r) => !repoRuns.includes(r)), ...next])
								}
								onRepoChanged={() => void load(false)}
								onDiff={setDiff}
							/>
						</div>
					</div>
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
				worktreeCount={isRepo ? worktrees.length : undefined}
			/>
		</div>
	);
}

/** Changes | history tabs for one worktree; remounted (keyed) per selected path. */
function FocusPane({
	path,
	tab,
	nonce,
	onFileCount,
	runs,
	onRunsChange,
	onRepoChanged,
	onDiff,
}: {
	path: string;
	tab: PaneTab;
	nonce: number;
	onFileCount: (count: { path: string; n: number | null }) => void;
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

	// null while the summary has not loaded yet, so the pane never auto-switches
	// to history before the real count is known.
	const fileCount = summary?.files.length ?? null;
	useEffect(() => {
		onFileCount({ path, n: fileCount });
	}, [path, fileCount, onFileCount]);

	return (
		<div>
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

/** Compact two-way segmented control used by the repo and detail headers. */
function Segmented<T extends string>({
	value,
	onChange,
	options,
}: {
	value: T;
	onChange: (v: T) => void;
	options: { value: T; label: string }[];
}) {
	return (
		<div role="tablist" className="flex shrink-0 rounded-md bg-neutral-800/60 p-0.5">
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					role="tab"
					aria-selected={value === o.value}
					onClick={() => onChange(o.value)}
					className={clsx(
						"whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] transition-colors",
						value === o.value
							? "bg-neutral-700 font-medium text-neutral-100"
							: "text-neutral-400 hover:text-neutral-200",
					)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}
