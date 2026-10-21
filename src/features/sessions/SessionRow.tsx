import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	Archive,
	ArchiveRestore,
	CheckCircle2,
	Copy,
	ExternalLink,
	FolderInput,
	FolderOpen,
	GitBranch,
	GitFork,
	Loader2,
	MessageSquare,
	MoreHorizontal,
	Pencil,
	Pin,
	PinOff,
	Play,
	RotateCw,
	Stethoscope,
	Tag,
	Trash2,
} from "lucide-react";
import React, { type MouseEvent, useEffect, useRef, useState } from "react";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import { confirmDialog, copyText, errMsg } from "../../lib/dialogs";
import { absoluteTime, relativeTime } from "../../lib/format";
import { isSessionBusy } from "../../lib/createSession";
import { sideChatTitle } from "../sidechat/sideChatTitle";
import { sessionDisplayName } from "../../lib/sessionName";
import { isComposing } from "../../lib/hooks";
import { acceptSession, rpcRestart, updateSessionMeta } from "../../lib/ipc";
import { ensureLive, isResumeCancelled } from "../../lib/ensureLive";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { HoverScrollText } from "../../components/HoverScrollText";
import {
	FloatingLayer,
	type Anchor,
	type Placement,
} from "../../components/FloatingLayer";
import { SessionHoverCard } from "./SessionHoverCard";
import { restoreSidebarFocus } from "./SessionDialogs";
import { archiveSessions } from "./archiveUndo";
import { useMinuteTick } from "./useMinuteTick";
import { getVisibleSessionIds } from "./visibleRows";
import {
	requestArchive,
	requestAssign,
	requestDelete,
	requestMoveToGroup,
	requestTakeover,
	useSessionActions,
} from "./sessionActions";
import { restartNeedsConfirm, restartState } from "./sessionRestart";
import { claimEscape } from "../../lib/escapeClaim";

export interface SessionRowProps {
	session: SessionMeta;
	/** Draw this row's segment of the subgroup guide line at the row's left edge. */
	withSpine?: boolean;
	/** Compact navigation-row sizing (h-[30px], 13px) — used by the Universal space list. */
	large?: boolean;
	workspaces: Workspace[];
	onRowFocus?: () => void;
	onBatchAction: (action: "archive" | "pin" | "delete", ids: string[]) => void;
}

/**
 * Status marks — final spec (RFC P8):
 * - working: neutral monochrome spinner, label reveals on hover.
 * - awaiting_approval/awaiting_answer: persistent sky-blue 待回复 pill, no dot.
 * - review: no status mark — merged into the trailing blue unread dot.
 * - error/interrupted: solid red #ef4444 dot (bare mark).
 * - suspended/external/idle: no mark at all.
 * - Unread (incl. 待验收) is a blue dot in the trailing zone (rendered by SessionRow).
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
	review: { kind: "none" },
	error: {
		kind: "dot",
		label: "异常",
		dotCls: "bg-red-500",
		pillCls: "bg-red-500/15 text-red-400",
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
			<span className="shrink-0 whitespace-nowrap rounded-[4px] bg-sky-500/15 px-1 text-[9px] font-semibold leading-[14px] text-sky-400">
				{cfg.label}
			</span>
		);
	}

	const mark =
		cfg.kind === "spinner" ? (
			<Loader2
				size={11}
				className="shrink-0 animate-spin text-[var(--text-muted)]"
			/>
		) : (
			<span
				className={clsx("h-[7px] w-[7px] shrink-0 rounded-full", cfg.dotCls)}
			/>
		);

	return <span className="flex shrink-0 items-center">{mark}</span>;
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

// Store actions are stable; calling them via getState() avoids one zustand
// subscription per row for each action.
const selectSession = (id: string | null) => useUi.getState().selectSession(id);
const setSelectedIds = (ids: Set<string> | string[]) => useUi.getState().setSelectedIds(ids);
const toggleSelectId = (id: string) => useUi.getState().toggleSelectId(id);
const setHighlightId = (id: string | null) => useUi.getState().setHighlightId(id);

function hasActiveDialogNow(): boolean {
	const s = useSessionActions.getState();
	return (
		s.archiveWorktreeTarget !== null ||
		s.assignSessionIds !== null ||
		s.takeoverSessionId !== null
	);
}

/**
 * Mounts the hover card only while it is open; the dialog subscription lives
 * here so closed rows carry neither it nor the card's home-dir hook.
 */
