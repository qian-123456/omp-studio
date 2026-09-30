import clsx from "clsx";
import { FolderTree, GitBranch, Info, Loader2, PanelRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { WorktreeInfo } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { addWorkspace, gitListBranches } from "../../lib/ipc";
import { basename } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useExplorer } from "../../stores/explorer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

/** Idle (worktree-less) branches beyond this count collapse behind an expander row. */
const IDLE_BRANCH_CAP = 15;

/**
 * Tree rail stem:
 * - Straight vertical line + subtle 5px rounded corner turning into horizontal line.
 * - Leads directly to the GitBranch badge/icon.
 * - Terminates cleanly at the last item without dangling tail.
 */
function TreeBranchStem({
	isLast,
	isWorktree,
	isCurrent,
}: {
	isLast: boolean;
	isWorktree: boolean;
	isCurrent?: boolean;
}) {
	// Rail width: 28px. Trunk at x=14, row midY=16, corner radius r=5
	const trunkX = 14;
	const midY = 16;
	const r = 5;

	const strokeColor = isWorktree
		? isCurrent
			? "#10b981" // emerald-500
			: "#059669" // emerald-600
		: "#525252"; // neutral-600

	return (
		<div className="relative w-7 shrink-0 self-stretch pointer-events-none select-none">
			<svg className="absolute inset-0 w-full h-full">
				{/* When not the last item: vertical trunk continues down to next row (100% height) */}
				{!isLast ? (
					<>
						{/* Continuous trunk */}
						<line
							x1={trunkX}
							y1="0"
							x2={trunkX}
							y2="100%"
							stroke={strokeColor}
							strokeWidth="1.5"
						/>
						{/* Branch curve: straight vertical to corner, slight 5px radius, straight horizontal */}
						<path
							d={`M ${trunkX} ${midY - r} Q ${trunkX} ${midY}, ${trunkX + r} ${midY} H 28`}
							fill="none"
							stroke={strokeColor}
							strokeWidth="1.5"
							strokeLinecap="round"
						/>
					</>
				) : (
					/* Last item: trunk comes down from top, curves slightly into horizontal, and stops */
					<path
						d={`M ${trunkX} 0 V ${midY - r} Q ${trunkX} ${midY}, ${trunkX + r} ${midY} H 28`}
						fill="none"
						stroke={strokeColor}
						strokeWidth="1.5"
						strokeLinecap="round"
					/>
				)}
			</svg>
		</div>
	);
}

/**
 * Repo → worktrees & branches tree graph.
 * Refined per user feedback:
 * 1. Straight lines + subtle rounded corner (r=5px), not too curvy.
 * 2. Replaced circles with Git branch badge/icon.
 * 3. Changed "● 改动" to clean "未提交" badge.
 * 4. Changed "主工程/主目录" to jargon-free "原始目录".
 * 5. Shortened group headers and added info circles (ⓘ) with hover tooltips.
 * 6. Changed button text to "+ 建工作树".
 */
