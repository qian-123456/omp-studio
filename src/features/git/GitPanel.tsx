import { GitBranch, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GitCommit, GitSummary, TmRun, WorktreeInfo } from "../../lib/contracts";
import { gitDiff, gitListWorktrees, gitLog, gitSummary, tmList } from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { ChangesSection } from "./ChangesSection";
import { DiffModal } from "./DiffModal";
import { toplevelFor } from "./helpers";
import { OrphanBanner } from "./OrphanBanner";
import { TimelineSection } from "./TimelineSection";
import { errMsg, useShortPath } from "./ui";
import { WorktreeSection } from "./WorktreeSection";

const POLL_MS = 10_000;

/** [C] Right tab: changes + time machine + worktrees for the selected session's cwd. */
export function GitPanel() {
	const sid = useUi((s) => s.selectedSessionId);
	const session = useSessions((s) => (sid ? s.sessions[sid] : undefined));
	return (
		<div className="flex min-h-full flex-col">
			<OrphanBanner />
			{session?.cwd ? (
				<RepoView key={session.cwd} cwd={session.cwd} tick={session.updatedAt} />
			) : (
				<div className="p-3 text-xs text-neutral-500">选择一个会话查看它所在仓库的 Git 状态</div>
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
				gitLog(cwd, 50),
				gitListWorktrees(cwd).catch(() => [] as WorktreeInfo[]),
				tmList().catch(() => [] as TmRun[]),
			]);
			setCommits(log);
			setWorktrees(wts);
			setRuns(tms);
		} catch (e) {
			setError(errMsg(e));
		} finally {
			setLoading(false);
		}
	}, [cwd]);

	// Full reload on mount and when the session file changes (throttled: it
	// changes on every streamed message).
	// biome-ignore lint/correctness/useExhaustiveDependencies: tick is a change signal
	useEffect(() => {
		if (Date.now() - lastLoad.current > 5_000) loadAll();
	}, [loadAll, tick]);

	// Cheap periodic refresh of the change list.
	useEffect(() => {
		const t = setInterval(() => {
			gitSummary(cwd)
				.then(setSummary)
				.catch(() => {});
		}, POLL_MS);
		return () => clearInterval(t);
	}, [cwd]);

	if (error) return <div className="p-3 text-xs text-rose-400">{error}</div>;
	if (!summary) return <div className="p-3 text-xs text-neutral-500">加载中…</div>;
	if (!summary.isRepo)
		return <div className="p-3 text-xs text-neutral-500">{short(cwd)} 不是 git 仓库</div>;

	const top = toplevelFor(
		cwd,
		worktrees.map((w) => w.path),
	);
	const mainRoot = worktrees[0]?.path;
	const repoRuns = runs.filter((r) => !mainRoot || r.repo === mainRoot);

	return (
		<div>
			<div className="flex items-center gap-1.5 border-b border-neutral-800 px-3 py-1.5 text-xs">
				<GitBranch size={13} className="text-neutral-500" />
				<span className="truncate text-neutral-200">{summary.branch ?? "detached"}</span>
				<span className="min-w-0 flex-1 truncate text-[10px] text-neutral-500" title={cwd}>
					{short(top)}
				</span>
				<button
					type="button"
					title="刷新"
					onClick={loadAll}
					className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
				>
					<RefreshCw size={12} className={loading ? "animate-spin" : ""} />
				</button>
			</div>
			<ChangesSection
				summary={summary}
				toplevel={top}
				onDiff={(path) =>
					setDiff({ title: path ?? "全部未提交的改动", load: () => gitDiff(cwd, path) })
				}
			/>
			<TimelineSection
				cwd={cwd}
				summary={summary}
				commits={commits}
				runs={repoRuns}
				onDiff={(sha, title) =>
					setDiff({ title: title ?? sha ?? "diff", load: () => gitDiff(cwd, undefined, sha) })
				}
				onRunsChange={(next) => setRuns([...runs.filter((r) => !repoRuns.includes(r)), ...next])}
				onChanged={loadAll}
			/>
			<WorktreeSection repo={cwd} worktrees={worktrees} current={top} onChanged={loadAll} />
			{diff && <DiffModal title={diff.title} load={diff.load} onClose={() => setDiff(null)} />}
		</div>
	);
}
