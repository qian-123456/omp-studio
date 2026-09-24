import clsx from "clsx";
import {
	AlertTriangle,
	Archive,
	ArchiveRestore,
	Check,
	CornerDownRight,
	ExternalLink,
	FolderInput,
	GitBranch,
	MoreHorizontal,
	Pencil,
	Pin,
	PinOff,
	Play,
	Stethoscope,
	Terminal,
	Trash2,
	X,
} from "lucide-react";
import React, { type MouseEvent, useEffect, useRef, useState } from "react";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import { relativeTime } from "../../lib/format";
import {
	gitRemoveWorktree,
	markSeen,
	rpcEnsureLive,
	takeoverExternal,
	updateSessionMeta,
} from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

interface SessionRowProps {
	session: SessionMeta;
	depth?: number;
	workspaces: Workspace[];
	onError: (err: string) => void;
}

/** Status dot rendering per §11 A spec. */
function renderStatusDot(status: SessionMeta["status"]) {
	switch (status) {
		case "working":
			return (
				<span className="relative flex h-2 w-2 shrink-0" title="执行中 (Working)">
					<span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
					<span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
				</span>
			);
		case "awaiting_approval":
			return (
				<span
					className="h-2 w-2 shrink-0 rounded-full bg-amber-400"
					title="等待审批 (AwaitingApproval)"
				/>
			);
		case "awaiting_answer":
			return (
				<span
					className="h-2 w-2 shrink-0 rounded-full bg-sky-400"
					title="等待回答 (AwaitingAnswer)"
				/>
			);
		case "review":
			return (
				<span
					className="h-2 w-2 shrink-0 rounded-full bg-orange-500"
					title="待验收 (Review)"
				/>
			);
		case "error":
			return (
				<span
					className="h-2 w-2 shrink-0 rounded-full bg-rose-500"
					title="异常 (Error)"
				/>
			);
		case "interrupted":
			return (
				<span
					className="h-2 w-2 shrink-0 rounded-full bg-rose-400/80 ring-1 ring-neutral-400"
					title="已中断 (Interrupted)"
				/>
			);
		case "suspended":
			return (
				<span
					className="h-2 w-2 shrink-0 rounded-full border border-neutral-400 bg-transparent"
					title="已挂起 (Suspended)"
				/>
			);
		case "external":
			return (
				<span
					className="h-2 w-2 shrink-0 rounded-full border-2 border-purple-500 bg-transparent"
					title="外部进程 (External)"
				/>
			);
		default:
			return (
				<span
					className="h-2 w-2 shrink-0 rounded-full bg-neutral-500"
					title="空闲 (Idle)"
				/>
			);
	}
}

