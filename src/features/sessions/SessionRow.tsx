import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	AlertTriangle,
	Archive,
	ArchiveRestore,
	Check,
	CheckCircle2,
	Copy,
	ExternalLink,
	FolderInput,
	FolderOpen,
	GitBranch,
	GitFork,
	Loader2,
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
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { relativeTime } from "../../lib/format";
import { sessionDisplayName } from "../../lib/sessionName";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import {
	acceptSession,
	deleteSession,
	gitRemoveWorktree,
	markSeen,
	takeoverExternal,
	updateSessionMeta,
} from "../../lib/ipc";
import { ensureLive, isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { archiveSession } from "./archiveUndo";
import { inferWorktreeName } from "./grouping";
import { HoverScrollText } from "../../components/HoverScrollText";
import { SessionHoverCard } from "./SessionHoverCard";
interface SessionRowProps {
	session: SessionMeta;
	/** Extra left padding (px) for nesting under a subgroup header. */
	indent?: number;
	/** Draw this row's segment of the subgroup guide line at the row's left edge. */
	withSpine?: boolean;
	workspaces: Workspace[];
	allVisibleIds?: string[];
	onRowFocus?: () => void;
	onBatchAction?: (action: "archive" | "pin" | "delete", ids: string[]) => void;
}

/**
 * Status marks — final spec (RFC S3–S7 + grilling round 2026-09-28):
 * - working: neutral monochrome spinner, label reveals on hover.
 * - awaiting_approval/awaiting_answer: persistent sky-blue 待回复 pill, no dot.
 * - review: solid green #10b981 dot + persistent 待验收 label.
 * - error/interrupted: solid red #ef4444 dot + persistent label (异常 / 已中断).
 * - suspended/external/idle: no mark at all.
 * - Unread stays a blue dot in the trailing zone (rendered by SessionRow).
 * - Status mark sits adjacent to the title, not flush-right.
 */
type StatusMark =
	| { kind: "none" }
	| { kind: "spinner"; label: string; pillCls: string }
	| { kind: "pill"; label: string }
	| { kind: "dot"; label: string; dotCls: string; pillCls: string };

const STATUS_CONFIG: Record<SessionMeta["status"], StatusMark> = {
	awaiting_approval: { kind: "pill", label: "待回复" },
	awaiting_answer: { kind: "pill", label: "待回复" },
	review: {
		kind: "dot",
		label: "待验收",
		dotCls: "bg-emerald-500",
		pillCls: "bg-emerald-500/15 text-emerald-500",
	},
	error: {
		kind: "dot",
		label: "异常",
		dotCls: "bg-red-500",
		pillCls: "bg-red-500/15 text-red-500",
	},
	interrupted: {
		kind: "dot",
		label: "已中断",
		dotCls: "bg-red-500",
		pillCls: "bg-red-500/15 text-red-400",
	},
	working: {
		kind: "spinner",
		label: "运行中",
		pillCls: "bg-neutral-500/20 text-[var(--text-muted)]",
	},
	suspended: { kind: "none" },
	external: { kind: "none" },
	idle: { kind: "none" },
};

export function renderStatusDot(status: SessionMeta["status"]) {
	const cfg = STATUS_CONFIG[status];
	if (!cfg || cfg.kind === "none") return null;

	if (cfg.kind === "pill") {
		return (
			<span
				className="shrink-0 whitespace-nowrap rounded-[4px] bg-sky-500/15 px-1 text-[9px] font-semibold leading-[14px] text-sky-600 dark:text-sky-300"
			>
				{cfg.label}
			</span>
		);
	}

	const mark =
		cfg.kind === "spinner" ? (
			<Loader2 size={11} className="shrink-0 animate-spin text-[var(--text-muted)]" />
		) : (
			<span className={clsx("h-[7px] w-[7px] shrink-0 rounded-full", cfg.dotCls)} />
		);

	/* Dots and spinner are bare marks — no expanding label. Hover context is
	 * provided by the row tray, which prints the status name itself. */
	return <span className="flex shrink-0 items-center">{mark}</span>;
}



export function SessionRow({
	session,
	indent = 0,
	withSpine = false,
	workspaces,
	allVisibleIds,
	onRowFocus,
	onBatchAction,
}: SessionRowProps) {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const selectedIds = useUi((s) => s.selectedIds);
	const highlightId = useUi((s) => s.highlightId);
	const selectSession = useUi((s) => s.selectSession);
	const setSelectedIds = useUi((s) => s.setSelectedIds);
	const toggleSelectId = useUi((s) => s.toggleSelectId);
	const setHighlightId = useUi((s) => s.setHighlightId);
	const sessionViewMode = useUi((s) => s.sessionViewMode[session.id] ?? "chat");
	const setSessionViewMode = useUi((s) => s.setSessionViewMode);
	const openModal = useUi((s) => s.openModal);
	const parent = useSessions((s) =>
		session.parentId ? s.sessions[session.parentId] : undefined,
	);

	const isSelected = selectedSessionId === session.id;
	const isMultiSelected = selectedIds.has(session.id) && selectedIds.size > 1;
	const isHighlighted = highlightId === session.id && !isSelected;
	const deletedWt =
		!session.git?.worktree &&
		!session.git?.branch &&
		inferWorktreeName(session.cwd) !== null;

	// Context menu & action modal states
	const [menuOpen, setMenuOpen] = useState(false);
	const [menuCoords, setMenuCoords] = useState<{ x: number; y: number } | null>(
		null,
	);
	const [isRenaming, setIsRenaming] = useState(false);
	const [renameDraft, setRenameDraft] = useState(session.title || "");
	const [showArchiveModal, setShowArchiveModal] = useState(false);
	const [showAssignModal, setShowAssignModal] = useState(false);
	const [showTakeoverModal, setShowTakeoverModal] = useState(false);
	const [busy, setBusy] = useState(false);

	// Superset-style HoverCard preview state
	const [hoverCardOpen, setHoverCardOpen] = useState(false);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);

	const handleRowMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
		const rect = e.currentTarget.getBoundingClientRect();
		hoverTimer.current = window.setTimeout(() => {
			setAnchorRect(rect);
			setHoverCardOpen(true);
		}, 400);
	};

	const handleRowMouseLeave = () => {
		if (hoverTimer.current !== null) {
			window.clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
		closeTimer.current = window.setTimeout(() => {
			setHoverCardOpen(false);
		}, 150);
	};

	const handleCardMouseEnter = () => {
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
	};

	const handleCardMouseLeave = () => {
		closeTimer.current = window.setTimeout(() => {
			setHoverCardOpen(false);
		}, 150);
	};

	const menuRef = useRef<HTMLDivElement>(null);
	const renameInputRef = useRef<HTMLInputElement>(null);

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

	const anyModalOpen =
		showArchiveModal || showAssignModal || showTakeoverModal;

	const closeAll = () => {
		setShowArchiveModal(false);
		setShowAssignModal(false);
		setShowTakeoverModal(false);
	};
	useEscapeKey(() => {
		if (menuOpen) {
			setMenuOpen(false);
			return;
		}
		closeAll();
	}, menuOpen || anyModalOpen);

	const startInlineRename = () => {
		setRenameDraft(session.title || "");
		setIsRenaming(true);
		setMenuOpen(false);
	};

	const saveInlineRename = async () => {
		const trimmed = renameDraft.trim();
		setIsRenaming(false);
		if (!trimmed || trimmed === session.title) return;
		try {
			const updated = await updateSessionMeta(session.id, {
				customName: trimmed,
			});
			useSessions.getState().upsert([updated]);
			toast.success("已重命名");
		} catch (err) {
			toast.error(`重命名失败: ${errMsg(err)}`);
		}
	};

	const selectNextSession = () => {
		if (selectedSessionId === session.id && allVisibleIds && allVisibleIds.length > 0) {
			const idx = allVisibleIds.indexOf(session.id);
			const nextId = allVisibleIds[idx + 1] ?? allVisibleIds[idx - 1] ?? null;
			selectSession(nextId);
		} else if (selectedSessionId === session.id) {
			selectSession(null);
		}
	};

	const handleRowClick = async (e: React.MouseEvent) => {
		onRowFocus?.();
		try {
			if (e.shiftKey && allVisibleIds && allVisibleIds.length > 0) {
				const lastId = selectedSessionId || allVisibleIds[0];
				const fromIdx = allVisibleIds.indexOf(lastId);
				const toIdx = allVisibleIds.indexOf(session.id);
				if (fromIdx !== -1 && toIdx !== -1) {
					const start = Math.min(fromIdx, toIdx);
					const end = Math.max(fromIdx, toIdx);
					const range = allVisibleIds.slice(start, end + 1);
					setSelectedIds(new Set(range));
					setHighlightId(session.id);
				} else {
					selectSession(session.id);
				}
			} else if (e.metaKey || e.ctrlKey) {
				toggleSelectId(session.id);
				setHighlightId(session.id);
			} else {
				selectSession(session.id);
			}
			if (session.unread) {
				await markSeen(session.id);
				useSessions.getState().upsert([{ ...session, unread: false }]);
			}
		} catch (err) {
			toast.error(`选择会话失败: ${errMsg(err)}`);
		}
	};

	// Right-click selects the row if not in multi-selection, then opens the menu.
	const handleContextMenu = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onRowFocus?.();
		if (!selectedIds.has(session.id)) {
			selectSession(session.id);
		}
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


	// 2. Pin / Unpin
	const handleTogglePin = async () => {
		setMenuOpen(false);
		try {
			const updated = await updateSessionMeta(session.id, {
				pinned: !session.pinned,
			});
			useSessions.getState().upsert([updated]);
		} catch (err) {
			toast.error(`切换置顶失败: ${errMsg(err)}`);
		}
	};

	// 3. Archive / Unarchive — archiving shows an Undo bar at the sidebar.
	const handleArchiveClick = () => {
		setMenuOpen(false);
		if (session.archived) {
			updateSessionMeta(session.id, { archived: false })
				.then((updated) => useSessions.getState().upsert([updated]))
				.catch((err) => toast.error(`取消归档失败: ${errMsg(err)}`));
			return;
		}
		if (session.git?.worktree) {
			setShowArchiveModal(true);
		} else {
			selectNextSession();
			archiveSession(session).catch((err) =>
				toast.error(`归档失败: ${errMsg(err)}`),
			);
		}
	};

	const [archiving, setArchiving] = useState(false);
	const executeArchiveWithWorktree = async (cleanWorktree: boolean) => {
		if (archiving) return;
		setArchiving(true);
		try {
			if (cleanWorktree && session.git?.worktree) {
				const repo = session.repoRoot || session.cwd;
				await gitRemoveWorktree(repo, session.git.worktree, false, false);
			}
			selectNextSession();
			await archiveSession(session);
			setShowArchiveModal(false);
		} catch (err) {
			toast.error(`归档及清理失败: ${errMsg(err)}`);
		} finally {
			setArchiving(false);
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
			toast.error(`分配工作区失败: ${errMsg(err)}`);
		}
	};

	// 5. Diagnose
	const handleDiagnose = () => {
		setMenuOpen(false);
		openModal("diagnose", { sessionId: session.id });
	};

	// 6. Resume — inline spinner while the RPC channel comes back.
	const handleResume = async () => {
		if (busy) return;
		setMenuOpen(false);
		setBusy(true);
		try {
			await ensureLive(session.id);
			selectSession(session.id);
		} catch (err) {
			if (!isResumeCancelled(err))
				toast.error(`恢复会话失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
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
		if (busy) return;
		setBusy(true);
		try {
			await takeoverExternal(session.id);
			setShowTakeoverModal(false);
			selectSession(session.id);
		} catch (err) {
			toast.error(`接管会话失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	// 9. Accept (review) — one click closes the turn; optional archive after.
	const handleAccept = async (archive: boolean) => {
		setMenuOpen(false);
		try {
			await acceptSession(session.id, archive);
			toast.success(archive ? "已验收并归档" : "已验收");
		} catch (err) {
			toast.error(`验收失败: ${errMsg(err)}`);
		}
	};

	// 10. Delete session — permanent; confirm first, refuse while live.
	const handleDelete = async () => {
		if (session.live || session.status === "working" || busy) {
			toast.info("会话仍在运行，请先挂起或停止");
			return;
		}
		const ok = await confirmDialog(
			`永久删除会话「${sessionDisplayName(session)}」？\n该操作会删除 transcript 文件与全部记录，无法恢复。`,
			{ danger: true, okLabel: "永久删除", title: "删除会话" },
		);
		if (!ok) return;
		setBusy(true);
		try {
			await deleteSession(session.id);
			useSessions.getState().remove([session.id]);
			selectNextSession();
			toast.success("会话已删除");
		} catch (err) {
			toast.error(`删除会话失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const handleCopy = async (text: string | null | undefined, label: string) => {
		setMenuOpen(false);
		if (!text) return;
		try {
			await copyText(text);
			toast.success(`已复制${label}`);
		} catch (err) {
			toast.error(`复制失败: ${errMsg(err)}`);
		}
	};

	const handleReveal = async () => {
		setMenuOpen(false);
		try {
			await revealItemInDir(session.cwd);
		} catch (err) {
			toast.error(`在访达中打开失败: ${errMsg(err)}`);
		}
	};

	const updatedAtTs = new Date(
		session.updatedAt || session.createdAt,
	).toLocaleString();
	return (
		<div
			data-session-id={session.id}
			onClick={handleRowClick}
			onContextMenu={handleContextMenu}
			onMouseEnter={handleRowMouseEnter}
			onMouseLeave={handleRowMouseLeave}
			style={{ paddingLeft: `${8 + indent}px` }}
			className={clsx(
				"group relative mx-1.5 flex cursor-pointer select-none items-center justify-between gap-1.5 rounded-[8px] min-h-[28px] py-1 pr-2 transition-all",
				isSelected
					? "bg-[var(--bg-selected)] text-[var(--text)]"
					: isMultiSelected
						? "bg-[#0A84FF]/20 text-white"
						: isHighlighted
							? "bg-[var(--bg-active-fill)] text-neutral-200"
							: "text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)]",
				deletedWt && "opacity-50",
			)}
		>
			{/* Subgroup guide line segment — real element, positioned 4px left of
			 *  the row edge so it lands under the branch icon's center, and only
			 *  spans this row so no tail extends past the last session. */}
			{withSpine && (
				<span
					aria-hidden
					className="absolute -left-1 top-0 bottom-0 w-[2px] bg-[var(--text-dim)]/40"
				/>
			)}

			{/* Title column — status mark sits adjacent to the title with a small gap. */}
			<div className="flex min-w-0 flex-1 items-center gap-1.5">
				{/* Fork marker — forked sessions are ordinary flat rows; only this
				 *  small icon (no indent, no toggle) tells them apart. */}
				{session.parentId && (
					<span
						className="shrink-0 text-[var(--text-dim)]"
						title={`分叉自: ${parent ? sessionDisplayName(parent) : "已不在列表中的会话"}`}
					>
						<GitFork size={11} />
					</span>
				)}
				{isRenaming ? (
					<input
						ref={renameInputRef}
						autoFocus
						type="text"
						value={renameDraft}
						onClick={(e) => e.stopPropagation()}
						onDoubleClick={(e) => e.stopPropagation()}
						onChange={(e) => setRenameDraft(e.target.value)}
						onBlur={saveInlineRename}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter") {
								e.preventDefault();
								e.stopPropagation();
								void saveInlineRename();
							} else if (e.key === "Escape") {
								e.preventDefault();
								e.stopPropagation();
								setIsRenaming(false);
								setRenameDraft(session.title || "");
							}
						}}
						className="h-5 min-w-0 flex-1 rounded border border-indigo-500 bg-neutral-900 px-1 py-0 text-xs font-medium text-neutral-100 outline-none"
					/>
				) : (
					<HoverScrollText
						text={sessionDisplayName(session)}
						title=""
						onDoubleClick={(e) => {
							e.stopPropagation();
							startInlineRename();
						}}
						className={clsx(
							"min-w-0 flex-1 cursor-text text-xs transition-colors",
							isSelected
								? "font-semibold text-[var(--text)]"
								: "font-normal text-[var(--text)]",
						)}
					/>
				)}
				{busy ? (
					<Loader2 size={11} className="shrink-0 animate-spin text-[var(--text-muted)]" />
				) : (
					renderStatusDot(session.status)
				)}
			</div>

			{/* Trailing zone: permanent relative-time stamp with the bare "…" menu button overlaid
			 *  (Time Swap — zero extra layout width). Quick actions reveal on hover. */}
			<div className="relative flex shrink-0 items-center ml-1">
				{/* Rest state: unread dot only on rows that carry no status mark. */}
				{session.unread && STATUS_CONFIG[session.status].kind === "none" && !session.live && !busy && (
					<span
						className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500 mr-1"
						title="未读"
					/>
				)}
				<span
					title={updatedAtTs}
					className="ml-1 text-[10px] tabular-nums font-mono whitespace-nowrap text-[var(--text-dim)]"
				>
					{relativeTime(session.updatedAt || session.createdAt)}
				</span>

				{/* Hover overlay: status label + quick actions + "…" — absolutely
				 *  positioned over the title's tail so nothing eats title width.
				 *  (RFC T2 Time Swap applied to the whole trailing cluster.) */}
				<div
					className={clsx(
						"absolute inset-y-0 right-0 z-10 flex items-center gap-1 pl-3 rounded-r-[8px] transition-opacity duration-150",
						isSelected
							? "bg-[var(--bg-selected)]"
							: "bg-[var(--bg-hover)]",
						menuOpen
							? "opacity-100"
							: "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
					)}
				>
					{(() => {
						const m = STATUS_CONFIG[session.status];
						/* awaiting_* renders the pill beside the title already;
						 * skip repeating it in the tray. All actions live in the
						 * context menu or inside the session view — the tray only
						 * displays status, never offers decisions. */
						if (m.kind === "none" || m.kind === "pill") return null;
						return (
							<span
								className={clsx(
									"shrink-0 whitespace-nowrap rounded-[4px] px-1 text-[9px] font-semibold leading-[14px]",
									m.pillCls,
								)}
							>
								{m.label}
							</span>
						);
					})()}
					{session.pinned && (
						<Pin size={11} className="shrink-0 fill-amber-400/40 text-amber-400" />
					)}
					<button
						type="button"
						onClick={handleMenuBtnClick}
						className="flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)]"
						title="操作菜单"
					>
						<MoreHorizontal size={14} />
					</button>
				</div>
			</div>
			{/* Floating Context Menu */}
			{menuOpen && menuCoords && (
				<div
					ref={menuRef}
					style={{
						position: "fixed",
						left: `${Math.min(menuCoords.x, window.innerWidth - 200)}px`,
						top: `${Math.min(menuCoords.y, window.innerHeight - 340)}px`,
						zIndex: 50,
					}}
					className="w-48 rounded-xl vibrancy-popover shadow-apple-modal hairline p-1 text-xs text-neutral-300"
				>
					{isMultiSelected ? (
						<>
							<div className="px-2.5 py-1 font-semibold text-[11px] text-neutral-400 border-b border-[var(--border-divider)]">
								已选 {selectedIds.size} 个会话
							</div>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									setMenuOpen(false);
									onBatchAction?.("archive", Array.from(selectedIds));
								}}
								className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
							>
								<Archive size={13} />
								批量归档
							</button>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									setMenuOpen(false);
									onBatchAction?.("pin", Array.from(selectedIds));
								}}
								className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
							>
								<Pin size={13} />
								批量置顶 / 取消置顶
							</button>
							<div className="my-1 border-t border-neutral-800" />
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									setMenuOpen(false);
									onBatchAction?.("delete", Array.from(selectedIds));
								}}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-rose-400 hover:bg-rose-950/50 hover:text-rose-300 text-left"
							>
								<Trash2 size={13} />
								批量删除…
							</button>
						</>
					) : (
						<>
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									startInlineRename();
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

					{session.status === "review" && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								handleAccept(true);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-orange-300 hover:bg-neutral-800 text-left"
						>
							<CheckCircle2 size={13} />
							验收并归档
						</button>
					)}

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

					<div className="my-1 border-t border-neutral-800" />

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							handleCopy(session.id, "会话 ID");
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						<Copy size={13} />
						复制会话 ID
					</button>

					{session.git?.branch && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								handleCopy(session.git?.branch, "分支名");
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
						>
							<GitBranch size={13} />
							复制分支名
						</button>
					)}

					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							handleReveal();
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						<FolderOpen size={13} />
						在访达中打开
					</button>

					<div className="my-1 border-t border-neutral-800" />

					<button
						type="button"
						disabled={session.live || session.status === "working"}
						title={
							session.live || session.status === "working"
								? "会话仍在运行，请先挂起或停止"
								: undefined
						}
						onClick={(e) => {
							e.stopPropagation();
							setMenuOpen(false);
							handleDelete();
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 text-rose-400 hover:bg-rose-950/50 hover:text-rose-300 text-left disabled:cursor-not-allowed disabled:opacity-40"
					>
						<Trash2 size={13} />
						删除会话…
					</button>
						</>
					)}
				</div>
			)}


			{/* Modal 2: Archive with Worktree Confirmation */}
			{showArchiveModal && (
				<div
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) setShowArchiveModal(false);
					}}
					onClick={(e) => e.stopPropagation()}
					className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-4"
				>
					<div className="w-full max-w-md rounded-2xl bg-[var(--bg-panel)] p-5 text-neutral-200 shadow-apple-modal hairline">
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
								disabled={archiving}
								onClick={() => executeArchiveWithWorktree(false)}
								className="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 text-left hover:bg-neutral-700 disabled:opacity-50"
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
								disabled={archiving}
								onClick={() => executeArchiveWithWorktree(true)}
								className="rounded border border-rose-500/40 bg-rose-950/30 px-3 py-2 text-left hover:bg-rose-900/40 text-rose-200 disabled:opacity-50"
							>
								<div className="font-semibold flex items-center gap-1.5">
									{archiving ? (
										<Loader2 size={13} className="animate-spin" />
									) : (
										<Trash2 size={13} />
									)}
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
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) setShowAssignModal(false);
					}}
					onClick={(e) => e.stopPropagation()}
					className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] backdrop-blur-md p-4"
				>
					<div className="w-full max-w-sm rounded-2xl bg-[var(--bg-panel)] p-5 text-neutral-200 shadow-apple-modal hairline">
						<div className="flex items-center justify-between pb-3">
							<span className="font-semibold text-sm">归入工作区</span>
							<button
								type="button"
								onClick={() => setShowAssignModal(false)}
								className="text-neutral-400 hover:text-neutral-200"
								title="关闭"
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
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) setShowTakeoverModal(false);
					}}
					onClick={(e) => e.stopPropagation()}
					className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
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
								disabled={busy}
								onClick={() => setShowTakeoverModal(false)}
								className="rounded px-3 py-1.5 text-neutral-400 hover:bg-neutral-800"
							>
								取消
							</button>
							<button
								type="button"
								disabled={busy}
								onClick={handleTakeoverConfirm}
								className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-white hover:bg-purple-500 disabled:opacity-60"
							>
								{busy && <Loader2 size={12} className="animate-spin" />}
								确定接管
							</button>
						</div>
					</div>
				</div>
			)}
			{/* Superset HoverCard preview */}
			<SessionHoverCard
				session={session}
				anchorRect={anchorRect}
				open={hoverCardOpen && !menuOpen && !isRenaming}
				workspaces={workspaces}
				onMouseEnterCard={handleCardMouseEnter}
				onMouseLeaveCard={handleCardMouseLeave}
			/>
		</div>
	);
}