function HoverCardGate(props: {
	session: SessionMeta;
	anchorRect: DOMRect;
	workspaces: Workspace[];
	onMouseEnterCard: () => void;
	onMouseLeaveCard: () => void;
}) {
	const hasActiveDialog = useSessionActions(
		(s) =>
			s.archiveWorktreeTarget !== null ||
			s.assignSessionIds !== null ||
			s.takeoverSessionId !== null,
	);
	return <SessionHoverCard {...props} open={!hasActiveDialog} />;
}

function SessionRowComponent({
	session,
	withSpine = false,
	large = false,
	workspaces,
	onRowFocus,
	onBatchAction,
}: SessionRowProps) {
	// Re-evaluate relative time on shared minute ticks (R3)
	useMinuteTick();

	// Narrow boolean selectors: a selection change re-renders only rows whose
	// own flags flip (selectedIds is a fresh Set on every change).
	const isInSelectedSet = useUi((s) => s.selectedIds.has(session.id));
	const hasMultiSelection = useUi((s) => s.selectedIds.size > 1);
	const isPrimarySelected = useUi((s) => s.selectedSessionId === session.id);

	// Derive selection styling: primary accent only when in set (R24, C4)
	const isSelected = isPrimarySelected && (!hasMultiSelection || isInSelectedSet);
	const isMultiSelected = isInSelectedSet && hasMultiSelection && !isSelected;
	const isHighlighted = useUi((s) => s.highlightId === session.id);

	const parentTitle = useSessions((s) =>
		session.parentId
			? s.sessions[session.parentId]?.title ||
				s.sessions[session.parentId]?.label ||
				session.parentId.slice(0, 6)
			: undefined,
	);

	const sideChatName = useSessions((s) =>
		session.kind === "side" && !session.title?.trim() ? sideChatTitle(session.id, s.sessions) : null,
	);

	// Rows inside the 已清理的工作树 bucket are dimmed by that bucket's own
	// wrapper opacity — no per-row heuristic (a cwd merely shaped like a
	// worktree path must never dim a live row).

	const rowRef = useRef<HTMLDivElement>(null);
	const menuBtnRef = useRef<HTMLButtonElement>(null);
	const menuContainerRef = useRef<HTMLDivElement>(null);
	const prevActiveElementRef = useRef<HTMLElement | null>(null);

	// Context menu state
	const [menuOpen, setMenuOpen] = useState(false);
	const [menuAnchor, setMenuAnchor] = useState<Anchor | null>(null);
	const [menuPlacement, setMenuPlacement] = useState<Placement>("bottom-start");

	const closeMenu = (restoreFocus = true) => {
		setMenuOpen(false);
		if (restoreFocus) {
			restoreSidebarFocus(prevActiveElementRef.current);
		}
	};
	const [isRenaming, setIsRenaming] = useState(false);
	const [renameDraft, setRenameDraft] = useState("");
	const renameInputRef = useRef<HTMLInputElement>(null);

	const [busy, setBusy] = useState(false);

	// Superset-style HoverCard preview state
	const [hoverCardOpen, setHoverCardOpen] = useState(false);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);

	// Subscriptions to programmatic requests (R7, Contract 3)
	const isRenameRequested = useSessionActions(
		(s) => s.renameSessionId === session.id,
	);
	const isMenuRequested = useSessionActions(
		(s) => s.menuSessionId === session.id,
	);

	useEffect(() => {
		if (isRenameRequested) {
			useSessionActions.getState().setRenameSessionId(null);
			startInlineRename();
		}
	}, [isRenameRequested]);

	useEffect(() => {
		if (isMenuRequested) {
			prevActiveElementRef.current =
				(document.activeElement as HTMLElement) ?? null;
			useSessionActions.getState().setMenuSessionId(null);
			if (rowRef.current) {
				const rect = rowRef.current.getBoundingClientRect();
				setMenuAnchor({ x: rect.left + 24, y: rect.bottom });
				setMenuPlacement("bottom-start");
				setMenuOpen(true);
			}
		}
	}, [isMenuRequested]);

	// Context menu keyboard focus on open (R20)
	useEffect(() => {
		if (menuOpen) {
			// Suppress hover card when menu opens (R10)
			if (hoverTimer.current !== null) {
				window.clearTimeout(hoverTimer.current);
				hoverTimer.current = null;
			}
			setHoverCardOpen(false);

			const timer = window.setTimeout(() => {
				const firstItem =
					menuContainerRef.current?.querySelector<HTMLElement>(
						'button[role="menuitem"]:not([disabled])',
					);
				firstItem?.focus();
			}, 0);
			return () => clearTimeout(timer);
		}
	}, [menuOpen]);

	const handleRowMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
		// Empty drafts have nothing worth previewing; the card only covers the composer.
		if (hasActiveDialogNow() || menuOpen || isRenaming || !session.title?.trim()) return;
		if (closeTimer.current !== null) {
			window.clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
		// Measure lazily inside the timer: the row may scroll during the 400ms
		// hover delay, and a stale rect makes the card flash at the wrong spot.
		const rowEl = e.currentTarget;
		hoverTimer.current = window.setTimeout(() => {
			setAnchorRect(rowEl.getBoundingClientRect());
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

	const startInlineRename = () => {
		// Seed with displayed name (R17)
		setRenameDraft(sessionDisplayName(session));
		setIsRenaming(true);
		setMenuOpen(false);
		if (hoverTimer.current !== null) {
			window.clearTimeout(hoverTimer.current);
			hoverTimer.current = null;
		}
		setHoverCardOpen(false);
	};

	const saveInlineRename = async () => {
		const trimmed = renameDraft.trim();
		const currentDisplay = sessionDisplayName(session);
		if (trimmed === currentDisplay) {
			setIsRenaming(false);
			return;
		}
		try {
			// Empty value clears custom title (customName: "") (R17)
			const updated = await updateSessionMeta(session.id, {
				customName: trimmed === "" ? "" : trimmed,
			});
			useSessions.getState().upsert([updated]);
			setIsRenaming(false);
			toast.success(trimmed === "" ? "已恢复默认标题" : "已重命名");
		} catch (err) {
			// Stay in rename mode on failure so text is not lost (R17)
			toast.error(`重命名失败: ${errMsg(err)}`);
		}
	};

	const handleRowClick = (e: React.MouseEvent) => {
		onRowFocus?.();

		// Shift-click range select uses getVisibleSessionIds() at event time (R4, R5)
		if (e.shiftKey) {
			const ids = getVisibleSessionIds();
			if (ids.length > 0) {
				const lastId = useUi.getState().selectedSessionId || ids[0];
				const fromIdx = ids.indexOf(lastId);
				const toIdx = ids.indexOf(session.id);
				if (fromIdx !== -1 && toIdx !== -1) {
					const start = Math.min(fromIdx, toIdx);
					const end = Math.max(fromIdx, toIdx);
					const range = ids.slice(start, end + 1);
					setSelectedIds(new Set(range));
					setHighlightId(session.id);
				} else {
					selectSession(session.id);
				}
			} else {
				selectSession(session.id);
			}
		} else if (e.metaKey || e.ctrlKey) {
			// Cmd/Ctrl-click: update primary selection if deselected (R24)
			const currentSet = useUi.getState().selectedIds;
			if (currentSet.has(session.id)) {
				toggleSelectId(session.id);
				if (useUi.getState().selectedSessionId === session.id) {
					const remaining = Array.from(currentSet).filter(
						(id) => id !== session.id,
					);
					selectSession(remaining[0] ?? null);
					setSelectedIds(remaining);
				}
			} else {
				toggleSelectId(session.id);
			}
			setHighlightId(session.id);
		} else {
			selectSession(session.id);
		}
		// Notice: markSeen is centralized in store (slice C / R11)
	};

	// Right-click selects the row if not in multi-selection, then opens the menu.
	const handleContextMenu = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onRowFocus?.();
		prevActiveElementRef.current =
			(document.activeElement as HTMLElement) ?? null;
		const currentSelected = useUi.getState().selectedIds;
		if (!currentSelected.has(session.id)) {
			selectSession(session.id);
		}
		setMenuAnchor({ x: e.clientX, y: e.clientY });
		setMenuPlacement("bottom-start");
		setMenuOpen(true);
	};

	// "…" trigger toggles menu anchored to button with bottom-end (R8)
	const handleMenuBtnClick = (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		onRowFocus?.();
		prevActiveElementRef.current =
			(document.activeElement as HTMLElement) ?? null;
		setMenuAnchor(menuBtnRef.current);
		setMenuPlacement("bottom-end");
		setMenuOpen((prev) => !prev);
	};

	const handleTogglePin = async () => {
		closeMenu(true);
		try {
			const updated = await updateSessionMeta(session.id, {
				pinned: !session.pinned,
			});
			useSessions.getState().upsert([updated]);
		} catch (err) {
			toast.error(`切换置顶失败: ${errMsg(err)}`);
		}
	};

	const handleResume = async () => {
		if (busy) return;
		closeMenu(true);
		setBusy(true);
		try {
			await ensureLive(session.id);
			selectSession(session.id);
		} catch (err) {
			if (!isResumeCancelled(err)) {
				toast.error(`恢复会话失败: ${errMsg(err)}`);
			}
		} finally {
			setBusy(false);
		}
	};



	const handleAccept = async () => {
		closeMenu(true);
		try {
			// P13: acceptSession(id, false) then archiveSessions([id]) for undo + neighbor selection
			await acceptSession(session.id, false);
			await archiveSessions([session.id]);
			toast.success("已验收并归档");
		} catch (err) {
			toast.error(`验收失败: ${errMsg(err)}`);
		}
	};

	const restart = restartState(session);
	const handleRestart = async () => {
		if (busy || restart.kind === "disabled") return;
		closeMenu(true);
		if (restart.kind === "live" && restartNeedsConfirm(session)) {
			const ok = await confirmDialog(
				"该会话正在运行或等待回复，重启会中断当前回合（历史会保留）。确定重启？",
				{ title: "重启会话", okLabel: "重启", danger: true },
			);
			if (!ok) return;
		}
		setBusy(true);
		try {
			if (restart.kind === "live") {
				await rpcRestart(session.id);
				toast.success(`已重启会话「${sessionDisplayName(session)}」`);
			} else {
				await ensureLive(session.id);
				toast.success(`已启动会话「${sessionDisplayName(session)}」，未发送任何消息`);
			}
		} catch (err) {
			if (isResumeCancelled(err)) return;
			toast.error(`重启会话失败: ${errMsg(err)}`);
		} finally {
			setBusy(false);
		}
	};

	const handleCopy = async (
		text: string | null | undefined,
		label: string,
	) => {
		closeMenu(true);
		if (!text) return;
		try {
			await copyText(text);
			toast.success(`已复制${label}`);
		} catch (err) {
			toast.error(`复制失败: ${errMsg(err)}`);
		}
	};

	const handleReveal = async () => {
		closeMenu(true);
		try {
			await revealItemInDir(session.cwd);
		} catch (err) {
			toast.error(`在访达中打开失败: ${errMsg(err)}`);
		}
	};

	// Consistent background class for row and hover-tray (R12, K1)
	const rowBgCls = isSelected
		? "bg-[var(--bg-selected)]"
		: isMultiSelected
			? "bg-[color-mix(in_srgb,var(--accent)_20%,var(--bg))]"
			: isHighlighted
				? "bg-[var(--bg-active-fill)]"
				: "hover:bg-[var(--bg-hover)]";

	const trayBgCls = isSelected
		? "bg-[var(--bg-selected)]"
		: isMultiSelected
			? "bg-[color-mix(in_srgb,var(--accent)_20%,var(--bg))]"
			: isHighlighted
				? "bg-[color-mix(in_srgb,var(--bg-active-fill),var(--bg))]"
				: "bg-[var(--bg-hover)]";

	const timestampText = relativeTime(
		session.updatedAt || session.createdAt,
	);
	const timestampTooltip = absoluteTime(
		session.updatedAt || session.createdAt,
	);

	// 无项目 (global-workspace) sessions can be filed into SessionGroups.
	const wsOfSession = workspaces.find((w) => w.id === session.workspaceId);
	const inGlobalArea = wsOfSession?.kind === "global";
	// Menu-only data: skipped for the closed rows (the vast majority).
	const selectedIds = menuOpen ? useUi.getState().selectedIds : EMPTY_ID_SET;
	const batchAllInGlobalArea =
		menuOpen &&
		selectedIds.size > 1 &&
		isInSelectedSet &&
		Array.from(selectedIds).every((id) => {
			const s = useSessions.getState().sessions[id];
			return (
				s != null &&
				workspaces.find((w) => w.id === s.workspaceId)?.kind === "global"
			);
		});

	return (
		<div
			ref={rowRef}
			id={`session-row-${session.id}`}
			data-session-id={session.id}
			role="option"
			aria-selected={isInSelectedSet || isSelected}
			onClick={handleRowClick}
			onContextMenu={handleContextMenu}
			onMouseEnter={handleRowMouseEnter}
			onMouseLeave={handleRowMouseLeave}
			className={clsx(
				"group relative flex cursor-pointer select-none items-center justify-between gap-1.5 transition-all",
				large
					? "mx-0 h-[30px] rounded-md px-2"
					: "mx-1.5 min-h-[28px] rounded-[8px] py-1 pl-2 pr-2",
				rowBgCls,
				isSelected
					? "font-semibold text-[var(--text)]"
					: isMultiSelected
						? "text-[var(--text)]"
						: isHighlighted
							? "text-[var(--text)]"
							: "text-[var(--text-muted)] hover:text-[var(--text)]",
				session.archived && "opacity-60",
				isHighlighted &&
					"group-focus-visible/list:ring-2 group-focus-visible/list:ring-[var(--primary)] group-focus-visible/list:ring-inset",
			)}
		>
			{/* Subgroup guide line segment (P9/P10) */}
			{withSpine && (
				<span
					aria-hidden
					className="absolute -left-1 top-0 bottom-0 w-[2px] bg-[var(--text-dim)]/40"
				/>
			)}

			{/* Title column: status mark sits directly after title text (U3 / R13) */}
			<div className="flex min-w-0 flex-1 items-center gap-1.5">
				{session.kind === "side" ? (
					<span
						className="shrink-0 text-[var(--text-dim)]"
						title={`辅助对话（来自：${parentTitle || "已不在列表中的会话"}）`}
					>
						<MessageSquare size={11} />
					</span>
				) : session.kind === "fork" ? (
					<span
						className="inline-flex shrink-0 items-center gap-0.5 rounded bg-indigo-500/15 px-1 text-[10px] leading-4 text-indigo-400"
						title={`分叉自: ${parentTitle || "已不在列表中的会话"}`}
					>
						<GitFork size={9} />
						分叉
					</span>
				) : (
					session.parentId && (
						<span
							className="shrink-0 text-[var(--text-dim)]"
							title={`分叉自: ${parentTitle || "已不在列表中的会话"}`}
						>
							<GitFork size={11} />
						</span>
					)
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
						onBlur={() => {
							void saveInlineRename();
							restoreSidebarFocus(null);
						}}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Enter") {
								e.preventDefault();
								e.stopPropagation();
								void saveInlineRename().then(() => {
									restoreSidebarFocus(null);
								});
							} else if (e.key === "Escape") {
								claimEscape(e);
								e.stopPropagation();
								setIsRenaming(false);
								setRenameDraft(sessionDisplayName(session));
								restoreSidebarFocus(null);
							}
						}}
						className="h-5 min-w-0 flex-1 rounded border border-[var(--primary)] bg-[var(--well-bg)] px-1 py-0 text-xs font-medium text-[var(--text)] outline-none"
					/>
				) : (
					<HoverScrollText
						text={sideChatName ?? sessionDisplayName(session)}
						title=""
						className={clsx(
							"min-w-0 flex-initial max-w-full cursor-pointer transition-colors",
							large ? "text-[13px] leading-5" : "text-xs",
							isSelected
								? "font-semibold text-[var(--text)]"
								: "font-normal text-[var(--text)]",
						)}
					/>
				)}
				{!isRenaming && !session.title?.trim() && session.kind !== "side" && (
					<span className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] leading-4 text-amber-400">
						草稿
					</span>
				)}
				{busy ? (
					<Loader2
						size={11}
						className="shrink-0 animate-spin text-[var(--text-muted)]"
					/>
				) : (
					renderStatusDot(session.status)
				)}
				{session.archived && (
					<span title="已归档" className="shrink-0 flex items-center text-[var(--text-dim)]">
						<Archive size={11} />
					</span>
				)}
			</div>

			{/* Trailing zone: permanent relative-time stamp with time-swap hover tray (T2, Q12) */}
			<div className="relative flex shrink-0 items-center ml-1 @max-[220px]:ml-0.5">
				{/* Unread dot (unread or 待验收): show alongside any status mark —
				 * peeking at a row must not silently drop the unread cue. */}
				{(session.unread || session.status === "review" || session.pending === "review") &&
					!busy && (
					<span
						className={clsx(
							"h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500 mr-1 transition-opacity duration-150",
							menuOpen
								? "opacity-0"
								: isRenaming
									? "opacity-100"
									: "group-hover:opacity-0 group-focus-within:opacity-0",
						)}
						title="未读"
					/>
				)}
				<span
					title={timestampTooltip}
					className={clsx(
						"ml-1 @max-[220px]:ml-0 text-[10px] tabular-nums font-mono whitespace-nowrap text-[var(--text-dim)] transition-opacity duration-150",
						menuOpen
							? "opacity-0"
							: isRenaming
								? "opacity-100"
								: "group-hover:opacity-0 group-focus-within:opacity-0",
					)}
				>
					{timestampText}
				</span>

				{/* Hover overlay tray: status label + pin + "…" menu button */}
				<div
					className={clsx(
						"absolute inset-y-0 right-0 z-10 flex items-center gap-1 pl-2.5 rounded-r-[8px] transition-opacity duration-150",
						trayBgCls,
						menuOpen
							? "opacity-100"
							: isRenaming
								? "opacity-0 pointer-events-none"
								: "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
					)}
				>
					{(() => {
						const m = STATUS_CONFIG[session.status];
						if (m.kind === "none" || m.kind === "pill") return null;
						return (
							<span
								className={clsx(
									"shrink-0 whitespace-nowrap rounded-[4px] px-1 text-[9px] font-semibold leading-[14px] @max-[220px]:hidden",
									m.pillCls,
								)}
							>
								{m.label}
							</span>
						);
					})()}
					{session.pinned && (
						<Pin
							size={11}
							className="shrink-0 fill-amber-400/40 text-amber-400 @max-[220px]:hidden"
						/>
					)}
					<button
						ref={menuBtnRef}
						tabIndex={-1}
						type="button"
						onClick={handleMenuBtnClick}
						className="press-scale flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-0.5"
						title="操作菜单"
					>
						<MoreHorizontal size={14} />
					</button>
				</div>
			</div>

			{/* Floating Context Menu (R8, R9, R20) */}
			{menuOpen && menuAnchor && (
				<FloatingLayer
					anchor={menuAnchor}
					placement={menuPlacement}
					offset={4}
					layer="menu"
					ignoreRefs={menuBtnRef.current ? [menuBtnRef] : undefined}
					onDismiss={() => closeMenu(true)}
				>
					<div
						ref={menuContainerRef}
						role="menu"
						tabIndex={-1}
						aria-label="会话操作"
						onClick={(e) => e.stopPropagation()}
						onContextMenu={(e) => {
							e.preventDefault();
							e.stopPropagation();
						}}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Escape") {
								claimEscape(e);
								closeMenu(true);
								return;
							}
							if (
								e.key === "ArrowDown" ||
								e.key === "ArrowUp" ||
								e.key === "Home" ||
								e.key === "End"
							) {
								e.preventDefault();
								const items = Array.from(
									e.currentTarget.querySelectorAll<HTMLElement>(
										'button[role="menuitem"]:not([disabled])',
									),
								);
								if (items.length === 0) return;
								const curIdx = items.indexOf(
									document.activeElement as HTMLElement,
								);
								if (e.key === "Home") {
									items[0]?.focus();
								} else if (e.key === "End") {
									items[items.length - 1]?.focus();
								} else if (e.key === "ArrowDown") {
									const nextIdx =
										curIdx < items.length - 1 ? curIdx + 1 : 0;
									items[nextIdx]?.focus();
								} else if (e.key === "ArrowUp") {
									const prevIdx =
										curIdx > 0 ? curIdx - 1 : items.length - 1;
									items[prevIdx]?.focus();
								}
							}
						}}
					>
						{selectedIds.size > 1 && isInSelectedSet ? (
							<>
								<div className="px-2.5 py-1 font-semibold text-[11px] text-[var(--text-muted)] border-b border-[var(--border-divider)]">
									已选 {selectedIds.size} 个会话
								</div>
								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										closeMenu(true);
										onBatchAction(
											"archive",
											Array.from(selectedIds),
										);
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									<Archive size={13} />
									批量归档
								</button>
								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										closeMenu(true);
										onBatchAction(
											"pin",
											Array.from(selectedIds),
										);
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									<Pin size={13} />
									批量置顶 / 取消置顶
								</button>
								{batchAllInGlobalArea && (
									<button
										role="menuitem"
										tabIndex={-1}
										type="button"
										onClick={() => {
											closeMenu(true);
											requestMoveToGroup(Array.from(selectedIds));
										}}
										className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
									>
										<Tag size={13} />
										批量移到分组…
									</button>
								)}
								<div className="my-1 border-t border-[var(--border-divider)]" />
								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										closeMenu(true);
										onBatchAction(
											"delete",
											Array.from(selectedIds),
										);
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 text-left transition-colors"
								>
									<Trash2 size={13} />
									批量删除…
								</button>
							</>
						) : (
							<>
								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										closeMenu(false);
										startInlineRename();
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									<Pencil size={13} />
									重命名
								</button>

								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										void handleTogglePin();
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									{session.pinned ? (
										<PinOff size={13} />
									) : (
										<Pin size={13} />
									)}
									{session.pinned ? "取消置顶" : "置顶会话"}
								</button>

								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										closeMenu(true);
										requestArchive(session.id);
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									{session.archived ? (
										<ArchiveRestore size={13} />
									) : (
										<Archive size={13} />
									)}
									{session.archived ? "取消归档" : "归档会话"}
								</button>

								{/* R15: Emerald accept color */}
								{session.status === "review" && (
									<button
										role="menuitem"
										tabIndex={-1}
										type="button"
										onClick={() => {
											void handleAccept();
										}}
										className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-emerald-400 hover:bg-[var(--bg-hover)] text-left transition-colors"
									>
										<CheckCircle2 size={13} />
										验收并归档
									</button>
								)}

								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										closeMenu(true);
										requestAssign([session.id]);
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									<FolderInput size={13} />
									归入工作区…
								</button>

								{inGlobalArea && (
									<button
										role="menuitem"
										tabIndex={-1}
										type="button"
										onClick={() => {
											closeMenu(true);
											requestMoveToGroup([session.id]);
										}}
										className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
									>
										<Tag size={13} />
										移到分组…
									</button>
								)}

								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										closeMenu(true);
										useUi.getState().openModal("diagnose", { sessionId: session.id });
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									<Stethoscope size={13} />
									诊断此会话
								</button>

								{(session.status === "interrupted" ||
									session.status === "suspended") && (
									<button
										role="menuitem"
										tabIndex={-1}
										type="button"
										onClick={() => {
											void handleResume();
										}}
										className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-emerald-400 hover:bg-[var(--bg-hover)] text-left transition-colors"
									>
										<Play size={13} />
										恢复会话
									</button>
								)}


								{(session.status === "external" ||
									session.externalPid != null) && (
									<button
										role="menuitem"
										tabIndex={-1}
										type="button"
										onClick={() => {
											closeMenu(true);
											requestTakeover(session.id);
										}}
										className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-purple-400 hover:bg-[var(--bg-hover)] text-left transition-colors"
									>
										<ExternalLink size={13} />
										接管会话…
									</button>
								)}

								<div className="my-1 border-t border-[var(--border-divider)]" />

								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										void handleCopy(session.id, "会话 ID");
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									<Copy size={13} />
									复制会话 ID
								</button>

								{session.git?.branch && (
									<button
										role="menuitem"
										tabIndex={-1}
										type="button"
										onClick={() => {
											void handleCopy(
												session.git?.branch,
												"分支名",
											);
										}}
										className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
									>
										<GitBranch size={13} />
										复制分支名
									</button>
								)}

								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										void handleReveal();
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									<FolderOpen size={13} />
									在访达中打开
								</button>

								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									disabled={busy || restart.kind === "disabled"}
									title={
										restart.kind === "disabled"
											? restart.reason
											: restart.kind === "wake"
												? "启动该会话的 omp 进程，不发送任何消息"
												: "停止该会话的 omp 进程并在同一会话上重新启动，历史保留"
									}
									onClick={() => {
										void handleRestart();
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
								>
									<RotateCw size={13} className={busy ? "animate-spin" : undefined} />
									<span className="flex min-w-0 flex-col">
										<span>重启会话</span>
										{restart.kind === "disabled" && (
											<span className="text-[10px] text-[var(--text-muted)]">
												{restart.reason}
											</span>
										)}
									</span>
								</button>

								<div className="my-1 border-t border-[var(--border-divider)]" />

								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									disabled={isSessionBusy(session)}
									title={
										isSessionBusy(session)
											? "会话仍在运行，请先停止当前回合"
											: undefined
									}
									onClick={() => {
										closeMenu(true);
										void requestDelete([session.id]);
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
								>
									<Trash2 size={13} />
									删除会话…
								</button>
							</>
						)}
					</div>
				</FloatingLayer>
			)}

			{/* Superset HoverCard preview (R10): mounted only while open */}
			{hoverCardOpen && anchorRect && !menuOpen && !isRenaming && (
				<HoverCardGate
					session={session}
					anchorRect={anchorRect}
					workspaces={workspaces}
					onMouseEnterCard={handleCardMouseEnter}
					onMouseLeaveCard={handleCardMouseLeave}
				/>
			)}
		</div>
	);
}

export const SessionRow = React.memo(SessionRowComponent, (prev, next) => {
	return (
		prev.session === next.session &&
		prev.withSpine === next.withSpine &&
		prev.large === next.large &&
		prev.workspaces === next.workspaces &&
		prev.onRowFocus === next.onRowFocus &&
		prev.onBatchAction === next.onBatchAction
	);
});
SessionRow.displayName = "SessionRow";
