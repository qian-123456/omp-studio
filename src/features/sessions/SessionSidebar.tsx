import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import {
	AlertCircle,
	Archive,
	ChevronDown,
	ChevronRight,
	Folder,
	FolderGit2,
	FolderPlus,
	Globe,
	Inbox,
	Plus,
	Search,
	X,
} from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import type { Workspace } from "../../lib/contracts";
import { addWorkspace } from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { SessionRow } from "./SessionRow";
import { groupSessions } from "./grouping";

/**
 * [A] Left column: complete session list grouped by workspace (§11 A).
 * - Global workspace fixed on top
 * - Registered workspaces
 * - Worktree/branch subgrouping when > 1
 * - Unassigned ("未归档") bucket collapsed by default, grouped by cwd
 * - Search + Archive toggle
 * - Pinned sessions first
 * - Indented side chats (max depth 3)
 */
export function SessionSidebar() {
	const sessions = useSessions((s) => s.sessions);
	const workspaces = useSessions((s) => s.workspaces);
	const loadSessions = useSessions((s) => s.load);
	const openModal = useUi((s) => s.openModal);

	// Load data on initial mount
	useEffect(() => {
		loadSessions().catch((err) => {
			setErrorMessage(`加载会话列表失败: ${err instanceof Error ? err.message : String(err)}`);
		});
	}, [loadSessions]);

	// Search & Archive controls
	const [searchQuery, setSearchQuery] = useState("");
	const [showArchived, setShowArchived] = useState(false);

	// Collapsible states
	const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
	const [unassignedExpanded, setUnassignedExpanded] = useState(false);

	// Visible error message banner
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// Compute grouped tree
	const grouped = useMemo(() => {
		return groupSessions(sessions, workspaces, {
			searchQuery,
			showArchived,
		});
	}, [sessions, workspaces, searchQuery, showArchived]);

	const toggleGroupCollapse = (id: string) => {
		setCollapsedGroups((prev) => ({
			...prev,
			[id]: !prev[id],
		}));
	};

	// Add workspace via folder picker
	const handleAddWorkspace = async () => {
		try {
			let selectedPath: string | null = null;
			try {
				const result = await open({
					directory: true,
					multiple: false,
					title: "选择要添加的工作区目录",
				});
				if (result && typeof result === "string") {
					selectedPath = result;
				}
			} catch {
				// Fallback for non-Tauri / test environments
				selectedPath = window.prompt("请输入工作区绝对路径：");
			}

			if (selectedPath) {
				await addWorkspace(selectedPath);
				await loadSessions();
			}
		} catch (err) {
			setErrorMessage(
				`添加工作区失败: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	// Open new session modal for a workspace
	const handleNewSession = (ws: Workspace, e: React.MouseEvent) => {
		e.stopPropagation();
		openModal("new-session", {
			workspaceId: ws.id,
			cwd: ws.path,
		});
	};

	// Add unassigned cwd as workspace
	const handleAddCwdAsWorkspace = async (cwd: string, e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			await addWorkspace(cwd);
			await loadSessions();
		} catch (err) {
			setErrorMessage(
				`添加工作区失败: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	};

	return (
		<div className="flex h-full flex-col bg-neutral-900/60 text-neutral-300 text-xs">
			{/* Top Bar: Search + Archive Toggle + Add Workspace */}
			<div className="flex flex-col gap-2 border-b border-neutral-800 p-2.5">
				<div className="flex items-center justify-between">
					<span className="font-semibold text-neutral-200 text-xs tracking-wide">
						会话列表
					</span>

					<div className="flex items-center gap-1">
						{/* Toggle Archive */}
						<button
							type="button"
							onClick={() => setShowArchived((v) => !v)}
							className={clsx(
								"flex items-center gap-1 rounded px-2 py-1 transition-colors text-[11px]",
								showArchived
									? "bg-amber-950/60 text-amber-300 border border-amber-800/60"
									: "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
							)}
							title={showArchived ? "隐藏已归档会话" : "显示已归档会话"}
						>
							<Archive size={12} />
							<span>归档</span>
						</button>

						{/* Add Workspace Button */}
						<button
							type="button"
							onClick={handleAddWorkspace}
							className="flex items-center gap-1 rounded px-2 py-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors text-[11px]"
							title="添加工作区目录"
						>
							<FolderPlus size={12} />
							<span>添加</span>
						</button>
					</div>
				</div>

				{/* Search Input Box */}
				<div className="relative flex items-center">
					<Search
						size={13}
						className="pointer-events-none absolute left-2.5 text-neutral-500"
					/>
					<input
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="搜索会话、分支、标签..."
						className="w-full rounded-md border border-neutral-800 bg-neutral-950/80 py-1.5 pl-8 pr-7 text-xs text-neutral-200 placeholder:text-neutral-500 focus:border-indigo-500/70 focus:outline-none"
					/>
					{searchQuery && (
						<button
							type="button"
							onClick={() => setSearchQuery("")}
							className="absolute right-2 text-neutral-500 hover:text-neutral-300"
							title="清空搜索"
						>
							<X size={13} />
						</button>
					)}
				</div>
			</div>

			{/* Visible Error Notification Banner */}
			{errorMessage && (
				<div className="flex items-center justify-between border-b border-rose-900/50 bg-rose-950/40 px-3 py-2 text-rose-200 text-xs">
					<div className="flex items-center gap-2 pr-2">
						<AlertCircle size={14} className="shrink-0 text-rose-400" />
						<span className="line-clamp-2">{errorMessage}</span>
					</div>
					<button
						type="button"
						onClick={() => setErrorMessage(null)}
						className="shrink-0 text-rose-400 hover:text-rose-200"
					>
						<X size={14} />
					</button>
				</div>
			)}

			{/* Session Groups Scroll Area */}
			<div className="flex-1 overflow-y-auto divide-y divide-neutral-800/40">
				{/* 1. 🌐 Global Workspace (Fixed on top) */}
				{grouped.globalGroup && (
					<div className="py-1">
						{/* Global Workspace Header */}
						<div
							onClick={() => toggleGroupCollapse(grouped.globalGroup!.workspace.id)}
							className="group flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 hover:bg-neutral-800/40 text-neutral-300"
						>
							<div className="flex items-center gap-1.5 min-w-0">
								{collapsedGroups[grouped.globalGroup.workspace.id] ? (
									<ChevronRight size={13} className="text-neutral-500 shrink-0" />
								) : (
									<ChevronDown size={13} className="text-neutral-500 shrink-0" />
								)}
								<Globe size={14} className="text-indigo-400 shrink-0" />
								<span className="font-semibold text-xs text-neutral-200 truncate">
									{grouped.globalGroup.workspace.name || "全局"}
								</span>
								<span className="rounded-full bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
									{grouped.globalGroup.totalCount}
								</span>
							</div>

							<button
								type="button"
								onClick={(e) => handleNewSession(grouped.globalGroup!.workspace, e)}
								className="rounded p-1 text-neutral-500 hover:bg-neutral-700/60 hover:text-neutral-200"
								title="+ 新会话"
							>
								<Plus size={13} />
							</button>
						</div>

						{/* Global Workspace Body */}
						{!collapsedGroups[grouped.globalGroup.workspace.id] && (
							<div>
								{grouped.globalGroup.totalCount === 0 ? (
									<div className="px-6 py-2 text-[11px] text-neutral-500 italic">
										暂无全局会话
									</div>
								) : grouped.globalGroup.hasMultipleSubgroups ? (
									// Multiple Worktrees / Branches Subgrouping
									grouped.globalGroup.subgroups.map((sub) => (
										<div key={sub.key} className="mt-1">
											<div className="flex items-center gap-1 px-4 py-1 text-[10px] font-medium text-neutral-400">
												{sub.kind === "worktree" ? (
													<FolderGit2 size={11} className="text-neutral-500" />
												) : (
													<Folder size={11} className="text-neutral-500" />
												)}
												<span className="truncate">{sub.label}</span>
												<span className="font-mono text-neutral-600">
													({sub.totalCount})
												</span>
											</div>
											{sub.nodes.map((node) => (
												<SessionRow
													key={node.session.id}
													session={node.session}
													depth={node.depth}
													workspaces={workspaces}
													onError={setErrorMessage}
												/>
											))}
										</div>
									))
								) : (
									// Single Subgroup or Direct
									grouped.globalGroup.subgroups[0]?.nodes.map((node) => (
										<SessionRow
											key={node.session.id}
											session={node.session}
											depth={node.depth}
											workspaces={workspaces}
											onError={setErrorMessage}
										/>
									))
								)}
							</div>
						)}
					</div>
				)}

				{/* 2. Registered Project Workspaces */}
				{grouped.workspaceGroups.map((wg) => (
					<div key={wg.workspace.id} className="py-1">
						{/* Workspace Group Header */}
						<div
							onClick={() => toggleGroupCollapse(wg.workspace.id)}
							className="group flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 hover:bg-neutral-800/40 text-neutral-300"
						>
							<div className="flex items-center gap-1.5 min-w-0">
								{collapsedGroups[wg.workspace.id] ? (
									<ChevronRight size={13} className="text-neutral-500 shrink-0" />
								) : (
									<ChevronDown size={13} className="text-neutral-500 shrink-0" />
								)}
								<Folder size={14} className="text-amber-500/80 shrink-0" />
								<span
									className="font-semibold text-xs text-neutral-200 truncate"
									title={wg.workspace.path}
								>
									{wg.workspace.name}
								</span>
								<span className="rounded-full bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
									{wg.totalCount}
								</span>
							</div>

							<button
								type="button"
								onClick={(e) => handleNewSession(wg.workspace, e)}
								className="rounded p-1 text-neutral-500 hover:bg-neutral-700/60 hover:text-neutral-200"
								title="+ 新会话"
							>
								<Plus size={13} />
							</button>
						</div>

						{/* Workspace Group Body */}
						{!collapsedGroups[wg.workspace.id] && (
							<div>
								{wg.totalCount === 0 ? (
									<div className="px-6 py-2 text-[11px] text-neutral-500 italic">
										暂无会话
									</div>
								) : wg.hasMultipleSubgroups ? (
									// Multiple Worktrees / Branches Subgrouping
									wg.subgroups.map((sub) => (
										<div key={sub.key} className="mt-1">
											<div className="flex items-center gap-1 px-4 py-1 text-[10px] font-medium text-neutral-400">
												{sub.kind === "worktree" ? (
													<FolderGit2 size={11} className="text-neutral-500" />
												) : (
													<Folder size={11} className="text-neutral-500" />
												)}
												<span className="truncate">{sub.label}</span>
												<span className="font-mono text-neutral-600">
													({sub.totalCount})
												</span>
											</div>
											{sub.nodes.map((node) => (
												<SessionRow
													key={node.session.id}
													session={node.session}
													depth={node.depth}
													workspaces={workspaces}
													onError={setErrorMessage}
												/>
											))}
										</div>
									))
								) : (
									// Single Subgroup or Direct
									wg.subgroups[0]?.nodes.map((node) => (
										<SessionRow
											key={node.session.id}
											session={node.session}
											depth={node.depth}
											workspaces={workspaces}
											onError={setErrorMessage}
										/>
									))
								)}
							</div>
						)}
					</div>
				))}

				{/* 3. Unassigned ("未归档") Bucket (Collapsed by default, grouped by cwd) */}
				<div className="py-1">
					<div
						onClick={() => setUnassignedExpanded((v) => !v)}
						className="group flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 hover:bg-neutral-800/40 text-neutral-400"
					>
						<div className="flex items-center gap-1.5 min-w-0">
							{unassignedExpanded ? (
								<ChevronDown size={13} className="text-neutral-500 shrink-0" />
							) : (
								<ChevronRight size={13} className="text-neutral-500 shrink-0" />
							)}
							<Inbox size={14} className="text-neutral-400 shrink-0" />
							<span className="font-medium text-xs text-neutral-300">
								未归档会话
							</span>
							<span className="rounded-full bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
								{grouped.unassignedGroup.totalCount}
							</span>
						</div>
					</div>

					{/* Unassigned Body (when expanded) */}
					{unassignedExpanded && (
						<div>
							{grouped.unassignedGroup.totalCount === 0 ? (
								<div className="px-6 py-2 text-[11px] text-neutral-500 italic">
									暂无未归档会话
								</div>
							) : (
								grouped.unassignedGroup.cwdGroups.map((cwdGroup) => (
									<div key={cwdGroup.cwd} className="my-1.5">
										{/* CWD Subgroup Header */}
										<div className="flex items-center justify-between bg-neutral-950/40 px-3 py-1 text-[11px] text-neutral-400 border-y border-neutral-800/40">
											<span
												className="truncate font-mono text-[10px] text-neutral-400 max-w-[160px]"
												title={cwdGroup.cwd}
											>
												{cwdGroup.cwd}
											</span>
											<button
												type="button"
												onClick={(e) => handleAddCwdAsWorkspace(cwdGroup.cwd, e)}
												className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] text-indigo-400 hover:bg-neutral-800 hover:text-indigo-300 transition-colors"
												title="将该目录添加为工作区"
											>
												<Plus size={10} />
												<span>添加为工作区</span>
											</button>
										</div>

										{/* Sessions under this cwd */}
										{cwdGroup.nodes.map((node) => (
											<SessionRow
												key={node.session.id}
												session={node.session}
												depth={node.depth}
												workspaces={workspaces}
												onError={setErrorMessage}
											/>
										))}
									</div>
								))
							)}
						</div>
					)}
				</div>

				{/* Global Empty State */}
				{grouped.totalVisible === 0 && (
					<div className="flex flex-col items-center justify-center p-6 text-center text-neutral-500">
						{searchQuery ? (
							<>
								<Search size={24} className="mb-2 text-neutral-600" />
								<div className="text-xs">未找到匹配会话</div>
								<button
									type="button"
									onClick={() => setSearchQuery("")}
									className="mt-2 text-[11px] text-indigo-400 hover:underline"
								>
									清空搜索条件
								</button>
							</>
						) : (
							<>
								<Inbox size={24} className="mb-2 text-neutral-600" />
								<div className="text-xs">暂无任何会话</div>
								<div className="mt-1 text-[11px] text-neutral-600">
									点击上方 "+ 新会话" 开始探索
								</div>
							</>
						)}
					</div>
				)}
			</div>
		</div>
	);
}
