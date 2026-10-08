import clsx from "clsx";
import {
	ChevronDown,
	FolderGit2,
	GitBranch,
	GitMerge,
	GitPullRequest,
	Info,
	Loader2,
	PanelRight,
	Plus,
	SquareTerminal,
	Trash2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FloatingLayer } from "../../components/FloatingLayer";
import type { ServiceInfo, WorktreeInfo } from "../../lib/contracts";
import { createSession } from "../../lib/createSession";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	addWorkspace,
	gitCreateWorktree,
	gitGetPrUrl,
	gitMergeBranch,
	gitMergePreview,
	gitSyncBranch,
	servicesList,
	updateSessionMeta,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useExplorer } from "../../stores/explorer";
import { useSessions } from "../../stores/sessions";
import { useSettings } from "../../features/settings/store";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { addTerminalTabWithCwd } from "../terminal/terminalTabs";
import { startSessionInWorktree } from "../sessions/newSession";
import { defaultSlug } from "./helpers";
import { OrphanBadge, OrphanInlinePanel, useOrphans } from "./OrphanBadge";
import { removeWorktreeFlow } from "./removeWorktree";
import { WorktreeHoverCard } from "./WorktreeHoverCard";

export function WorktreeSection({
	repo,
	worktrees,
	current,
	selected,
	selectedExplicit = true,
	onSelect,
	onChanged,
}: {
	repo: string;
	worktrees: WorktreeInfo[];
	current: string;
	selected: string;
	selectedExplicit?: boolean;
	onSelect: (path: string) => void;
	onChanged: () => void;
}) {
	const openModal = useUi((s) => s.openModal);
	const selectSession = useUi((s) => s.selectSession);
	const setRightTab = useUi((s) => s.setRightTab);
	const setExplorerWorkspace = useExplorer((s) => s.setWorkspaceId);
	const sessions = useSessions((s) => s.sessions);
	const workspaces = useSessions((s) => s.workspaces);
	const deliveryMode = useSettings((s) => s.settings?.gitDeliveryMode ?? "pr");

	const [services, setServices] = useState<ServiceInfo[]>([]);
	const [showCreate, setShowCreate] = useState(false);
	const [newWtName, setNewWtName] = useState("");
	const [creating, setCreating] = useState(false);
	const [cleaningPath, setCleaningPath] = useState<string | null>(null);
	const [actionRunning, setActionRunning] = useState<string | null>(null);
	const [sessionMenuWt, setSessionMenuWt] = useState<string | null>(null);
	const [sessionMenuAnchor, setSessionMenuAnchor] = useState<HTMLElement | null>(null);

	const [showOrphans, setShowOrphans] = useState(false);
	const orphanState = useOrphans(repo, onChanged);

	// WorktreeHoverCard state
	const [hoveredWt, setHoveredWt] = useState<WorktreeInfo | null>(null);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);

	useEscapeKey(() => {
		setSessionMenuWt(null);
		setShowCreate(false);
	});

	// Poll running dev services to extract live listening ports per worktree
	const loadServices = useCallback(async () => {
		try {
			const list = await servicesList(false);
			setServices(list);
		} catch {
			// ignore polling errors
		}
	}, []);

	useEffect(() => {
		void loadServices();
		const timer = window.setInterval(() => {
			void loadServices();
		}, 6000);
		return () => window.clearInterval(timer);
	}, [loadServices]);

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

	const handleCreateWorktree = async () => {
		const name = newWtName.trim() || defaultSlug("worktree");
		setCreating(true);
		try {
			await gitCreateWorktree(repo, name);
			void useWorktrees.getState().refresh();
			toast.success(`已创建工作树：${name}`);
			setNewWtName("");
			setShowCreate(false);
			onChanged();
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setCreating(false);
		}
	};

	const clean = async (wt: WorktreeInfo) => {
		setCleaningPath(wt.path);
		try {
			if (await removeWorktreeFlow(repo, wt)) {
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
				void useWorktrees.getState().refresh();
				toast.success("已清理工作树，并自动归档关联会话");
				onChanged();
			}
		} catch (e) {
			toast.error(errMsg(e));
		} finally {
			setCleaningPath(null);
		}
	};

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

	// Synchronize latest changes from main into this worktree
	const handleSyncFromMain = async (wt: WorktreeInfo) => {
		if (wt.branch === "main" || wt.branch === "master") {
			toast.info("当前工作树已在主干分支，无需同步自身");
			return;
		}

		setActionRunning(wt.path);
		try {
			const preview = await gitMergePreview(repo, wt.branch ?? "HEAD", "main");
			if (preview.hasConflicts) {
				const ok = await confirmDialog(
					`检测到 main 与当前工作树存在冲突文件：\n${preview.conflictingFiles.join("\n") || "多个文件冲突"}\n\n是否使用「AI 辅助解冲突」启动新会话？`,
					{
						title: "代码合并冲突预检",
						okLabel: "✨ AI 辅助解冲突",
						cancelLabel: "取消",
					},
				);
				if (ok) {
					await launchAiConflictSession(wt);
				}
				return;
			}

			const ok = await confirmDialog(
				`将从 main 同步最新提交 (${preview.commitsAhead} 个新提交) 入此工作树，预检无代码冲突。确认同步？`,
				{
					title: "从 main 同步更新",
					okLabel: "确认同步",
				},
			);
			if (!ok) return;

			await gitMergeBranch(wt.path, "main");
			toast.success("已成功从 main 同步更新代码");
			onChanged();
		} catch (e) {
			toast.error(`同步失败: ${errMsg(e)}`);
		} finally {
			setActionRunning(null);
		}
	};

	// Deliver to main: Mode A (GitHub PR) vs Mode B (Direct Merge)
	const handleDeliverToMain = async (wt: WorktreeInfo) => {
		if (wt.branch === "main" || wt.branch === "master") {
			toast.info("当前已在主干分支，无需交付");
			return;
		}

		const branchName = wt.branch;
		if (!branchName) {
			toast.error("历史快照游离工作树无法直接交付，请先绑定分支");
			return;
		}

		if (deliveryMode === "direct") {
			const ok = await confirmDialog(
				`确认将工作树「${branchName}」合并入本地 main 并推送到云端 origin/main？\n（这是直推模式，无需 PR 审查）`,
				{
					title: "直接合并入 main",
					danger: true,
					okLabel: "确认直接合并推送",
				},
			);
			if (!ok) return;

			setActionRunning(wt.path);
			try {
				await gitSyncBranch(repo, branchName, "push");
				await gitMergeBranch(repo, branchName);
				toast.success("已直接合并入 main");
				onChanged();
			} catch (e) {
				toast.error(`合并失败: ${errMsg(e)}`);
			} finally {
				setActionRunning(null);
			}
			return;
		}

		// Mode A: PR workflow
		setActionRunning(wt.path);
		try {
			await gitSyncBranch(repo, branchName, "push");
			const prInfo = await gitGetPrUrl(repo, branchName, "main");
			if (prInfo.prUrl) {
				await openUrl(prInfo.prUrl);
				toast.success("已在浏览器中打开 GitHub Pull Request 创建页");
			} else {
				toast.success(`已推送到云端 origin/${branchName}，未配置 GitHub 仓库链接`);
			}
		} catch (e) {
			toast.error(`交付/提 PR 失败: ${errMsg(e)}`);
		} finally {
			setActionRunning(null);
		}
	};

	// Launch AI conflict resolving session in this worktree
	const launchAiConflictSession = async (wt: WorktreeInfo) => {
		try {
			const targetWs = workspaces.find((w) => w.path === repo);
			const { sessionId, stub } = await createSession({
				cwd: wt.path,
				workspaceId: targetWs?.id,
			});
			useSessions.getState().upsert([stub]);
			useUi.getState().selectSession(sessionId);

			const prompt = `当前工作树 (${wt.branch ?? wt.path}) 从 main 合并代码遇到了冲突，请检查冲突标记并结合上下文代码逻辑协助解决冲突，最后运行测试验证。`;
			useComposer.getState().setDraft(sessionId, prompt);
			useComposer.getState().focusComposer(sessionId);
			toast.success("已创建解冲突会话，模型可在输入框随时调整");
		} catch (e) {
			toast.error(`启动解冲突会话失败: ${errMsg(e)}`);
		}
	};

	const mainPath = worktrees[0]?.path;

	return (
		<section className="space-y-1.5 select-none">
			{/* Header: Concise title with count and quick actions (NO ACCORDION) */}
			<div className="flex items-center justify-between px-1 py-0.5 text-xs">
				<div className="flex items-center gap-1.5 font-semibold text-neutral-200">
					<FolderGit2 size={13} className="text-emerald-400" />
					<span>活跃工作台</span>
					<span className="rounded-full bg-neutral-800 px-1.5 py-0.2 text-[10px] font-mono text-neutral-400">
						{worktrees.length}
					</span>
					<span
						title="每个工作树是一份独立的物理代码目录，支持多任务并行修改代码，互不干扰、互不踩文件"
						className="cursor-help text-neutral-500 hover:text-neutral-300 transition-colors"
					>
						<Info size={11} />
					</span>
				</div>

				<div className="flex items-center gap-1.5">
					<OrphanBadge
						count={orphanState.orphans.length}
						open={showOrphans}
						onToggle={() => setShowOrphans(!showOrphans)}
					/>
					<button
						type="button"
						onClick={() => setShowCreate(!showCreate)}
						title="新建并行工作树"
						aria-label="新建并行工作树"
						className={clsx(
							"flex items-center gap-1 rounded bg-neutral-800 hover:bg-neutral-700 px-2 py-0.5 text-[10px] font-medium text-neutral-300 hover:text-white transition-colors",
							showCreate && "bg-neutral-700 text-white",
						)}
					>
						<Plus size={11} />
						<span>新建工作树</span>
					</button>
				</div>
			</div>

			{/* Orphan worktrees inline recovery panel */}
			{showOrphans && orphanState.orphans.length > 0 && (
				<OrphanInlinePanel
					orphans={orphanState.orphans}
					busy={orphanState.busy}
					cleaningPath={orphanState.cleaningPath}
					error={orphanState.error}
					home={orphanState.home}
					onReclaim={orphanState.reclaim}
					onReclaimAll={orphanState.reclaimAll}
					onClose={() => setShowOrphans(false)}
					onDismiss={() => {
						orphanState.dismiss();
						setShowOrphans(false);
					}}
				/>
			)}

			{/* Inline worktree creation card */}
			{showCreate && (
				<div className="rounded-lg border border-neutral-800 bg-neutral-900/90 p-2 text-xs shadow-sm">
					<div className="mb-1 text-[11px] font-medium text-neutral-300">新建并行工作树</div>
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
							更多选项…
						</button>
					</div>
				</div>
			)}

			{/* Active Worktree Cards */}
			<div className="space-y-1.5">
				{worktrees.map((wt) => {
					const isMain = wt.path === mainPath;
					const isCurrent = wt.path === current;
					const isSelected = wt.path === selected;
					const isCleaning = cleaningPath === wt.path;
					const isBusy = actionRunning === wt.path;

					// Match running dev server ports
					const matchingServices = services.filter(
						(s) => s.cwd && (s.cwd === wt.path || s.cwd.startsWith(`${wt.path}/`)),
					);
					const uniquePorts = Array.from(new Set(matchingServices.map((s) => s.port)));

					const displayName = wt.branch ?? `历史测试 (${wt.head.slice(0, 7)})`;

					return (
						<div
							key={wt.path}
							onMouseEnter={(e) => handleItemMouseEnter(wt, e)}
							onMouseLeave={handleItemMouseLeave}
							className={clsx(
								"group relative rounded-lg border p-2 text-xs transition-all",
								isSelected && selectedExplicit
									? "border-indigo-500/60 bg-indigo-950/20 shadow-sm"
									: isCurrent
										? "border-emerald-500/40 bg-emerald-950/10"
										: "border-neutral-800/80 bg-neutral-900/40 hover:border-neutral-700/80 hover:bg-neutral-900/70",
							)}
						>
							{/* Top Row: Branch Name & Status Badges */}
							<div className="flex items-center justify-between gap-1.5 min-w-0">
								<div className="flex items-center gap-1.5 min-w-0 flex-1">
									<GitBranch
										size={13}
										className={clsx(
											"shrink-0",
											isCurrent ? "text-emerald-400" : "text-emerald-500/80",
										)}
									/>
									<button
										type="button"
										onClick={() => {
											dismissHover();
											onSelect(wt.path);
										}}
										title={displayName}
										className={clsx(
											"truncate font-mono text-xs font-medium text-left transition-colors",
											isCurrent
												? "text-emerald-300 font-semibold"
												: isSelected
													? "text-indigo-200 font-semibold"
													: "text-neutral-200 hover:text-indigo-300",
										)}
									>
										{displayName}
									</button>

									{/* Primary Badges */}
									{isMain && (
										<span
											title="该工作区的主工程仓库目录"
											className="shrink-0 rounded bg-neutral-800 border border-neutral-700 px-1 py-0.2 text-[9px] text-neutral-400"
										>
											原始目录
										</span>
									)}
									{isCurrent && (
										<span
											title="当前窗口正在查看和使用的工作树"
											className="shrink-0 rounded bg-emerald-500/20 border border-emerald-500/40 px-1 py-0.2 text-[9px] font-semibold text-emerald-300"
										>
											当前
										</span>
									)}
									{wt.dirty > 0 && (
										<button
											type="button"
											onClick={() => onSelect(wt.path)}
											title={`检测到 ${wt.dirty} 处未提交代码，点击查看改动`}
											className="shrink-0 rounded bg-purple-500/20 border border-purple-500/40 px-1 py-0.2 text-[9px] font-medium text-purple-300 hover:bg-purple-500/30 transition-colors"
										>
											{wt.dirty} 处未提交
										</button>
									)}
								</div>

								{/* Top Right: Port Badges & Session Dropdown Trigger */}
								<div className="flex items-center gap-1.5 shrink-0">
									{/* Live Port Pills */}
									{uniquePorts.map((port) => (
										<button
											key={port}
											type="button"
											onClick={() => {
												void openUrl(`http://localhost:${port}`);
												toast.success(`已在浏览器中打开 http://localhost:${port}`);
											}}
											title={`正在监听端口 :${port}，点击在浏览器中打开预览`}
											className="flex items-center gap-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 px-1.5 py-0.2 text-[10px] font-mono font-medium text-emerald-300 transition-colors"
										>
											<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
											<span>:{port}</span>
										</button>
									))}

									{/* Session Count Pill with Menu Trigger */}
									{wt.sessionIds.length > 0 && (
										<div className="relative">
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													dismissHover();
													if (sessionMenuWt === wt.path) {
														setSessionMenuWt(null);
														setSessionMenuAnchor(null);
													} else {
														setSessionMenuWt(wt.path);
														setSessionMenuAnchor(e.currentTarget);
													}
												}}
												title="查看关联会话"
												className="flex items-center gap-1 rounded bg-neutral-800 hover:bg-neutral-700 px-1.5 py-0.2 text-[10px] font-medium text-neutral-300 transition-colors"
											>
												<span>{wt.sessionIds.length} 会话</span>
												<ChevronDown size={10} className="text-neutral-500" />
											</button>
										</div>
									)}
								</div>
							</div>

							{/* Bottom Row: Actions Bar */}
							<div className="mt-1.5 flex items-center justify-between border-t border-neutral-800/60 pt-1 text-[11px]">
								<div className="flex items-center gap-1.5">
									{/* Sync from main */}
									{wt.branch && wt.branch !== "main" && wt.branch !== "master" && (
										<button
											type="button"
											disabled={isBusy}
											onClick={() => void handleSyncFromMain(wt)}
											title="从 main 吸收最新改动入此工作树 (带冲突预检)"
											className="flex items-center gap-1 rounded bg-neutral-800/80 hover:bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:text-emerald-300 transition-colors disabled:opacity-50"
										>
											<GitMerge size={10} />
											<span>从 main 同步</span>
										</button>
									)}

									{/* Deliver / PR */}
									{wt.branch && wt.branch !== "main" && wt.branch !== "master" && (
										<button
											type="button"
											disabled={isBusy}
											onClick={() => void handleDeliverToMain(wt)}
											title={
												deliveryMode === "direct"
													? "直接合并入 main 并推送到云端"
													: "推送到云端并打开 GitHub PR 创建页"
											}
											className="flex items-center gap-1 rounded bg-neutral-800/80 hover:bg-neutral-700 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:text-indigo-300 transition-colors disabled:opacity-50"
										>
											<GitPullRequest size={10} />
											<span>交付/提PR</span>
										</button>
									)}
								</div>

								{/* Utility actions on the right */}
								<div className="flex items-center gap-1 text-neutral-400">
									<button
										type="button"
										onClick={() => void startSessionInWorktree(wt.path)}
										title="在此工作树新建会话"
										className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
									>
										<Plus size={11} />
									</button>

									<button
										type="button"
										onClick={() => {
											const name = wt.branch ?? "worktree";
											addTerminalTabWithCwd(wt.path, name);
											setRightTab("terminal");
											toast.success(`已在「${name}」工作树打开终端`);
										}}
										title="在此工作树打开终端"
										className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
									>
										<SquareTerminal size={11} />
									</button>

									<button
										type="button"
										onClick={() => void openInExplorer(wt.path)}
										title="在右侧文件管理器中打开该工作树目录"
										className="rounded p-1 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
									>
										<PanelRight size={11} />
									</button>

									{!isMain && (
										<button
											type="button"
											disabled={isCleaning}
											onClick={() => void clean(wt)}
											title="清理此工作树"
											className="rounded p-1 hover:bg-rose-950/40 hover:text-rose-300 transition-colors disabled:opacity-50"
										>
											{isCleaning ? (
												<Loader2 size={11} className="animate-spin text-rose-400" />
											) : (
												<Trash2 size={11} />
											)}
										</button>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>

			{/* Floating Session Menu */}
			{sessionMenuWt && sessionMenuAnchor && (
				<FloatingLayer
					anchor={sessionMenuAnchor}
					placement="bottom-end"
					layer="menu"
					onDismiss={() => {
						setSessionMenuWt(null);
						setSessionMenuAnchor(null);
					}}
					className="w-56 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-xl text-xs"
				>
					<div className="px-2 py-1 text-[10px] font-semibold text-neutral-400 border-b border-neutral-800">
						关联会话
					</div>
					<div className="max-h-48 overflow-y-auto py-1">
						{(() => {
							const wt = worktrees.find((w) => w.path === sessionMenuWt);
							if (!wt || wt.sessionIds.length === 0) {
								return <div className="px-2 py-1 text-neutral-500">暂无会话</div>;
							}
							return wt.sessionIds.map((sid) => {
								const s = sessions[sid];
								return (
									<button
										key={sid}
										type="button"
										onClick={() => {
											setSessionMenuWt(null);
											setSessionMenuAnchor(null);
											selectSession(sid);
										}}
										className="flex w-full items-center justify-between rounded px-2 py-1 text-left text-neutral-300 hover:bg-neutral-800 hover:text-white transition-colors"
									>
										<span className="truncate flex-1 font-mono text-[11px]">
											{s?.title || sid.slice(0, 8)}
										</span>
									</button>
								);
							});
						})()}
					</div>
				</FloatingLayer>
			)}

			{/* Hover card floating preview */}
			<WorktreeHoverCard
				wt={hoveredWt}
				anchorRect={anchorRect}
				open={hoveredWt !== null && anchorRect !== null}
				isCurrent={hoveredWt?.path === current}
			/>
		</section>
	);
}
