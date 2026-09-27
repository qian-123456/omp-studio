import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { ChevronDown, FolderOpen, GitBranch, Info, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { WorktreeInfo } from "../../lib/contracts";
import { errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { gitCreateWorktree, updateSessionMeta } from "../../lib/ipc";
import { basename } from "../../lib/paths";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { defaultSlug } from "./helpers";
import { removeWorktreeFlow } from "./removeWorktree";

/** Worktrees of the repo with dirty flags, session labels, creation and switching. */
export function WorktreeSection({
	repo,
	worktrees,
	current,
	onChanged,
}: {
	repo: string;
	worktrees: WorktreeInfo[];
	current: string;
	onChanged: () => void;
}) {
	const sessions = useSessions((s) => s.sessions);
	const selectSession = useUi((s) => s.selectSession);
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
			toast.success(`已创建 worktree: ${name}`);
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
				toast.success("已清理 worktree 并自动归档关联会话");
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
				<span>并行工作区</span>
				{worktrees.length > 0 && (
					<span className="rounded-full bg-neutral-800 px-1.5 py-0.5 text-[10px] font-mono text-neutral-400">
						{worktrees.length}
					</span>
				)}
				<span
					title="Git Worktree：每个工作区是一份独立代码副本，让多个任务并行互不干扰"
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
					title="新建并行工作区"
					onClick={() => setShowCreate(!showCreate)}
					className="rounded p-1 text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 focus:opacity-100"
				>
					<Plus size={13} />
				</button>
			)}
		</div>

		{!collapsed && (
			<div className="border-t border-neutral-800 px-3 pb-2 pt-1">
			<p className="mb-2 text-[11px] leading-relaxed text-neutral-400">
				每个工作区是一份独立代码副本，让多个任务并行互不干扰 — 点 + 新建
			</p>

			{showCreate && (
				<div className="mb-2 rounded border border-neutral-800 bg-neutral-900/80 p-2 text-xs">
					<div className="mb-1 text-[11px] text-neutral-400">新建并行工作区 (Git Worktree)</div>
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
							placeholder="工作区名称（例如 feat-auth）"
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

			<ul className="space-y-1">
				{worktrees.map((wt, i) => {
					const main = i === 0;
					const isCurrent = wt.path === current;
					const isCleaning = cleaningPath === wt.path;

					return (
						<li
							key={wt.path}
							className={clsx(
								"group rounded px-1.5 py-1 text-xs transition-colors",
								isCurrent ? "bg-neutral-800/80" : "hover:bg-neutral-800/40",
							)}
						>
							<div className="flex items-center gap-1.5">
								<button
									type="button"
									onClick={() => {
										if (wt.sessionIds.length > 1) {
											setSessionMenuWt(sessionMenuWt === wt.path ? null : wt.path);
										} else if (wt.sessionIds.length === 1) {
											selectSession(wt.sessionIds[0]);
										} else if (!isCurrent) {
											openModal("new-session", { cwd: wt.path });
										}
									}}
									className="min-w-0 flex-1 text-left truncate text-neutral-200 hover:text-indigo-300"
									title={
										wt.sessionIds.length > 1
											? `点击选择会话 (该分支上有 ${wt.sessionIds.length} 个会话): ${wt.path}`
											: wt.sessionIds.length === 1
											? `点击切换至会话: ${wt.path}`
											: isCurrent
											? wt.path
											: `点击在此工作区新建会话: ${wt.path}`
									}
								>
									<span className="font-medium">{main ? "主目录" : basename(wt.path)}</span>
									{isCurrent && (
										<span className="ml-1.5 rounded bg-indigo-950 px-1 py-0.2 text-[10px] text-indigo-300 border border-indigo-800/50">
											当前
										</span>
									)}
									{wt.sessionIds.length > 1 ? (
										<span
											className="ml-1.5 text-[10px] text-neutral-400"
											title={`该分支上有 ${wt.sessionIds.length} 个会话`}
										>
											({wt.sessionIds.length} 会话 ▾)
										</span>
									) : wt.sessionIds.length === 1 ? (
										<span
											className="ml-1.5 text-[10px] text-neutral-400"
											title="该分支上有 1 个会话"
										>
											(1 会话)
										</span>
									) : null}
								</button>

								{wt.dirty && (
									<span className="shrink-0 text-[10px] text-amber-400" title="有未提交的改动">
										● 有改动
									</span>
								)}

								<div className="flex shrink-0 items-center gap-1">
									<button
										type="button"
										onClick={() => revealItemInDir(wt.path)}
										title="在系统文件管理器中显示"
										className="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-neutral-200 group-hover:opacity-100 focus:opacity-100"
									>
										<FolderOpen size={12} />
									</button>

									{!isCurrent && wt.sessionIds.length === 0 && (
										<button
											type="button"
											onClick={() => openModal("new-session", { cwd: wt.path })}
											title="在此工作区开启新会话"
											className="rounded p-0.5 text-neutral-400 opacity-0 hover:bg-neutral-700 hover:text-neutral-200 group-hover:opacity-100 focus:opacity-100"
										>
											<Plus size={12} />
										</button>
									)}

									{!main && (
										<button
											type="button"
											disabled={isCleaning || isCurrent}
											onClick={() => clean(wt)}
											title={
												isCurrent
													? "当前工作区正在使用中，无法清理"
													: isCleaning
													? "正在清理…"
													: "清理此工作区"
											}
											className={clsx(
												"flex items-center gap-0.5 rounded p-0.5 text-neutral-400 group-hover:opacity-100 focus:opacity-100 transition-opacity",
												isCurrent
													? "cursor-not-allowed opacity-30 group-hover:opacity-30"
													: "opacity-0 hover:bg-neutral-700 hover:text-rose-400 disabled:opacity-50",
											)}
										>
											{isCleaning ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={12} />}
										</button>
									)}
								</div>
							</div>

							<div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-neutral-500">
								<span className="truncate text-neutral-400 font-mono">
									{wt.branch ?? `detached ${wt.head.slice(0, 8)}`}
								</span>
								{wt.sessionIds.length > 0 && (
									<div className="flex items-center gap-1">
										{wt.sessionIds.length <= 3 ? (
											<>
												<span>· 会话:</span>
												{wt.sessionIds.map((id) => {
													const s = sessions[id];
													const label = s?.label ?? id.slice(0, 6);
													const isArchived = s?.archived;
													return (
														<button
															key={id}
															type="button"
															title={
																isArchived
																	? `已归档会话: ${s?.title ?? id} (该分支上有 ${wt.sessionIds.length} 个会话)`
																	: `切换到会话: ${s?.title ?? id} (该分支上有 ${wt.sessionIds.length} 个会话)`
															}
															onClick={() => selectSession(id)}
															className={clsx(
																"rounded px-1 py-0.2 text-[10px] font-mono border transition-colors",
																isArchived
																	? "bg-neutral-800/60 text-neutral-400 border-neutral-700/50 line-through"
																	: "bg-indigo-950/80 text-indigo-300 hover:bg-indigo-900 hover:text-indigo-100 border-indigo-800/40",
															)}
														>
															{label}
															{isArchived && <span className="ml-0.5 text-[9px] no-underline">·已删</span>}
														</button>
													);
												})}
											</>
										) : (
											<button
												type="button"
												onClick={() => setSessionMenuWt(sessionMenuWt === wt.path ? null : wt.path)}
												title={`该分支上有 ${wt.sessionIds.length} 个会话，点击查看列表`}
												className="rounded text-[10px] text-neutral-400 hover:text-neutral-200 transition-colors"
											>
												· {wt.sessionIds.length} 个会话 ▾
											</button>
										)}
									</div>
								)}
							</div>

							{/* 多会话弹出选择菜单 */}
							{sessionMenuWt === wt.path && wt.sessionIds.length > 1 && (
								<div
									className="mt-1.5 rounded-md border border-neutral-700 bg-neutral-900/95 p-1 shadow-2xl backdrop-blur-md"
									onClick={(e) => e.stopPropagation()}
								>
									<div className="flex items-center justify-between px-2 py-1 text-[10px] font-medium text-neutral-400 border-b border-neutral-800">
										<span>选择该工作区的关联会话 ({wt.sessionIds.length})</span>
										<button
											type="button"
											onClick={() => setSessionMenuWt(null)}
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
											<Plus size={11} /> 在此工作区新建会话…
										</button>
									</div>
								</div>
							)}
						</li>
					);
				})}
			</ul>
			</div>
		)}
		</section>
	);
}