export function SessionRow({
	session,
	depth = 0,
	workspaces,
	onError,
}: SessionRowProps) {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectSession = useUi((s) => s.selectSession);
	const sessionViewMode = useUi((s) => s.sessionViewMode[session.id] ?? "chat");
	const setSessionViewMode = useUi((s) => s.setSessionViewMode);
	const openModal = useUi((s) => s.openModal);

	const isSelected = selectedSessionId === session.id;
	const clampedDepth = Math.min(depth, 3);

	// Context menu & action modal states
	const [menuOpen, setMenuOpen] = useState(false);
	const [menuCoords, setMenuCoords] = useState<{ x: number; y: number } | null>(
		null,
	);
	const [showRenameModal, setShowRenameModal] = useState(false);
	const [renameValue, setRenameValue] = useState(session.title || "");
	const [showArchiveModal, setShowArchiveModal] = useState(false);
	const [showAssignModal, setShowAssignModal] = useState(false);
	const [showTakeoverModal, setShowTakeoverModal] = useState(false);

	const menuRef = useRef<HTMLDivElement>(null);

	// Close context menu on outside click
	useEffect(() => {
		if (!menuOpen) return;
		const handleClickOutside = (e: globalThis.MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setMenuOpen(false);
			}
		};
		window.addEventListener("mousedown", handleClickOutside);
		return () => window.removeEventListener("mousedown", handleClickOutside);
	}, [menuOpen]);

	const handleRowClick = async () => {
		try {
			selectSession(session.id);
			if (session.unread) {
				await markSeen(session.id);
				useSessions.getState().upsert([{ ...session, unread: false }]);
			}
		} catch (err) {
			onError(`选择会话失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	const handleContextMenu = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setMenuCoords({ x: e.clientX, y: e.clientY });
		setMenuOpen(true);
	};

	const handleMenuBtnClick = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		setMenuCoords({ x: rect.right - 180, y: rect.bottom + 4 });
		setMenuOpen((prev) => !prev);
	};

	// 1. Rename
	const handleRenameSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!renameValue.trim()) return;
		try {
			const updated = await updateSessionMeta(session.id, {
				customName: renameValue.trim(),
			});
			useSessions.getState().upsert([updated]);
			setShowRenameModal(false);
		} catch (err) {
			onError(`重命名失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	// 2. Pin / Unpin
	const handleTogglePin = async () => {
		setMenuOpen(false);
		try {
			const updated = await updateSessionMeta(session.id, {
				pinned: !session.pinned,
			});
			useSessions.getState().upsert([updated]);
		} catch (err) {
			onError(`切换置顶失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	// 3. Archive / Unarchive
	const handleArchiveClick = () => {
		setMenuOpen(false);
		if (session.archived) {
			// Unarchive directly
			updateSessionMeta(session.id, { archived: false })
				.then((updated) => useSessions.getState().upsert([updated]))
				.catch((err) => onError(`取消归档失败: ${err.message || String(err)}`));
			return;
		}

		if (session.git?.worktree) {
			// Worktree confirmation required
			setShowArchiveModal(true);
		} else {
			// No worktree, archive directly
			updateSessionMeta(session.id, { archived: true })
				.then((updated) => useSessions.getState().upsert([updated]))
				.catch((err) => onError(`归档失败: ${err.message || String(err)}`));
		}
	};

	const executeArchiveWithWorktree = async (cleanWorktree: boolean) => {
		setShowArchiveModal(false);
		try {
			if (cleanWorktree && session.git?.worktree) {
				const repo = session.repoRoot || session.cwd;
				await gitRemoveWorktree(repo, session.git.worktree, false, false);
			}
			const updated = await updateSessionMeta(session.id, { archived: true });
			useSessions.getState().upsert([updated]);
		} catch (err) {
			onError(`归档及清理失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	// 4. Assign Workspace
	const handleAssignWorkspace = async (workspaceId: string | null) => {
		setShowAssignModal(false);
		try {
			const updated = await updateSessionMeta(session.id, {
				workspaceId: workspaceId ?? undefined,
			});
			useSessions.getState().upsert([updated]);
		} catch (err) {
			onError(`分配工作区失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	// 5. Diagnose
	const handleDiagnose = () => {
		setMenuOpen(false);
		openModal("diagnose", { sessionId: session.id });
	};

	// 6. Resume
	const handleResume = async () => {
		setMenuOpen(false);
		try {
			await rpcEnsureLive(session.id);
			selectSession(session.id);
		} catch (err) {
			onError(`恢复会话失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	// 7. Toggle Terminal / Chat
	const handleToggleTerminal = () => {
		setMenuOpen(false);
		const targetMode = sessionViewMode === "terminal" ? "chat" : "terminal";
		setSessionViewMode(session.id, targetMode);
		selectSession(session.id);
	};

	// 8. Takeover External
	const handleTakeoverConfirm = async () => {
		setShowTakeoverModal(false);
		try {
			await takeoverExternal(session.id);
			selectSession(session.id);
		} catch (err) {
			onError(`接管会话失败: ${err instanceof Error ? err.message : String(err)}`);
		}
	};

	return (
		<div
			onClick={handleRowClick}
			onContextMenu={handleContextMenu}
			style={{ paddingLeft: `${8 + clampedDepth * 14}px` }}
			className={clsx(
				"group relative flex cursor-pointer select-none items-center justify-between gap-1.5 py-1.5 pr-2 transition-colors",
				isSelected
					? "bg-neutral-800 text-neutral-100"
					: "text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-200",
			)}
		>
			{/* Sub-branch indentation elbow guide */}
			{clampedDepth > 0 && (
				<CornerDownRight
					size={12}
					className="-ml-3 mr-0.5 shrink-0 text-neutral-600"
				/>
			)}

			<div className="flex min-w-0 flex-1 flex-col gap-0.5">
				{/* Top line: status dot + unread + label + title */}
				<div className="flex items-center gap-1.5 min-w-0">
					{renderStatusDot(session.status)}

					{session.unread && (
						<span
							className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500"
							title="未读"
						/>
					)}

					<span className="shrink-0 font-mono text-[11px] font-semibold text-neutral-300">
						{session.label}
					</span>

					<span className="truncate text-xs font-medium" title={session.title}>
						{session.title || "未命名会话"}
					</span>

					{session.pinned && (
						<Pin
							size={11}
							className="shrink-0 fill-amber-400/40 text-amber-400"
							aria-label="已置顶"
						/>
					)}

					{session.archived && (
						<span className="shrink-0 rounded bg-neutral-800 px-1 py-0.2 text-[9px] text-neutral-500">
							已归档
						</span>
					)}
				</div>

				{/* Second line: relative time · branch · dirty · result badge */}
				<div className="flex items-center gap-1.5 text-[10px] text-neutral-500">
					<span>{relativeTime(session.updatedAt || session.createdAt)}</span>

					{session.git?.branch && (
						<>
							<span>·</span>
							<span className="flex items-center gap-0.5 truncate max-w-[100px]">
								<GitBranch size={10} className="shrink-0" />
								{session.git.branch}
							</span>
						</>
					)}

					{session.git && session.git.dirty > 0 && (
						<span
							className="font-mono text-amber-400 font-semibold"
							title={`${session.git.dirty} 个未提交改动`}
						>
							●{session.git.dirty}
						</span>
					)}

					{session.result && (
						<span
							className="ml-auto shrink-0 text-xs"
							title={`${session.result.kind}: ${session.result.summary}`}
						>
							{session.result.ok ? "✅" : "❌"}
						</span>
					)}
				</div>
			</div>

			{/* Row Action Menu Button */}
			<button
				type="button"
				onClick={handleMenuBtnClick}
				className={clsx(
					"shrink-0 rounded p-1 hover:bg-neutral-700/60 hover:text-neutral-200",
					menuOpen
						? "text-neutral-200"
						: "text-neutral-500 opacity-0 group-hover:opacity-100",
				)}
				title="操作菜单"
			>
				<MoreHorizontal size={14} />
			</button>

			{/* Floating Context Menu */}
			{menuOpen && menuCoords && (
				<div
					ref={menuRef}
					style={{
						position: "fixed",
						left: `${Math.min(menuCoords.x, window.innerWidth - 200)}px`,
						top: `${Math.min(menuCoords.y, window.innerHeight - 260)}px`,
						zIndex: 50,
					}}
					className="w-44 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-xl text-neutral-300"
				>
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							setMenuOpen(false);
							setRenameValue(session.title || "");
							setShowRenameModal(true);
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						<Pencil size={13} />
						重命名
					</button>

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							handleTogglePin();
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						{session.pinned ? <PinOff size={13} /> : <Pin size={13} />}
						{session.pinned ? "取消置顶" : "置顶会话"}
					</button>

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							handleArchiveClick();
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						{session.archived ? (
							<ArchiveRestore size={13} />
						) : (
							<Archive size={13} />
						)}
						{session.archived ? "取消归档" : "归档会话"}
					</button>

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							setMenuOpen(false);
							setShowAssignModal(true);
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						<FolderInput size={13} />
						归入工作区…
					</button>

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							handleDiagnose();
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						<Stethoscope size={13} />
						诊断此会话
					</button>

					{(session.status === "interrupted" ||
						session.status === "suspended") && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								handleResume();
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-emerald-400 hover:bg-neutral-800 hover:text-emerald-300 text-left"
						>
							<Play size={13} />
							恢复会话
						</button>
					)}

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							handleToggleTerminal();
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						<Terminal size={13} />
						{sessionViewMode === "terminal" ? "切换聊天视图" : "终端视图"}
					</button>

					{(session.status === "external" || session.externalPid != null) && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								setMenuOpen(false);
								setShowTakeoverModal(true);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-purple-400 hover:bg-neutral-800 hover:text-purple-300 text-left"
						>
							<ExternalLink size={13} />
							接管会话…
						</button>
					)}
				</div>
			)}

			{/* Modal 1: Rename */}
			{showRenameModal && (
				<div
					onClick={(e) => e.stopPropagation()}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
				>
					<form
						onSubmit={handleRenameSubmit}
						className="w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-200 shadow-2xl"
					>
						<div className="flex items-center justify-between pb-3">
							<span className="font-semibold text-sm">重命名会话</span>
							<button
								type="button"
								onClick={() => setShowRenameModal(false)}
								className="text-neutral-400 hover:text-neutral-200"
							>
								<X size={16} />
							</button>
						</div>
						<input
							type="text"
							value={renameValue}
							onChange={(e) => setRenameValue(e.target.value)}
							autoFocus
							className="w-full rounded border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-100 focus:border-indigo-500 focus:outline-none"
							placeholder="输入新的会话名称"
						/>
						<div className="mt-4 flex justify-end gap-2 text-xs">
							<button
								type="button"
								onClick={() => setShowRenameModal(false)}
								className="rounded px-3 py-1.5 text-neutral-400 hover:bg-neutral-800"
							>
								取消
							</button>
							<button
								type="submit"
								className="rounded bg-indigo-600 px-3 py-1.5 text-white hover:bg-indigo-500"
							>
								保存
							</button>
						</div>
					</form>
				</div>
			)}

			{/* Modal 2: Archive with Worktree Confirmation */}
			{showArchiveModal && (
				<div
					onClick={(e) => e.stopPropagation()}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
				>
					<div className="w-full max-w-md rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-200 shadow-2xl">
						<div className="flex items-center gap-2 pb-2 text-amber-400 font-semibold text-sm">
							<AlertTriangle size={18} />
							<span>归档会话与工作树清理</span>
						</div>
						<p className="text-xs text-neutral-300 leading-relaxed">
							此会话关联了工作树：
							<code className="mx-1 rounded bg-neutral-800 px-1 py-0.5 font-mono text-[11px] text-neutral-200">
								{session.git?.worktree}
							</code>
						</p>

						{session.git && session.git.dirty > 0 && (
							<div className="my-3 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-300">
								⚠️ 警告：该工作树包含{" "}
								<span className="font-bold">{session.git.dirty}</span>{" "}
								个未提交的改动 (dirty)！系统拒绝静默删除，若清理将永久丢失改动。
							</div>
						)}

						<div className="mt-4 flex flex-col gap-2 text-xs">
							<button
								type="button"
								onClick={() => executeArchiveWithWorktree(false)}
								className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-left hover:bg-neutral-700"
							>
								<div className="font-semibold text-neutral-200">
									仅归档会话 (保留工作树)
								</div>
								<div className="text-[11px] text-neutral-400">
									会话归档，但保留工作树文件与本地分支。
								</div>
							</button>

							<button
								type="button"
								onClick={() => executeArchiveWithWorktree(true)}
								className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-left hover:bg-rose-900/40 text-rose-200"
							>
								<div className="font-semibold flex items-center gap-1.5">
									<Trash2 size={13} />
									归档并清理工作树
								</div>
								<div className="text-[11px] text-rose-300/80">
									执行安全删除 (无强制 force)，若工作树未落盘将中止。
								</div>
							</button>

							<button
								type="button"
								onClick={() => setShowArchiveModal(false)}
								className="mt-1 rounded px-3 py-1.5 text-neutral-400 hover:bg-neutral-800 text-center"
							>
								取消
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Modal 3: Assign to Workspace */}
			{showAssignModal && (
				<div
					onClick={(e) => e.stopPropagation()}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
				>
					<div className="w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-200 shadow-2xl">
						<div className="flex items-center justify-between pb-3">
							<span className="font-semibold text-sm">归入工作区</span>
							<button
								type="button"
								onClick={() => setShowAssignModal(false)}
								className="text-neutral-400 hover:text-neutral-200"
							>
								<X size={16} />
							</button>
						</div>
						<div className="max-h-60 overflow-y-auto space-y-1">
							{workspaces.map((ws) => (
								<button
									key={ws.id}
									type="button"
									onClick={() => handleAssignWorkspace(ws.id)}
									className={clsx(
										"flex w-full items-center justify-between rounded px-3 py-2 text-left text-xs hover:bg-neutral-800",
										session.workspaceId === ws.id
											? "bg-indigo-950/40 text-indigo-300"
											: "text-neutral-300",
									)}
								>
									<span className="truncate">
										{ws.kind === "global" ? `🌐 ${ws.name}` : `📁 ${ws.name}`}
									</span>
									{session.workspaceId === ws.id && <Check size={14} />}
								</button>
							))}

							<button
								type="button"
								onClick={() => handleAssignWorkspace(null)}
								className={clsx(
									"flex w-full items-center justify-between rounded px-3 py-2 text-left text-xs hover:bg-neutral-800",
									session.workspaceId == null
										? "bg-indigo-950/40 text-indigo-300"
										: "text-neutral-400",
								)}
							>
								<span>未归档 (移除工作区关联)</span>
								{session.workspaceId == null && <Check size={14} />}
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Modal 4: Takeover Confirmation */}
			{showTakeoverModal && (
				<div
					onClick={(e) => e.stopPropagation()}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
				>
					<div className="w-full max-w-sm rounded-lg border border-purple-500/40 bg-neutral-900 p-4 text-neutral-200 shadow-2xl">
						<div className="flex items-center gap-2 pb-2 text-purple-400 font-semibold text-sm">
							<ExternalLink size={18} />
							<span>接管外部会话</span>
						</div>
						<p className="text-xs text-neutral-300 leading-relaxed">
							接管外部会话：
							<strong className="text-rose-400">可能丢失未落盘状态</strong>
							。接管后该会话将由本应用作为主控进程管理。确定要继续接管吗？
						</p>
						<div className="mt-4 flex justify-end gap-2 text-xs">
							<button
								type="button"
								onClick={() => setShowTakeoverModal(false)}
								className="rounded px-3 py-1.5 text-neutral-400 hover:bg-neutral-800"
							>
								取消
							</button>
							<button
								type="button"
								onClick={handleTakeoverConfirm}
								className="rounded bg-purple-600 px-3 py-1.5 text-white hover:bg-purple-500"
							>
								确定接管
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
