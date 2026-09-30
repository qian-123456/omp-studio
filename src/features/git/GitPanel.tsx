import clsx from "clsx";
import { GitBranch, RefreshCw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitCommit, GitSummary, TmRun, WorktreeInfo } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { useShortPath } from "../../lib/hooks";
import { gitDiff, gitListWorktrees, gitLog, gitRepoRoot, gitSummary, tmList } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { ChangesSection } from "./ChangesSection";
import { DiffModal } from "./DiffModal";
import { toplevelFor } from "./helpers";
import { OrphanBanner } from "./OrphanBanner";
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

/** Calls the latest `refresh` every POLL_MS while visible, on un-hide and on window focus. */
function useAutoRefresh(refresh: () => void) {
	const latest = useRef(refresh);
	latest.current = refresh;
	useEffect(() => {
		const run = () => {
			if (!document.hidden) latest.current();
		};
		const t = setInterval(run, POLL_MS);
		document.addEventListener("visibilitychange", run);
		window.addEventListener("focus", run);
		return () => {
			clearInterval(t);
			document.removeEventListener("visibilitychange", run);
			window.removeEventListener("focus", run);
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

	return (
		<div>
			<div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-1.5 text-xs">
				<GitBranch size={13} className="text-neutral-500" />
				<span className="min-w-0 flex-1 truncate text-[10px] text-neutral-500" title={mainRoot ?? cwd}>
					{short(mainRoot ?? cwd)}
				</span>
				<button
					type="button"
					title="刷新"
					aria-label="刷新"
					onClick={reloadAll}
					className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
				>
					<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
				</button>
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
					<OrphanBanner cwd={cwd} />
					<WorktreeSection
						repo={mainRoot ?? cwd}
						worktrees={worktrees}
						current={top}
						selected={selected}
						onSelect={(path) => setFocus(path === top ? null : path)}
						onChanged={() => void load(false)}
					/>

					<section className="rounded-lg border border-neutral-800 bg-neutral-900/50">
						{selected !== top && selectedName && (
							<div className="flex items-center gap-1.5 border-b border-neutral-800 bg-indigo-500/5 px-3 py-1.5 text-[11px] text-indigo-200">
								<span className="min-w-0 flex-1 truncate">
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
			setCommits(log);
			setHasMore(log.length >= limit.current);
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
			if (seq !== reqSeq.current) return;
			setCommits(log);
			setHasMore(log.length >= limit.current);
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