export function WorktreeGraph({
	repo,
	worktrees,
	current,
	selected,
	onSelect,
	cleaningPath,
	sessionMenuWt,
	setSessionMenuWt,
	onClean,
}: {
	repo: string;
	worktrees: WorktreeInfo[];
	current: string;
	/** Worktree whose changes/history the panel below is showing. */
	selected: string;
	onSelect: (path: string) => void;
	cleaningPath: string | null;
	sessionMenuWt: string | null;
	setSessionMenuWt: (path: string | null) => void;
	onClean: (wt: WorktreeInfo) => void;
}) {
	const sessions = useSessions((s) => s.sessions);
	const selectSession = useUi((s) => s.selectSession);
	const openModal = useUi((s) => s.openModal);
	const setRightTab = useUi((s) => s.setRightTab);
	const setExplorerWorkspace = useExplorer((s) => s.setWorkspaceId);

	/** Register the worktree as a workspace and pin it in the right explorer —
	 *  opens a separate view without touching the current session window. */
	const openInExplorer = async (path: string) => {
		try {
			const ws = await addWorkspace(path);
			void useSessions.getState().refreshWorkspaces();
			setExplorerWorkspace(ws.id);
			setRightTab("explorer");
		} catch (e) {
			toast.error(`在侧边栏打开失败: ${errMsg(e)}`);
		}
	};

	const [branches, setBranches] = useState<string[] | null>(null);
	const [idleExpanded, setIdleExpanded] = useState(false);

	/** Worktree paths+branches as a change key: re-list branches whenever a
	 *  worktree is created/removed/switched so the idle-branch list stays fresh. */
	const worktreeKey = useMemo(
		() => worktrees.map((wt) => `${wt.path}:${wt.branch ?? ""}`).join("|"),
		[worktrees],
	);

	useEffect(() => {
		let alive = true;
		gitListBranches(repo)
			.then((list) => {
				if (alive) setBranches(list);
			})
			.catch(() => {
				if (alive) setBranches([]);
			});

		return () => {
			alive = false;
		};
	}, [repo, worktreeKey]);

	// Repo switch: drop stale branch list and collapse the idle expander again.
	useEffect(() => {
		setBranches(null);
		setIdleExpanded(false);
	}, [repo]);

	const mainPath = worktrees[0]?.path;

	// Distinguish worktree branches vs idle branches
	const { activeWorktrees, idleBranches, hiddenIdleCount } = useMemo(() => {
		const activeNames = new Set<string>();
		for (const wt of worktrees) {
			if (wt.branch) activeNames.add(wt.branch);
		}

		const allBranches = branches ?? [];
		const idle = allBranches.filter((b) => !activeNames.has(b));
		const visible = idleExpanded ? idle : idle.slice(0, IDLE_BRANCH_CAP);
		const hidden = idle.length - visible.length;

		return {
			activeWorktrees: worktrees,
			idleBranches: visible,
			hiddenIdleCount: hidden,
		};
	}, [branches, worktrees, idleExpanded]);

	return (
		<div className="text-xs font-sans select-none space-y-2">
			{/* Top Block: Repo Root Container */}
			<div className="relative rounded-lg border border-neutral-800 bg-neutral-900/90 px-3 py-2 shadow-sm transition-colors hover:border-neutral-700/80">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2 min-w-0">
						<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
							<FolderTree size={12} />
						</div>
						<span className="font-semibold text-neutral-100 text-xs truncate" title={repo}>
							{basename(repo)}
						</span>
					</div>
					{branches && branches.length > 0 && (
						<span className="text-[10px] text-neutral-500 font-mono shrink-0">
							{branches.length} 个分支
						</span>
					)}
				</div>
			</div>

			{/* Section 1: Active Worktrees */}
			<div className="space-y-0.5">
				{/* Section Header 1: Concise + Info Circle */}
				<div className="flex items-center gap-1.5 px-1 py-1 text-neutral-400 font-medium text-[11px]">
					<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
					<span>已建工作树</span>
					<span
						title="每个工作树都是磁盘上的独立文件夹，支持多任务并行修改代码，互不干扰、互不踩文件"
						className="cursor-help text-neutral-500 hover:text-neutral-300 transition-colors"
					>
						<Info size={11} />
					</span>
				</div>

				{/* Worktrees Tree */}
				<div className="flex flex-col">
					{activeWorktrees.map((wt, index) => {
						const isLast = index === activeWorktrees.length - 1;
						const isMain = wt.path === mainPath;
						const isCurrent = wt.path === current;
						const isSelected = wt.path === selected;
						const isCleaning = cleaningPath === wt.path;

						// Friendly display name: avoid detached jargon
						const displayName = wt.branch
							? wt.branch
							: `历史测试 (版本 ${wt.head.slice(0, 7)})`;

						return (
							<div key={wt.path} className="relative flex flex-col">
								<div className="group flex items-start min-h-[34px]">
									{/* Straight line with subtle rounded corner */}
									<TreeBranchStem
										isLast={isLast}
										isWorktree={true}
										isCurrent={isCurrent}
									/>

									{/* Row content: Plan A Two-Line layout */}
									<div
										className={clsx(
											"relative flex min-w-0 flex-1 flex-col justify-center rounded border px-2 py-1.5 transition-colors",
											isSelected
												? "border-indigo-500/50 bg-indigo-500/10 shadow-sm"
												: "border-transparent hover:bg-neutral-800/40",
										)}
									>
										{/* Line 1: Git branch icon + Full Branch Name + Right Hover Actions */}
										<div className="flex items-center justify-between gap-1.5 min-w-0">
											<div className="flex items-center gap-1.5 min-w-0 flex-1">
												<GitBranch
													size={13}
													className={clsx(
														"shrink-0",
														isCurrent ? "text-emerald-400" : "text-emerald-500/90",
													)}
												/>

												<button
													type="button"
													onClick={() => onSelect(wt.path)}
													aria-pressed={isSelected}
													className={clsx(
														"min-w-0 flex-1 truncate font-mono text-xs font-medium text-left transition-colors",
														isCurrent
															? "text-emerald-300 font-semibold"
															: isSelected
																? "text-indigo-200"
																: "text-neutral-200 hover:text-indigo-300",
													)}
													title={`查看这个工作树的改动和历史\n${wt.path}`}
												>
													{displayName}
												</button>
											</div>

											{/* Right-side hover actions */}
											<div className="absolute right-1 top-1 flex items-center gap-1 shrink-0 bg-neutral-900/95 border border-neutral-700/80 rounded px-1 py-0.5 shadow-md opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
												<button
													type="button"
													onClick={() => openInExplorer(wt.path)}
													title="在右侧文件浏览器中打开该工作树目录"
													aria-label="在右侧文件浏览器中打开该工作树目录"
													className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
												>
													<PanelRight size={12} />
												</button>

												<button
													type="button"
													onClick={() =>
														openModal("new-session", { cwd: wt.path })
													}
													title="在此工作树新建会话"
													aria-label="在此工作树新建会话"
													className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
												>
													<Plus size={12} />
												</button>

												{!isMain && (
													<button
														type="button"
														disabled={isCleaning || isCurrent}
														onClick={() => onClean(wt)}
														title={
															isCurrent
																? "当前工作树使用中，无法清理"
																: "清理此工作树"
														}
														aria-label={
															isCurrent
																? "当前工作树使用中，无法清理"
																: "清理此工作树"
														}
														className={clsx(
															"rounded p-0.5 text-neutral-400 transition-colors",
															isCurrent
																? "cursor-not-allowed opacity-30"
																: "hover:bg-neutral-700 hover:text-rose-400",
														)}
													>
														{isCleaning ? (
															<Loader2 size={12} className="animate-spin" />
														) : (
															<Trash2 size={12} />
														)}
													</button>
												)}
											</div>
										</div>

										{/* Line 2: Status badges indented underneath */}
										<div className="flex flex-wrap items-center gap-1.5 mt-1 ml-[18px]">
												{isMain && (
													<span
														className="shrink-0 rounded bg-neutral-800/90 border border-neutral-700/60 px-1.5 py-0.2 text-[9px] text-neutral-400"
														title="项目的原始文件夹，未进行分支隔离"
													>
														原始目录
													</span>
												)}

												{isCurrent && (
													<span
														className="shrink-0 rounded bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-300"
														title="当前窗口正在查看和使用的工作树"
													>
														当前
													</span>
												)}

												{wt.dirty > 0 ? (
													<span
														className="shrink-0 rounded bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.2 text-[9px] font-medium text-amber-400"
														title="还没提交（git commit）保存的修改数量"
													>
														{wt.dirty} 处未提交
													</span>
												) : (
													<span className="shrink-0 text-[9px] text-neutral-500">
														无改动
													</span>
												)}

												{wt.sessionIds.length > 0 && (
													<button
														type="button"
														onClick={() => {
															if (wt.sessionIds.length > 1) {
																setSessionMenuWt(
																	sessionMenuWt === wt.path ? null : wt.path,
																);
															} else {
																selectSession(wt.sessionIds[0]);
															}
														}}
														className="shrink-0 rounded bg-indigo-950/70 border border-indigo-700/40 px-1.5 py-0.2 text-[10px] text-indigo-300 hover:bg-indigo-900 hover:text-indigo-100 transition-colors"
														title={`关联 ${wt.sessionIds.length} 个会话，点击切换或查看`}
													>
														{wt.sessionIds.length} 会话{wt.sessionIds.length > 1 ? " ▾" : ""}
													</button>
												)}
											</div>
									</div>
								</div>

								{/* Multi-session picker menu popover */}
								{sessionMenuWt === wt.path && wt.sessionIds.length > 1 && (
									<div
										className="relative z-20 mt-1 ml-9 rounded-md border border-neutral-700 bg-neutral-900/95 p-1 shadow-2xl backdrop-blur-md"
										onClick={(e) => e.stopPropagation()}
									>
										<div className="flex items-center justify-between px-2 py-1 text-[10px] font-medium text-neutral-400 border-b border-neutral-800">
											<span>选择该工作树关联的会话 ({wt.sessionIds.length})</span>
											<button
												type="button"
												onClick={() => setSessionMenuWt(null)}
												title="关闭"
												aria-label="关闭"
												className="text-neutral-500 hover:text-neutral-300 text-[10px]"
											>
												关闭
											</button>
										</div>
										<div className="max-h-48 overflow-y-auto py-1 space-y-0.5">
											{wt.sessionIds.map((id) => {
												const s = sessions[id];
												const label = s?.label ?? id.slice(0, 6);
												const title = s?.title || "未命名会话";
												return (
													<button
														key={id}
														type="button"
														onClick={() => {
															selectSession(id);
															setSessionMenuWt(null);
														}}
														className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-neutral-800 hover:text-indigo-300 transition-colors"
														title={title}
													>
														<span className="shrink-0 font-mono text-[11px] text-indigo-400 bg-indigo-950/60 px-1 py-0.5 rounded border border-indigo-800/40">
															{label}
														</span>
														<span className="min-w-0 flex-1 truncate text-neutral-300 text-[11px]">
															{title}
														</span>
														{s?.archived && (
															<span className="shrink-0 text-[9px] text-neutral-500 rounded bg-neutral-800 px-1 py-0.5">
																已归档
															</span>
														)}
													</button>
												);
											})}
											<button
												type="button"
												onClick={() => {
													setSessionMenuWt(null);
													openModal("new-session", { cwd: wt.path });
												}}
												className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[11px] text-indigo-400 hover:bg-neutral-800 hover:text-indigo-300 transition-colors border-t border-neutral-800/80 pt-1.5"
											>
												<Plus size={11} /> 在此工作树新建会话…
											</button>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			</div>

			{/* Section 2: Idle Branches */}
			{idleBranches.length > 0 && (
				<div className="space-y-0.5 pt-1.5 border-t border-neutral-800/50">
					{/* Section Header 2: Concise + Info Circle */}
					<div className="flex items-center gap-1.5 px-1 py-1 text-neutral-400 font-medium text-[11px]">
						<span className="h-1.5 w-1.5 rounded-full bg-neutral-500" />
						<span>未建工作树的分支</span>
						<span className="font-mono text-[10px] text-neutral-500">({idleBranches.length + hiddenIdleCount})</span>
						<span
							title="仅为 Git 分支指针，尚未在磁盘创建独立文件夹；点击右侧「+ 建工作树」即可开启隔离环境"
							className="cursor-help text-neutral-500 hover:text-neutral-300 transition-colors"
						>
							<Info size={11} />
						</span>
					</div>

					{/* Idle Branches Tree */}
					<div className="flex flex-col">
						{idleBranches.map((branch, index) => {
							const isLast = index === idleBranches.length - 1 && hiddenIdleCount === 0;

							return (
								<div
									key={`idle:${branch}`}
									className="group flex items-center min-h-[34px]"
								>
									{/* Straight line with subtle rounded corner */}
									<TreeBranchStem isLast={isLast} isWorktree={false} />

									{/* Row content */}
									<div className="relative flex min-w-0 flex-1 items-center rounded px-2 py-1 hover:bg-neutral-800/40 transition-colors">
										<div className="flex min-w-0 items-center gap-1.5">
											{/* Git branch badge/icon */}
											<GitBranch size={12} className="shrink-0 text-neutral-500 group-hover:text-neutral-300 transition-colors" />
											<span
												className="truncate font-mono text-xs text-neutral-400 group-hover:text-neutral-200 transition-colors"
												title={branch}
											>
												{branch}
											</span>
										</div>
										{/* Action to spawn a worktree on this branch */}
										<button
											type="button"
											onClick={() => {
												openModal("new-session", {
													cwd: repo,
													branch: branch,
													useWorktree: true,
												});
											}}
											title="基于此分支新建工作树并开启会话"
											aria-label="基于此分支新建工作树并开启会话"
											className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded bg-neutral-800 hover:bg-indigo-600 px-2 py-0.5 text-[10px] font-medium text-neutral-300 hover:text-white transition-all shadow-md opacity-0 group-hover:opacity-100 focus-within:opacity-100"
										>
											<Plus size={10} />
											<span>建工作树</span>
										</button>
									</div>
								</div>
							);
						})}

						{/* Expander row for idle branches */}
						{hiddenIdleCount > 0 && (
							<div className="flex items-center min-h-[32px]">
								<TreeBranchStem isLast={true} isWorktree={false} />
								<button
									type="button"
									onClick={() => setIdleExpanded(true)}
									className="ml-1 rounded px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300 transition-colors"
								>
									还有 {hiddenIdleCount} 个未检出分支 · 展开全部…
								</button>
							</div>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
