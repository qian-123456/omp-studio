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
import { tNow, useT } from "../../stores/language";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { isLocalDraftId, selectSessionOrDraft, usePendingSession } from "./pendingSession";
import { discardDraft } from "./draftSession";
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
	/** When true, extends the trunk line slightly upward to connect with the header above. */
	spineFirst?: boolean;
	/** When true and withSpine is true, terminates the guide line with an elbow (└─). */
	spineLast?: boolean;
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
	| { kind: "spinner"; labelKey: string; pillCls: string }
	| { kind: "pill"; labelKey: string }
	| { kind: "dot"; labelKey: string; dotCls: string; pillCls: string };

const STATUS_CONFIG: Record<SessionMeta["status"], StatusMark> = {
	awaiting_approval: { kind: "pill", labelKey: "sessions.statusAwaiting" },
	awaiting_answer: { kind: "pill", labelKey: "sessions.statusAwaiting" },
	review: { kind: "none" },
	error: {
		kind: "dot",
		labelKey: "sessions.statusAbnormal",
		dotCls: "bg-red-500",
		pillCls: "bg-red-500/15 text-red-400",
	},
	interrupted: {
		kind: "dot",
		labelKey: "sessions.statusInterrupted",
		dotCls: "bg-red-500",
		pillCls: "bg-red-500/15 text-red-400",
	},
	working: {
		kind: "spinner",
		labelKey: "sessions.statusRunning",
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
				{tNow(cfg.labelKey)}
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

const isMac = () =>
	typeof navigator !== "undefined" &&
	/Macintosh|Mac OS X|macOS|iPhone|iPad/i.test(navigator.userAgent);

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

// Store actions are stable; calling them via getState() avoids one zustand
// subscription per row for each action.
const selectSession = (id: string | null) => selectSessionOrDraft(id);
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
	spineFirst = false,
	spineLast = false,
	large = false,
	workspaces,
	onRowFocus,
	onBatchAction,
}: SessionRowProps) {
	const { t } = useT();
	// Re-evaluate relative time on shared minute ticks (R3)
	useMinuteTick();

	// Narrow boolean selectors: a selection change re-renders only rows whose
	// own flags flip (selectedIds is a fresh Set on every change).
	const isInSelectedSet = useUi((s) => s.selectedIds.has(session.id));
	const hasMultiSelection = useUi((s) => s.selectedIds.size > 1);
	// A local draft row is selected while its view is the center pane.
	const isDraftRow = isLocalDraftId(session.id);
	const isDraftShown = usePendingSession((s) => isDraftRow && s.selectedId === session.id);
	const isPrimarySelected = useUi((s) =>
		s.selectedSessionId === session.id ||
		(isDraftShown && s.selectedSessionId === null && s.centerView === "session"),
	);

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
			toast.success(trimmed === "" ? t("sessions.titleResetDefault") : t("sessions.renamed"));
		} catch (err) {
			// Stay in rename mode on failure so text is not lost (R17)
			toast.error(t("sessions.renameFailed", { error: errMsg(err) }));
		}
	};

	const handleRowClick = (e: React.MouseEvent) => {
		// macOS Ctrl+Click is a context-menu gesture, not a row selection / multi-select.
		if (isMac() && e.ctrlKey && !e.metaKey) {
			if (!menuOpen) {
				handleContextMenu(e);
			}
			return;
		}

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
		} else if (e.metaKey || (!isMac() && e.ctrlKey)) {
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

	// Right-click opens the context menu without switching the active session.
	const handleContextMenu = (e: MouseEvent | React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		// A local draft has no session to act on; its trash button is the only action.
		if (isDraftRow) return;
		onRowFocus?.();
		prevActiveElementRef.current =
			(document.activeElement as HTMLElement) ?? null;
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
			toast.error(t("sessions.togglePinFailed", { error: errMsg(err) }));
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
				toast.error(t("sessions.resumeSessionFailed", { error: errMsg(err) }));
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
			toast.success(t("sessions.acceptedAndArchived"));
		} catch (err) {
			toast.error(t("sessions.acceptFailed", { error: errMsg(err) }));
		}
	};

	const restart = restartState(session);
	const handleRestart = async () => {
		if (busy || restart.kind === "disabled") return;
		closeMenu(true);
		if (restart.kind === "live" && restartNeedsConfirm(session)) {
			const ok = await confirmDialog(
				t("sessions.confirmRestartBusy"),
				{ title: t("sessions.restartSession"), okLabel: t("sessions.restartAction"), danger: true },
			);
			if (!ok) return;
		}
		setBusy(true);
		try {
			if (restart.kind === "live") {
				await rpcRestart(session.id);
				toast.success(t("sessions.restartedSession", { title: sessionDisplayName(session) }));
			} else {
				await ensureLive(session.id);
				toast.success(t("sessions.startedSessionNoMessage", { title: sessionDisplayName(session) }));
			}
		} catch (err) {
			if (isResumeCancelled(err)) return;
			toast.error(t("sessions.restartSessionFailed", { error: errMsg(err) }));
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
			toast.success(t("sessions.copiedNamed", { name: label }));
		} catch (err) {
			toast.error(t("sessions.copyFailed", { error: errMsg(err) }));
		}
	};

	const handleReveal = async () => {
		closeMenu(true);
		try {
			await revealItemInDir(session.cwd);
		} catch (err) {
			toast.error(t("sessions.openInFinderFailed", { error: errMsg(err) }));
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
			{/* Subgroup guide line segment (P9/P10) — subagent-style terminal tree branch */}
			{withSpine && (
				<span
					aria-hidden
					className="pointer-events-none absolute -left-[8px] select-none"
					style={{
						top: spineFirst ? "-6px" : "0px",
						bottom: spineLast ? "auto" : "0px",
						height: spineLast
							? spineFirst
								? `${(large ? 15 : 14) + 6}px`
								: `${large ? 15 : 14}px`
							: undefined,
						width: "8px",
					}}
				>
					{/* Vertical trunk line */}
					<span
						className={clsx(
							"absolute left-0 top-0 border-l border-[var(--tree-line)]",
							spineLast ? "rounded-bl-[6px] border-b" : "bottom-0",
						)}
						style={
							spineLast
								? {
										height: spineFirst
											? `${(large ? 15 : 14) + 6}px`
											: `${large ? 15 : 14}px`,
										width: "8px",
									}
								: undefined
						}
					/>
					{/* Horizontal elbow branch for non-last items */}
					{!spineLast && (
						<span
							className="absolute left-0 w-[8px] border-t border-[var(--tree-line)]"
							style={{ top: `${large ? 15 : 14}px` }}
						/>
					)}
				</span>
			)}

			{/* Title column: status mark sits directly after title text (U3 / R13) */}
			<div className="flex min-w-0 flex-1 items-center gap-1.5">
				{session.kind === "side" ? (
					<span
						className="shrink-0 text-[var(--text-dim)]"
						title={t("sessions.sideChatFrom", { title: parentTitle || t("sessions.missingSessionTitle") })}
					>
						<MessageSquare size={11} />
					</span>
				) : session.kind === "fork" ? (
					<span
						className="inline-flex shrink-0 items-center gap-0.5 rounded bg-indigo-500/15 px-1 text-[10px] leading-4 text-indigo-400"
						title={t("sessions.forkedFrom", { title: parentTitle || t("sessions.missingSessionTitle") })}
					>
						<GitFork size={9} />
						{t("sessions.forkLabel")}
					</span>
				) : (
					session.parentId && (
						<span
							className="shrink-0 text-[var(--text-dim)]"
							title={t("sessions.forkedFrom", { title: parentTitle || t("sessions.missingSessionTitle") })}
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
						{t("sessions.statusDraft")}
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
					<span title={t("sessionActions.archived")} className="shrink-0 flex items-center text-[var(--text-dim)]">
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
						title={t("sessions.unread")}
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
								{t(m.labelKey)}
							</span>
						);
					})()}
					{session.pinned && (
						<Pin
							size={11}
							className="shrink-0 fill-amber-400/40 text-amber-400 @max-[220px]:hidden"
						/>
					)}
					{isDraftRow ? (
						<button
							tabIndex={-1}
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								void discardDraft(session.id);
							}}
							className="press-scale flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-0.5"
							title={t("common.delete")}
						>
							<Trash2 size={14} />
						</button>
					) : (
						<button
							ref={menuBtnRef}
							tabIndex={-1}
							type="button"
							onClick={handleMenuBtnClick}
							className="press-scale flex items-center justify-center text-[var(--text-dim)] hover:text-[var(--text)] transition-colors p-0.5"
							title={t("sessions.actionsMenu")}
						>
							<MoreHorizontal size={14} />
						</button>
					)}
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
						aria-label={t("sessions.sessionActionsAria")}
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
									{t("sessions.selectedSessionsCount", { count: selectedIds.size })}
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
									{t("sessionActions.batchArchive")}
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
									{t("sessionActions.batchPin")}
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
										{t("sessionActions.batchMoveToGroup")}
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
									{t("sessionActions.batchDelete")}
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
									{t("sessionActions.rename")}
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
									{session.pinned ? t("sessionActions.unpin") : t("sessionActions.pin")}
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
									{session.archived ? t("sessionActions.unarchive") : t("sessionActions.archive")}
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
										{t("sessionActions.acceptAndArchive")}
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
									{t("sessionActions.assignToWorkspaceEllipsis")}
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
										{t("sessionActions.moveToGroupEllipsis")}
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
									{t("sessionActions.diagnoseSession")}
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
										{t("sessionActions.resumeSession")}
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
										{t("sessionActions.takeoverSession")}
									</button>
								)}

								<div className="my-1 border-t border-[var(--border-divider)]" />

								<button
									role="menuitem"
									tabIndex={-1}
									type="button"
									onClick={() => {
										void handleCopy(session.id, t("sessions.sessionId"));
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
								>
									<Copy size={13} />
									{t("sessionActions.copySessionId")}
								</button>

								{session.git?.branch && (
									<button
										role="menuitem"
										tabIndex={-1}
										type="button"
										onClick={() => {
											void handleCopy(
												session.git?.branch,
												t("sessions.branchName"),
											);
										}}
										className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors"
									>
										<GitBranch size={13} />
										{t("sessionActions.copyBranchName")}
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
									{t("sessionActions.openInFinder")}
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
												? t("sessions.startOmpWakeDesc")
												: t("sessions.startOmpRestartDesc")
									}
									onClick={() => {
										void handleRestart();
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
								>
									<RotateCw size={13} className={busy ? "animate-spin" : undefined} />
									<span className="flex min-w-0 flex-col">
										<span>{t("sessionActions.restartSession")}</span>
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
											? t("sessions.sessionBusyStopFirst")
											: undefined
									}
									onClick={() => {
										closeMenu(true);
										void requestDelete([session.id]);
									}}
									className="press-scale flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40"
								>
									<Trash2 size={13} />
									{t("sessionActions.delete")}
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
		prev.spineFirst === next.spineFirst &&
		prev.spineLast === next.spineLast &&
		prev.large === next.large &&
		prev.workspaces === next.workspaces &&
		prev.onRowFocus === next.onRowFocus &&
		prev.onBatchAction === next.onBatchAction
	);
});
SessionRow.displayName = "SessionRow";
