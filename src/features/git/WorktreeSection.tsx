import clsx from "clsx";
import { ChevronDown, GitBranch, Info, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import type { WorktreeInfo } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { gitCreateWorktree, updateSessionMeta } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { defaultSlug } from "./helpers";
import { removeWorktreeFlow } from "./removeWorktree";
import { WorktreeGraph } from "./WorktreeGraph";

/** Worktrees of the repo with change counts, session labels, creation and switching.
 *  Clicking a worktree selects it as the focus of the changes/history pane. */
export function WorktreeSection({
	repo,
	worktrees,
	current,
	selected,
	onSelect,
	onChanged,
}: {
	repo: string;
	worktrees: WorktreeInfo[];
	current: string;
	selected: string;
	onSelect: (path: string) => void;
	onChanged: () => void;
}) {
	const openModal = useUi((s) => s.openModal);

	const [error, setError] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(false);
	const [showCreate, setShowCreate] = useState(false);
	const [newWtName, setNewWtName] = useState("");
	const [creating, setCreating] = useState(false);
	const [cleaningPath, setCleaningPath] = useState<string | null>(null);
	const [sessionMenuWt, setSessionMenuWt] = useState<string | null>(null);

	useEscapeKey(() => setSessionMenuWt(null));

	const handleCreateWorktree = async () => {
		const name = newWtName.trim() || defaultSlug("worktree");
		setCreating(true);
		setError(null);
		try {
			await gitCreateWorktree(repo, name);
			toast.success(`已创建工作树：${name}`);
			setNewWtName("");
			setShowCreate(false);
			onChanged();
		} catch (e) {
			setError(errMsg(e));
			toast.error(errMsg(e));
		} finally {
			setCreating(false);
		}
	};

	const clean = async (wt: WorktreeInfo) => {
		setError(null);
		setCleaningPath(wt.path);
		try {
			if (await removeWorktreeFlow(repo, wt)) {
				// 自动归档关联会话（走 sessions store action），在 UI 上标记目录已删
				const sessionStore = useSessions.getState();
				for (const sid of wt.sessionIds) {
					try {
						const updated = await updateSessionMeta(sid, { archived: true });
						sessionStore.upsert([updated]);
					} catch {
						const cur = sessionStore.sessions[sid];
						if (cur) {
							sessionStore.upsert([{ ...cur, archived: true }]);
						}
					}
				}
				toast.success("已清理工作树，并自动归档关联会话");
				onChanged();
			}
		} catch (e) {
			setError(errMsg(e));
			toast.error(errMsg(e));
		} finally {
			setCleaningPath(null);
		}
	};

	return (
	<section className="rounded-lg border border-neutral-800 bg-neutral-900/50">
		<div className="flex items-center justify-between px-3 py-2">
			<button
				type="button"
				onClick={() => setCollapsed(!collapsed)}
				className="flex items-center gap-1.5 text-xs font-medium text-neutral-300 hover:text-neutral-100"
			>
				<ChevronDown
					size={13}
					className={clsx("transition-transform text-neutral-400", collapsed && "-rotate-90")}
				/>
				<GitBranch size={13} className="text-emerald-400" />
				<span>并行工作树</span>
				{worktrees.length > 0 && (
					<span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
						{worktrees.length}
					</span>
				)}
				<span
					title="每个工作树是一份独立代码目录，让多个任务并行互不干扰；点右侧 + 新建"
					className="text-neutral-500 hover:text-neutral-300 transition-colors"
					onClick={(e) => {
						e.stopPropagation();
					}}
				>
					<Info size={12} />
				</span>
			</button>
			{!collapsed && (
				<button
					type="button"
					title="新建并行工作树"
					aria-label="新建并行工作树"
					onClick={() => setShowCreate(!showCreate)}
					className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus:opacity-100"
				>
					<Plus size={13} />
				</button>
			)}
		</div>

		{!collapsed && (
			<div className="border-t border-neutral-800 px-3 pb-2 pt-1">
			{showCreate && (
				<div className="mb-2 rounded border border-neutral-800 bg-neutral-900/80 p-2 text-xs">
					<div className="mb-1 text-[11px] text-neutral-400">新建并行工作树</div>
					<div className="flex gap-1.5 mb-1.5">
						<input
							autoFocus
							value={newWtName}
							onChange={(e) => setNewWtName(e.target.value)}
							onKeyDown={(e) => {
								if (isComposing(e)) return;
								if (e.key === "Enter") {
									e.preventDefault();
									void handleCreateWorktree();
								}
								if (e.key === "Escape") {
									e.preventDefault();
									setShowCreate(false);
								}
							}}
							placeholder="工作树名称（例如 feat-auth）"
							className="min-w-0 flex-1 rounded border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-200 outline-none focus:border-indigo-500 font-mono"
						/>
						<button
							type="button"
							disabled={creating}
							onClick={handleCreateWorktree}
							className="flex shrink-0 items-center gap-1 rounded bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
						>
							{creating && <Loader2 size={11} className="animate-spin" />}
							<span>创建</span>
						</button>
					</div>
					<div className="flex items-center justify-between text-[10px] text-neutral-500">
						<span>按 Enter 创建，Esc 取消</span>
						<button
							type="button"
							onClick={() => {
								setShowCreate(false);
								openModal("new-session", { cwd: repo, useWorktree: true });
							}}
							className="text-indigo-400 hover:underline"
						>
							更多选项（新会话向导）…
						</button>
					</div>
				</div>
			)}

			{error && <div className="mb-1 text-[11px] text-rose-400">{error}</div>}

			<WorktreeGraph
				repo={repo}
				worktrees={worktrees}
				current={current}
				selected={selected}
				onSelect={onSelect}
				cleaningPath={cleaningPath}
				sessionMenuWt={sessionMenuWt}
				setSessionMenuWt={setSessionMenuWt}
				onClean={clean}
			/>
			</div>
		)}
		</section>
	);
}
