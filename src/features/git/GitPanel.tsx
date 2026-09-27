import { GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitCommit, GitSummary, TmRun, WorktreeInfo } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { useShortPath } from "../../lib/hooks";
import { gitDiff, gitListWorktrees, gitLog, gitSummary, tmList } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { ChangesSection } from "./ChangesSection";
import { CommitSection } from "./CommitSection";
import { DiffModal } from "./DiffModal";
import { toplevelFor } from "./helpers";
import { OrphanBanner } from "./OrphanBanner";
import { TimelineSection } from "./TimelineSection";
import { WorktreeSection } from "./WorktreeSection";

const POLL_MS = 10_000;

/** [C] Right tab: changes + time machine + worktrees for the selected session's cwd. */
export function GitPanel() {
	const sid = useUi((s) => s.selectedSessionId);
	const session = useSessions((s) => (sid ? s.sessions[sid] : undefined));
	return (
		<div className="flex min-h-full flex-col">
			{session?.cwd ? (
				<RepoView cwd={session.cwd} tick={session.file} />
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

function RepoView({ cwd, tick }: { cwd: string; tick: string }) {
	const [summary, setSummary] = useState<GitSummary | null>(null);
	const [commits, setCommits] = useState<GitCommit[]>([]);
	const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
	const [runs, setRuns] = useState<TmRun[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);
	const [commitLimit, setCommitLimit] = useState(50);
	const [hasMoreCommits, setHasMoreCommits] = useState(true);
	const [loadingMore, setLoadingMore] = useState(false);
	const [diff, setDiff] = useState<DiffReq | null>(null);
	const short = useShortPath();
	const lastLoad = useRef(0);

	const loadAll = useCallback(async () => {
		setLoading(true);
		lastLoad.current = Date.now();
		try {
			const s = await gitSummary(cwd);
			setSummary(s);
			setError(null);
			if (!s.isRepo) return;
			const [log, wts, tms] = await Promise.all([
				gitLog(cwd, commitLimit),
				gitListWorktrees(cwd).catch(() => [] as WorktreeInfo[]),
				tmList().catch(() => [] as TmRun[]),
			]);
			setCommits(log);
			setHasMoreCommits(log.length >= commitLimit);
			setWorktrees(wts);
			setRuns(tms);
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setLoading(false);
		}
	}, [cwd, commitLimit]);

	// Full reload on mount and when the session file changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: tick is a change signal
	useEffect(() => {
		if (Date.now() - lastLoad.current > 5_000) void loadAll();
	}, [loadAll, tick]);

	// Window focus full reload
	useEffect(() => {
		const onFocus = () => {
			void loadAll();
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [loadAll]);

	// Cheap periodic refresh of the change list.
	useEffect(() => {
		const t = setInterval(() => {
			gitSummary(cwd)
				.then(setSummary)
				.catch(() => {});
		}, POLL_MS);
		return () => clearInterval(t);
	}, [cwd]);

	const handleLoadMore = async () => {
		const nextLimit = commitLimit + 50;
		setCommitLimit(nextLimit);
		setLoadingMore(true);
		try {
			const nextLog = await gitLog(cwd, nextLimit);
			setCommits(nextLog);
			setHasMoreCommits(nextLog.length >= nextLimit);
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setLoadingMore(false);
		}
	};

	const top = toplevelFor(
		cwd,
		worktrees.map((w) => w.path),
	);
	const mainRoot = worktrees[0]?.path;
	const repoRuns = runs.filter((r) => !mainRoot || r.repo === mainRoot);

	return (
		<div>
			{/* Top Header - Always visible */}
			<div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-1.5 text-xs">
				<GitBranch size={13} className="text-neutral-500" />
				<span className="truncate text-neutral-200">{summary?.branch ?? "detached"}</span>
				<span className="min-w-0 flex-1 truncate text-[10px] text-neutral-500" title={cwd}>
					{short(top)}
				</span>
				<button
					type="button"
					title="刷新"
					aria-label="刷新"
					onClick={loadAll}
					className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
				>
					<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
				</button>
			</div>

			{/* Inline Error Alert */}
			{error && (
				<div className="m-3 flex items-center justify-between rounded border border-rose-800/60 bg-rose-950/40 p-2 text-xs text-rose-300">
					<span className="min-w-0 flex-1 truncate">{error}</span>
					<button
						type="button"
						onClick={loadAll}
						className="ml-2 shrink-0 rounded bg-rose-900/60 px-2 py-0.5 text-[11px] font-medium text-rose-200 hover:bg-rose-800/80 transition-colors"
					>
						重试
					</button>
				</div>
			)}

			{!summary && !error && <div className="p-3 text-xs text-neutral-500">加载中…</div>}
			{summary && !summary.isRepo && (
				<div className="p-3 text-xs text-neutral-500">{short(cwd)} 不是 git 仓库</div>
			)}

			{summary && summary.isRepo && (
				<div className="space-y-2.5 p-2.5">
					<OrphanBanner repo={mainRoot ?? cwd} />
					<CommitSection
						cwd={cwd}
						summary={summary}
						onCommitted={loadAll}
					/>
					<ChangesSection
						summary={summary}
						toplevel={top}
						onDiff={(path) =>
							setDiff({
								title: path ?? "全部未提交的改动",
								load: () => gitDiff(cwd, path),
							})
						}
						onChanged={loadAll}
					/>
					<TimelineSection
						cwd={cwd}
						summary={summary}
						commits={commits}
						runs={repoRuns}
						hasMore={hasMoreCommits}
						loadingMore={loadingMore}
						onLoadMore={handleLoadMore}
						onDiff={(sha, title) =>
							setDiff({
								title: title ?? sha ?? "diff",
								load: () => gitDiff(cwd, undefined, sha),
							})
						}
						onRunsChange={(next) =>
							setRuns([...runs.filter((r) => !repoRuns.includes(r)), ...next])
						}
						onChanged={loadAll}
					/>
					<WorktreeSection
						repo={cwd}
						worktrees={worktrees}
						current={top}
						onChanged={loadAll}
					/>
				</div>
			)}

			{diff && <DiffModal title={diff.title} load={diff.load} onClose={() => setDiff(null)} />}
		</div>
	);
}
