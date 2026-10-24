import clsx from "clsx";
import { ChevronDown, GitBranch, Info, Loader2, PanelRight, Plus, SquareTerminal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { WorktreeInfo } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { addWorkspace, gitListBranches } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { HoverScrollText } from "../../components/HoverScrollText";
import { WorktreeHoverCard } from "./WorktreeHoverCard";
import { useExplorer } from "../../stores/explorer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useT } from "../../stores/language";
import { addTerminalTabWithCwd } from "../terminal/terminalTabs";
import { startSessionInWorktree } from "../sessions/newSession";

/** Idle (worktree-less) branches beyond this count collapse behind an expander row. */
const IDLE_BRANCH_CAP = 15;
const ACTIVE_WORKTREE_CAP = 6;

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
	selectedExplicit = true,
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
	/** True when the user clicked a worktree; false = default (repo root). */
	selectedExplicit?: boolean;
	onSelect: (path: string) => void;
	cleaningPath: string | null;
	sessionMenuWt: string | null;
	setSessionMenuWt: (path: string | null) => void;
	onClean: (wt: WorktreeInfo) => void;
}) {
	const { t } = useT();
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
			toast.error(t("worktree.graph.openInSidebarFailed", { error: errMsg(e) }));
		}
	};

	const [branches, setBranches] = useState<string[] | null>(null);
	const [idleExpanded, setIdleExpanded] = useState(false);
	const [wtExpanded, setWtExpanded] = useState(false);
	const [sessionMenuAnchor, setSessionMenuAnchor] = useState<HTMLElement | null>(null);
	// WorktreeHoverCard state (opens cleanly to the LEFT)
	const [hoveredWt, setHoveredWt] = useState<WorktreeInfo | null>(null);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);

	const handleItemMouseEnter = (wt: WorktreeInfo, e: React.MouseEvent<HTMLDivElement>) => {
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
		const rect = e.currentTarget.getBoundingClientRect();
		hoverTimer.current = window.setTimeout(() => {
			setHoveredWt(wt);
			setAnchorRect(rect);
		}, 400);
	};

	const dismissHover = () => {
		if (hoverTimer.current !== null) {
			window.clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
		setHoveredWt(null);
		setAnchorRect(null);
	};

	const handleItemMouseLeave = () => {
		if (hoverTimer.current !== null) {
			window.clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
		closeTimer.current = window.setTimeout(() => {
			dismissHover();
		}, 150);
	};
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
			{/* Section 1: Active Worktrees */}
			<div className="space-y-0.5">
				{/* Section Header 1: Concise + Info Circle */}
				<div className="flex items-center gap-1.5 px-1 py-1 text-neutral-400 font-medium text-[11px]">
					<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
					<span>{t("worktree.graph.activeWorktrees")}</span>
					<span
						title={t("worktree.graph.activeWorktreesDesc")}
						className="cursor-help text-neutral-500 hover:text-neutral-300 transition-colors"
					>
						<Info size={11} />
					</span>
				</div>

				{/* Worktrees Tree */}
				{(() => {
					const visibleWorktrees = wtExpanded
						? activeWorktrees
						: activeWorktrees.slice(0, ACTIVE_WORKTREE_CAP);
					const hiddenWtCount = activeWorktrees.length - visibleWorktrees.length;
					return (
						<div className="flex flex-col">
							{visibleWorktrees.map((wt, index) => {
								const isLast = index === visibleWorktrees.length - 1 && hiddenWtCount === 0;
								const isMain = wt.path === mainPath;
								const isCurrent = wt.path === current;
								const isSelected = wt.path === selected;
								const isCleaning = cleaningPath === wt.path;

								// Friendly display name: avoid detached jargon
								const displayName = wt.branch
									? wt.branch
									: t("worktree.graph.historyVersion", { head: wt.head.slice(0, 7) });

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
										onMouseEnter={(e) => handleItemMouseEnter(wt, e)}
										onMouseLeave={handleItemMouseLeave}
										className={clsx(
											"relative flex min-w-0 flex-1 flex-col justify-center rounded border px-2 py-1.5 transition-colors",
											isSelected && selectedExplicit
												? "border-indigo-500/50 bg-indigo-500/10 shadow-sm"
												: isSelected
													? "border-neutral-700/60 bg-neutral-800/30"
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
													onClick={() => {
														dismissHover();
														onSelect(wt.path);
													}}
													aria-pressed={isSelected}
													className={clsx(
														"min-w-0 flex-1 font-mono text-xs font-medium text-left transition-colors",
														isCurrent
															? "text-emerald-300 font-semibold"
															: isSelected
																? "text-indigo-200"
																: "text-neutral-200 hover:text-indigo-300",
													)}
												>
													<HoverScrollText
														text={displayName}
														extraEndPadding={78}
														className="max-w-full"
														title={displayName}
													/>
												</button>
											</div>

											{/* Right-side hover actions */}
											<div
												onMouseEnter={(e) => {
													e.stopPropagation();
													dismissHover();
												}}
												onMouseOver={(e) => e.stopPropagation()}
												className="absolute right-1 top-1 flex items-center gap-1 shrink-0 bg-neutral-900/95 border border-neutral-700/80 rounded px-1 py-0.5 shadow-md opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
											>
												<button
													type="button"
													onClick={() => {
														dismissHover();
														openInExplorer(wt.path);
													}}
													title={t("worktree.graph.openExplorer")}
													aria-label={t("worktree.graph.openExplorer")}
													className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
												>
													<PanelRight size={12} />
												</button>

												<button
													type="button"
													onClick={() => {
														dismissHover();
														const name = wt.branch || wt.path.split(/[\\/]/).filter(Boolean).pop() || wt.path;
														if (addTerminalTabWithCwd(wt.path, name)) {
															setRightTab("terminal");
															toast.success(t("worktree.openedTerminal", { name }));
														}
													}}
													title={t("worktree.graph.openTerminal")}
													aria-label={t("worktree.graph.openTerminal")}
													className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
												>
													<SquareTerminal size={12} />
												</button>

												<button
													type="button"
													onClick={() => {
														dismissHover();
														void startSessionInWorktree(wt.path);
													}}
													title={t("worktree.newSessionInWorktree")}
													aria-label={t("worktree.newSessionInWorktree")}
													className="rounded p-0.5 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-100 transition-colors"
												>
													<Plus size={12} />
												</button>

												{!isMain && (
													<button
														type="button"
														disabled={isCleaning || isCurrent}
														onClick={() => {
															dismissHover();
															onClean(wt);
														}}
														title={
															isCurrent
																? t("worktree.graph.inUseCannotClean")
																: t("worktree.graph.cleanWorktree")
														}
														aria-label={
															isCurrent
																? t("worktree.graph.inUseCannotClean")
																: t("worktree.graph.cleanWorktree")
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
														title={t("worktree.graph.mainRootTitle")}
													>
														{t("worktree.graph.mainRoot")}
													</span>
												)}

												{isCurrent && (
													<span
														className="shrink-0 rounded bg-emerald-500/20 border border-emerald-500/40 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-300"
														title={t("worktree.graph.currentTitle")}
													>
														{t("worktree.currentBadge")}
													</span>
												)}

												{wt.dirty > 0 ? (
													<span
														className="shrink-0 rounded bg-amber-500/10 border border-amber-500/30 px-1.5 py-0.2 text-[9px] font-medium text-amber-400"
														title={t("worktree.graph.dirtyTitle")}
													>
														{t("worktree.graph.dirtyCount", { count: wt.dirty })}
													</span>
												) : (
													<span className="shrink-0 text-[9px] text-neutral-500">
														{t("worktree.graph.noChanges")}
													</span>
												)}

												{wt.sessionIds.length > 0 && (
													<button
														type="button"
														onClick={(e) => {
															if (wt.sessionIds.length > 1) {
																setSessionMenuAnchor(e.currentTarget);
																setSessionMenuWt(
																	sessionMenuWt === wt.path ? null : wt.path,
																);
															} else {
																selectSession(wt.sessionIds[0]);
															}
														}}
														className="shrink-0 rounded bg-indigo-950/70 border border-indigo-700/40 px-1.5 py-0.2 text-[10px] text-indigo-300 hover:bg-indigo-900 hover:text-indigo-100 transition-colors"
														title={t("worktree.graph.linkedSessionTitle", { count: wt.sessionIds.length })}
													>
														{t("worktree.sessionsCount", { count: wt.sessionIds.length })}{wt.sessionIds.length > 1 ? " ▾" : ""}
													</button>
												)}
											</div>
									</div>
								</div>

								{/* Multi-session picker menu popover */}
								{sessionMenuWt === wt.path && wt.sessionIds.length > 1 && (
									<FloatingLayer
										anchor={sessionMenuAnchor}
										placement="bottom-start"
										offset={4}
										layer="popover"
										onDismiss={() => {
											setSessionMenuWt(null);
											setSessionMenuAnchor(null);
										}}
										className="w-64 p-1 shadow-2xl"
									>
										<div className="flex items-center justify-between px-2 py-1 text-[10px] font-medium text-neutral-400 border-b border-[var(--border-divider)]">
											<span>{t("worktree.graph.selectSessionTitle", { count: wt.sessionIds.length })}</span>
											<button
												type="button"
												onClick={() => {
													setSessionMenuWt(null);
													setSessionMenuAnchor(null);
												}}
												title={t("common.close")}
												aria-label={t("common.close")}
												className="text-neutral-500 hover:text-neutral-300 text-[10px]"
											>
												{t("common.close")}
											</button>
										</div>
										<div className="max-h-48 overflow-y-auto py-1 space-y-0.5">
											{wt.sessionIds.map((id) => {
												const s = sessions[id];
												const label = s?.label ?? id.slice(0, 6);
												const title = s?.title || t("git.timeline.unnamedSession");
												return (
													<button
														key={id}
														type="button"
														onClick={() => {
															selectSession(id);
															setSessionMenuWt(null);
															setSessionMenuAnchor(null);
														}}
														className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs text-neutral-200 hover:bg-[var(--bg-hover)] hover:text-indigo-300 transition-colors"
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
																{t("worktree.graph.archivedBadge")}
															</span>
														)}
													</button>
												);
											})}
											<button
												type="button"
												onClick={() => {
													setSessionMenuWt(null);
													setSessionMenuAnchor(null);
													void startSessionInWorktree(wt.path);
												}}
												className="flex w-full items-center gap-1 rounded px-2 py-1 text-left text-[11px] text-indigo-400 hover:bg-[var(--bg-hover)] hover:text-indigo-300 transition-colors border-t border-[var(--border-divider)] pt-1.5"
											>
												<Plus size={11} /> {t("worktree.graph.newSessionInWorktreeDots")}
											</button>
										</div>
									</FloatingLayer>
								)}
							</div>
						);
					})}

					{/* Expander row for active worktrees */}
					{hiddenWtCount > 0 && (
						<div className="flex items-center min-h-[32px]">
							<TreeBranchStem isLast={true} isWorktree={true} />
							<button
								type="button"
								onClick={() => setWtExpanded(true)}
								className="ml-1 flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300 transition-colors"
							>
								<ChevronDown size={12} />
								<span>{t("worktree.graph.moreWorktrees", { count: hiddenWtCount })}</span>
							</button>
						</div>
					)}
					{wtExpanded && activeWorktrees.length > ACTIVE_WORKTREE_CAP && (
						<div className="flex items-center min-h-[28px] pl-7">
							<button
								type="button"
								onClick={() => setWtExpanded(false)}
								className="rounded px-2 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300 transition-colors"
							>
								{t("worktree.graph.collapseWorktrees")}
							</button>
						</div>
					)}
				</div>
			);
		})()}
			</div>
			{/* Section 2: Idle Branches */}
			{idleBranches.length > 0 && (
				<div className="space-y-0.5 pt-1.5 border-t border-neutral-800/50">
					{/* Section Header 2: Concise + Info Circle */}
					<div className="flex items-center gap-1.5 px-1 py-1 text-neutral-400 font-medium text-[11px]">
						<span className="h-1.5 w-1.5 rounded-full bg-neutral-500" />
						<span>{t("worktree.graph.idleBranches")}</span>
						<span className="font-mono text-[10px] text-neutral-500">({idleBranches.length + hiddenIdleCount})</span>
						<span
							title={t("worktree.graph.idleBranchesDesc")}
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
											<HoverScrollText
												text={branch}
												className="font-mono text-xs text-neutral-400 group-hover:text-neutral-200 transition-colors"
												title={branch}
											/>
											{/^(remotes\/)?origin\//.test(branch) ? (
												<span
													className="shrink-0 rounded border border-sky-500/30 bg-sky-500/10 px-1 text-[9px] text-sky-300"
													title={t("worktree.graph.cloudBranchTitle")}
												>
													{t("worktree.graph.cloudBadge")}
												</span>
											) : (
												<span
													className="shrink-0 rounded border border-neutral-700/60 bg-neutral-800/60 px-1 text-[9px] text-neutral-400"
													title={t("worktree.graph.localBranchTitle")}
												>
													{t("worktree.graph.localBadge")}
												</span>
											)}
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
											title={t("worktree.graph.spawnWorktreeTitle")}
											aria-label={t("worktree.graph.spawnWorktreeTitle")}
											className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1 rounded bg-neutral-800 hover:bg-indigo-600 px-2 py-0.5 text-[10px] font-medium text-neutral-300 hover:text-white transition-all shadow-md opacity-0 group-hover:opacity-100 focus-within:opacity-100"
										>
											<Plus size={10} />
											<span>{t("worktree.graph.buildWorktree")}</span>
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
									{t("worktree.graph.moreIdleBranches", { count: hiddenIdleCount })}
								</button>
							</div>
						)}
					</div>
				</div>
			)}
			{/* Floating preview card to the LEFT */}
			<WorktreeHoverCard
				wt={hoveredWt}
				anchorRect={anchorRect}
				open={hoveredWt !== null && anchorRect !== null}
				isCurrent={hoveredWt?.path === current}
				onClose={dismissHover}
			/>
		</div>
	);
}
