import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	AlertCircle,
	Archive,
	ChevronDown,
	ChevronRight,
	Clock,
	FoldVertical,
	Folder,
	FolderGit2,
	FolderInput,
	FolderOpen,
	FolderPlus,
	Globe,
	Inbox,
	Loader2,
	Pin,
	Plus,
	Search,
	Settings as SettingsIcon,
	Trash2,
	Undo2,
	UnfoldVertical,
	X,
} from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import { createSession } from "../../lib/createSession";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isComposing, useEscapeKey } from "../../lib/hooks";
import { sessionDisplayName } from "../../lib/sessionName";
import {
	addWorkspace,
	deleteSession,
	gitCreateWorktree,
	gitSummary,
	removeWorkspace,
	updateSessionMeta,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useArchiveUndo, undoArchive } from "./archiveUndo";
import {
	type BranchSubgroup,
	DELETED_LABEL,
	type SessionTreeNode,
	UNASSIGNED_LABEL,
	groupSessions,
	partitionNodes,
} from "./grouping";
import { SessionRow } from "./SessionRow";

/** Sessions shown per section before a "show more" row appears. */
const RECENT_LIMIT = 12;
/** Extra sessions revealed per "show more" click — never dumps the whole list. */
const RECENT_STEP = 10;
const COLLAPSED_GROUPS_KEY = "ompws:collapsed-groups";

function readCollapsedGroups(): Record<string, boolean> {
	try {
		const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				return parsed;
			}
		}
	} catch {
		/* ignore */
	}
	return {
		__unassigned: false,
		__deleted: false,
	};
}

function writeCollapsedGroups(state: Record<string, boolean>) {
	try {
		localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(state));
	} catch {
		/* ignore */
	}
}


interface PlusMenuState {
	ws: Workspace;
	x: number;
	y: number;
}

interface WsMenuState {
	ws: Workspace;
	x: number;
	y: number;
}

/**
 * [A] Left column: complete session list grouped by workspace (§11 A).
 * - 🌐 Global workspace fixed on top (PLAN.md §67)
 * - Registered workspaces with right-click actions (Finder, remove)
 * - Worktree/branch subgrouping
 * - Unassigned ("未归档会话") bucket collapsed by default (PLAN.md §66)
 * - Deleted worktree bucket ("已清理的 Worktree") kept visible instead of vanishing
 * - Search + Archive toggle + Clearer "已清理" toggle
 * - Keyboard navigation (↑/↓ to select, Enter to open, Delete to archive)
 * - Skeleton rows while loading to eliminate cold-start flash
 * - Bottom Undo bar for archive recovery
 */
export function SessionSidebar() {
	const sessions = useSessions((s) => s.sessions);
	const workspaces = useSessions((s) => s.workspaces);
	const hasLoaded = useSessions((s) => s.hasLoaded);
	const loadSessions = useSessions((s) => s.load);
	const openModal = useUi((s) => s.openModal);
	const selectSession = useUi((s) => s.selectSession);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const highlightId = useUi((s) => s.highlightId);
	const setHighlightId = useUi((s) => s.setHighlightId);
	const centerView = useUi((s) => s.centerView);
	const setCenter = useUi((s) => s.setCenter);
	const undoItem = useArchiveUndo((s) => s.item);

	// Load data on initial mount
	useEffect(() => {
		loadSessions().catch((err) => {
			setErrorMessage(`加载会话列表失败: ${errMsg(err)}`);
		});
	}, [loadSessions]);

	// Search & Archive controls
	const [searchQuery, setSearchQuery] = useState("");
	const [showArchived, setShowArchived] = useState(false);
	// Default to true: sessions on deleted worktrees are NOT silently hidden
	const [showDeletedWt, setShowDeletedWt] = useState(true);

	// Group open states (explicit user toggles). Defaults:
	// - project/global workspaces: open
	// - unassigned bucket: collapsed
	// - deleted worktree bucket: collapsed
	const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() =>
		readCollapsedGroups(),
	);

	// Per-section disclosure state, keyed per subgroup:
	// - `…|more` stores how many recent sessions are visible (default RECENT_LIMIT)
	// - `…|older` / `…|sub` are 0/1 open flags
	const [expandedSections, setExpandedSections] = useState<
		Record<string, number>
	>({});
	const toggleSection = (key: string) =>
		setExpandedSections((prev) => ({ ...prev, [key]: prev[key] ? 0 : 1 }));
	const setSectionCount = (key: string, count: number) =>
		setExpandedSections((prev) => ({ ...prev, [key]: count }));

	// Collapsed side-chat parent IDs
	const [collapsedSideChats, setCollapsedSideChats] = useState<
		Record<string, boolean>
	>({});
	const toggleSideChat = (id: string) =>
		setCollapsedSideChats((prev) => ({ ...prev, [id]: !prev[id] }));

	const searching = searchQuery.trim().length > 0;

	// In-flight workspace creation indicator
	const [creatingWs, setCreatingWs] = useState<string | null>(null);

	// Visible error message banner
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// Popover menus: "+" button and workspace header right-click
	const [plusMenu, setPlusMenu] = useState<PlusMenuState | null>(null);
	const [wsMenu, setWsMenu] = useState<WsMenuState | null>(null);
	const [assignAllTarget, setAssignAllTarget] = useState<string[] | null>(null);

	const scrollRef = useRef<HTMLDivElement>(null);
	const plusMenuRef = useRef<HTMLDivElement>(null);
	const wsMenuRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const focusList = () => scrollRef.current?.focus();

	// Close context/popover menus on outside click
	useEffect(() => {
		if (!plusMenu && !wsMenu) return;
		const onDown = (e: MouseEvent) => {
			if (
				plusMenuRef.current &&
				!plusMenuRef.current.contains(e.target as Node)
			) {
				setPlusMenu(null);
			}
			if (wsMenuRef.current && !wsMenuRef.current.contains(e.target as Node)) {
				setWsMenu(null);
			}
		};
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [plusMenu, wsMenu]);

	useEscapeKey(() => {
		if (plusMenu) setPlusMenu(null);
		if (wsMenu) setWsMenu(null);
		if (assignAllTarget) setAssignAllTarget(null);
	}, Boolean(plusMenu || wsMenu || assignAllTarget));

	// Compute grouped tree
	const grouped = useMemo(() => {
		return groupSessions(sessions, workspaces, {
			searchQuery,
			showArchived,
			showDeletedWorktrees: showDeletedWt,
		});
	}, [sessions, workspaces, searchQuery, showArchived, showDeletedWt]);

	const isGroupOpen = (id: string, defaultOpen = true) => {
		if (searching) return true; // expand matches while searching
		const val = groupOpen[id];
		return val === undefined ? defaultOpen : val;
	};

	const toggleGroup = (id: string, defaultOpen = true) => {
		setGroupOpen((prev) => {
			const current = prev[id] === undefined ? defaultOpen : prev[id];
			const next = { ...prev, [id]: !current };
			writeCollapsedGroups(next);
			return next;
		});
	};

	const allVisibleIds = useMemo(() => {
		const list: string[] = [];
		if (grouped.pinnedNodes.length > 0 && isGroupOpen("__pinned", true)) {
			list.push(...grouped.pinnedNodes.map((n) => n.session.id));
		}
		if (grouped.globalGroup && isGroupOpen("__global", true)) {
			for (const sg of grouped.globalGroup.subgroups) {
				list.push(...sg.nodes.map((n) => n.session.id));
			}
		}
		for (const wg of grouped.workspaceGroups) {
			if (isGroupOpen(wg.workspace.id, true)) {
				for (const sg of wg.subgroups) {
					list.push(...sg.nodes.map((n) => n.session.id));
				}
			}
		}
		if (isGroupOpen("__unassigned", false)) {
			list.push(...grouped.unassigned.map((n) => n.session.id));
		}
		if (isGroupOpen("__deleted", false)) {
			list.push(...grouped.deletedNodes.map((n) => n.session.id));
		}
		return list;
	}, [grouped, groupOpen, searching]);

	const allGroupIds = useMemo(() => {
		const ids: string[] = [];
		if (grouped.pinnedNodes.length > 0) ids.push("__pinned");
		if (grouped.globalGroup) ids.push("__global");
		for (const wg of grouped.workspaceGroups) ids.push(wg.workspace.id);
		ids.push("__unassigned");
		if (grouped.deletedNodes.length > 0) ids.push("__deleted");
		return ids;
	}, [grouped]);

	const areAllCollapsed = useMemo(() => {
		if (allGroupIds.length === 0) return false;
		return allGroupIds.every(
			(id) => !isGroupOpen(id, id !== "__unassigned" && id !== "__deleted"),
		);
	}, [allGroupIds, groupOpen, searching]);

	const handleToggleAllGroups = () => {
		const next: Record<string, boolean> = {};
		const shouldExpand = areAllCollapsed;
		for (const id of allGroupIds) {
			next[id] = shouldExpand;
		}
		setGroupOpen(next);
		writeCollapsedGroups(next);
	};

	const getGroupStatusCounts = (nodes: SessionTreeNode[] | BranchSubgroup[]) => {
		let working = 0;
		let error = 0;
		const check = (s: SessionMeta) => {
			if (s.status === "working") working++;
			else if (s.status === "error") error++;
		};
		for (const item of nodes) {
			if ("session" in item) {
				check(item.session);
				for (const c of item.children) check(c.session);
			} else if ("nodes" in item) {
				for (const n of item.nodes) {
					check(n.session);
					for (const c of n.children) check(c.session);
				}
			}
		}
		return { working, error };
	};

	const renderBubbleBadges = (counts: { working: number; error: number }) => {
		if (counts.working === 0 && counts.error === 0) return null;
		return (
			<div className="flex items-center gap-1 ml-1.5">
				{counts.working > 0 && (
					<span
						className="flex items-center gap-1 rounded-full bg-emerald-500/20 px-1.5 py-0.2 text-[9px] font-mono text-emerald-300 border border-emerald-500/40"
						title={`${counts.working} 个运行中的会话`}
					>
						<span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
						{counts.working}
					</span>
				)}
				{counts.error > 0 && (
					<span
						className="rounded-full bg-rose-500/20 px-1.5 py-0.2 text-[9px] font-mono text-rose-300 border border-rose-500/40"
						title={`${counts.error} 个异常会话`}
					>
						{counts.error}
					</span>
				)}
			</div>
		);
	};

	const handleBatchAction = async (
		action: "archive" | "pin" | "delete",
		ids: string[],
	) => {
		if (ids.length === 0) return;
		if (action === "archive") {
			try {
				for (const id of ids) {
					const updated = await updateSessionMeta(id, { archived: true });
					useSessions.getState().upsert([updated]);
				}
				toast.success(`已归档 ${ids.length} 个会话`);
			} catch (err) {
				toast.error(`批量归档失败: ${errMsg(err)}`);
			}
		} else if (action === "pin") {
			try {
				const allPinned = ids.every((id) => sessions[id]?.pinned);
				for (const id of ids) {
					const updated = await updateSessionMeta(id, { pinned: !allPinned });
					useSessions.getState().upsert([updated]);
				}
				toast.success(allPinned ? "已取消置顶" : "已批量置顶");
			} catch (err) {
				toast.error(`批量置顶失败: ${errMsg(err)}`);
			}
		} else if (action === "delete") {
			const ok = await confirmDialog(`永久删除选中的 ${ids.length} 个会话？此操作不可恢复。`, {
				danger: true,
				okLabel: "批量删除",
				title: "批量删除会话",
			});
			if (!ok) return;
			try {
				for (const id of ids) {
					await deleteSession(id);
				}
				useSessions.getState().remove(ids);
				selectSession(null);
				toast.success(`已删除 ${ids.length} 个会话`);
			} catch (err) {
				toast.error(`批量删除失败: ${errMsg(err)}`);
			}
		}
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
				selectedPath = window.prompt("请输入工作区绝对路径：");
			}

			if (selectedPath) {
				await addWorkspace(selectedPath);
				await loadSessions();
				toast.success("已添加工作区");
			}
		} catch (err) {
			toast.error(`添加工作区失败: ${errMsg(err)}`);
		}
	};

	// "+" button click: opens a popover menu (current dir vs new worktree)
	// instead of silently mutating git state on disk.
	const handlePlusClick = (ws: Workspace, e: React.MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();
		if (e.altKey) {
			openModal("new-session", { workspaceId: ws.id, cwd: ws.path });
			return;
		}
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		setPlusMenu({
			ws,
			x: Math.min(rect.left, window.innerWidth - 210),
			y: rect.bottom + 4,
		});
	};

	// Create session under workspace: either directly in cwd or in a fresh worktree.
	const startSessionInDir = async (ws: Workspace, isolatedWorktree: boolean) => {
		setPlusMenu(null);
		if (creatingWs) return;
		setCreatingWs(ws.id);
		try {
			let cwd = ws.path;
			if (isolatedWorktree && ws.kind !== "global") {
				const summary = await gitSummary(ws.path).catch(() => null);
				if (summary?.isRepo) {
					const wt = await gitCreateWorktree(
						ws.path,
						`task-${Math.floor(Date.now() / 1000)}`,
					);
					cwd = wt.path;
				}
			}
			const { sessionId, stub } = await createSession({
				cwd,
				workspaceId: ws.id,
			});
			useSessions.getState().upsert([stub]);
			selectSession(sessionId);
		} catch (err) {
			toast.error(`创建会话失败: ${errMsg(err)}`);
		} finally {
			setCreatingWs(null);
		}
	};
	// Quick-create a session inside an existing worktree/branch checkout
	// (subgroup header "+"). Skips the dialog: reuses createSession directly.
	const startSessionAt = async (ws: Workspace, cwd: string) => {
		if (creatingWs) return;
		setCreatingWs(ws.id);
		try {
			const { sessionId, stub } = await createSession({
				cwd,
				workspaceId: ws.id,
			});
			useSessions.getState().upsert([stub]);
			selectSession(sessionId);
		} catch (err) {
			toast.error(`创建会话失败: ${errMsg(err)}`);
		} finally {
			setCreatingWs(null);
		}
	};

	// Workspace header right-click menu: Finder, remove workspace
	const handleWorkspaceContextMenu = (ws: Workspace, e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setWsMenu({
			ws,
			x: Math.min(e.clientX, window.innerWidth - 190),
			y: Math.min(e.clientY, window.innerHeight - 200),
		});
	};

	const handleRemoveWorkspace = async (ws: Workspace) => {
		setWsMenu(null);
		if (ws.kind === "global") {
			toast.info("全局工作区不可移除");
			return;
		}
		const ok = await confirmDialog(
			`确定从工作区列表中移除「${ws.name}」？\n所属会话将变为未归档，磁盘文件不受影响。`,
			{ title: "移除工作区", danger: true, okLabel: "移除" },
		);
		if (!ok) return;
		try {
			await removeWorkspace(ws.id);
			await loadSessions();
			toast.success("已移除工作区");
		} catch (err) {
			toast.error(`移除工作区失败: ${errMsg(err)}`);
		}
	};

	const handleRevealWorkspace = async (ws: Workspace) => {
		setWsMenu(null);
		try {
			await revealItemInDir(ws.path);
		} catch (err) {
			toast.error(`在访达中打开失败: ${errMsg(err)}`);
		}
	};

	// Batch archive with confirmation (PLAN / audit 🔴 2)
	const batchArchiveSessions = async (
		title: string,
		sessionList: SessionMeta[],
	) => {
		if (sessionList.length === 0) return;
		const unarchived = sessionList.filter((s) => !s.archived);
		if (unarchived.length === 0) {
			toast.info("该分组下无需要归档的会话");
			return;
		}
		const ok = await confirmDialog(
			`确定批量归档「${title}」下的 ${unarchived.length} 个会话？`,
			{ title: "批量归档", danger: true, okLabel: `归档 ${unarchived.length} 个会话` },
		);
		if (!ok) return;
		try {
			for (const s of unarchived) {
				const updated = await updateSessionMeta(s.id, { archived: true });
				useSessions.getState().upsert([updated]);
			}
			toast.success(`已归档 ${unarchived.length} 个会话`);
		} catch (err) {
			toast.error(`批量归档失败: ${errMsg(err)}`);
		}
	};

	// Batch assign all unassigned sessions to a workspace
	const handleBatchAssign = async (workspaceId: string) => {
		const targetIds = assignAllTarget ?? [];
		setAssignAllTarget(null);
		if (targetIds.length === 0) return;
		try {
			for (const id of targetIds) {
				const updated = await updateSessionMeta(id, { workspaceId });
				useSessions.getState().upsert([updated]);
			}
			toast.success(`已将 ${targetIds.length} 个会话归入工作区`);
		} catch (err) {
			toast.error(`归入工作区失败: ${errMsg(err)}`);
		}
	};

	// Keyboard navigation: ↑/↓ move highlight, Enter opens, Delete archives, Shift+Delete permanently deletes
	const handleListKeyDown = (e: React.KeyboardEvent) => {
		const container = scrollRef.current;
		if (!container) return;
		const target = e.target as HTMLElement;
		if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;

		const rowElements = Array.from(
			container.querySelectorAll<HTMLElement>("[data-session-id]"),
		);
		if (rowElements.length === 0) return;

		const ids = rowElements.map((el) => el.getAttribute("data-session-id")!);
		const activeId = highlightId ?? selectedSessionId ?? "";
		const currentIndex = ids.indexOf(activeId);

		if (e.key === "ArrowDown") {
			e.preventDefault();
			const nextIdx =
				currentIndex < 0 ? 0 : Math.min(currentIndex + 1, ids.length - 1);
			const nextId = ids[nextIdx];
			setHighlightId(nextId);
			rowElements[nextIdx]?.scrollIntoView({ block: "nearest" });
			clearTimeout(debounceTimerRef.current ?? undefined);
			debounceTimerRef.current = setTimeout(() => {
				selectSession(nextId);
			}, 300);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			const prevIdx =
				currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
			const prevId = ids[prevIdx];
			setHighlightId(prevId);
			rowElements[prevIdx]?.scrollIntoView({ block: "nearest" });
			clearTimeout(debounceTimerRef.current ?? undefined);
			debounceTimerRef.current = setTimeout(() => {
				selectSession(prevId);
			}, 300);
		} else if (e.key === "Enter") {
			const targetId = highlightId ?? selectedSessionId;
			if (targetId) {
				e.preventDefault();
				clearTimeout(debounceTimerRef.current ?? undefined);
				selectSession(targetId);
			}
		} else if (e.key === "ArrowLeft") {
			e.preventDefault();
			const targetId = highlightId ?? selectedSessionId;
			if (targetId) {
				const meta = sessions[targetId];
				// If this session has side chats and is expanded, collapse them
				const hasChildren = Object.values(sessions).some((s) => s.parentId === targetId);
				if (hasChildren && !collapsedSideChats[targetId]) {
					toggleSideChat(targetId);
					return;
				}
				// Otherwise collapse the group it belongs to
				if (meta?.workspaceId && isGroupOpen(meta.workspaceId, true)) {
					toggleGroup(meta.workspaceId, true);
				} else if (!meta?.workspaceId && isGroupOpen("__unassigned", false)) {
					toggleGroup("__unassigned", false);
				}
			}
		} else if (e.key === "ArrowRight") {
			e.preventDefault();
			const targetId = highlightId ?? selectedSessionId;
			if (targetId) {
				const meta = sessions[targetId];
				if (collapsedSideChats[targetId]) {
					toggleSideChat(targetId);
					return;
				}
				if (meta?.workspaceId && !isGroupOpen(meta.workspaceId, true)) {
					toggleGroup(meta.workspaceId, true);
				} else if (!meta?.workspaceId && !isGroupOpen("__unassigned", false)) {
					toggleGroup("__unassigned", false);
				}
			}
		} else if (e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
			// Shift+Delete: Permanent delete confirmation
			const targetId = highlightId ?? selectedSessionId;
			if (!targetId) return;
			const meta = sessions[targetId];
			if (!meta) return;
			e.preventDefault();
			if (meta.live || meta.status === "working") {
				toast.info("会话仍在运行，请先挂起或停止");
				return;
			}
			confirmDialog(
					`永久删除会话「${sessionDisplayName(meta)}」？\n此操作不可恢复。`,
				{ danger: true, okLabel: "永久删除", title: "永久删除会话" },
			).then(async (ok) => {
				if (!ok) return;
				try {
					await deleteSession(targetId);
					useSessions.getState().remove([targetId]);
					const nextIdx = currentIndex < ids.length - 1 ? currentIndex : currentIndex - 1;
					const nextId = ids[nextIdx] ?? null;
					selectSession(nextId);
					setHighlightId(nextId);
					toast.success("会话已永久删除");
				} catch (err) {
					toast.error(`删除会话失败: ${errMsg(err)}`);
				}
			});
		} else if (e.key === "Delete" || e.key === "Backspace") {
			// Regular Delete: Archive session
			const targetId = highlightId ?? selectedSessionId;
			if (!targetId) return;
			const meta = sessions[targetId];
			if (!meta || meta.archived) return;
			e.preventDefault();
			const nextIdx = currentIndex < ids.length - 1 ? currentIndex : currentIndex - 1;
			const nextId = ids[nextIdx] ?? null;
			selectSession(nextId);
			setHighlightId(nextId);
			if (meta.git?.worktree) {
				confirmDialog(
						`归档会话「${sessionDisplayName(meta)}」？\n（关联工作树将被保留）`,
					{ title: "归档会话", okLabel: "仅归档会话" },
				).then((ok) => {
					if (!ok) return;
					updateSessionMeta(meta.id, { archived: true })
						.then((updated) => {
							useSessions.getState().upsert([updated]);
							useArchiveUndo.getState().show({
								sessionId: meta.id,
								title: sessionDisplayName(meta),
							});
						})
						.catch((err) => toast.error(`归档失败: ${errMsg(err)}`));
				});
			} else {
				updateSessionMeta(meta.id, { archived: true })
					.then((updated) => {
						useSessions.getState().upsert([updated]);
						useArchiveUndo.getState().show({
							sessionId: meta.id,
							title: sessionDisplayName(meta),
						});
					})
					.catch((err) => toast.error(`归档失败: ${errMsg(err)}`));
			}
		}
	};

	return (
		<div
			onKeyDown={(e) => {
				if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
					e.preventDefault();
					searchInputRef.current?.focus();
					searchInputRef.current?.select();
				}
			}}
			className="flex h-full flex-col bg-neutral-900/60 text-neutral-300 text-xs select-none"
		>
			{/* Top Bar: Clean Title + Compact Icon Action Toolbar + Search */}
			<div className="flex flex-col gap-2 border-b border-neutral-800/80 p-2.5">
				<div className="flex items-center justify-between">
					<span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
						会话列表
					</span>

					<div className="flex items-center gap-0.5">
						{/* Toggle Archive */}
						<button
							type="button"
							onClick={() => setShowArchived((v) => !v)}
							className={clsx(
								"flex h-7 w-7 items-center justify-center rounded-md transition-colors",
								showArchived
									? "bg-amber-950/60 text-amber-300 border border-amber-800/60"
									: "text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200",
							)}
							title={showArchived ? "隐藏已归档会话 (当前: 已显示)" : "显示已归档会话"}
						>
							<Archive size={13} />
						</button>

						{/* Toggle deleted-worktree sessions */}
						<button
							type="button"
							onClick={() => setShowDeletedWt((v) => !v)}
							className={clsx(
								"flex h-7 w-7 items-center justify-center rounded-md transition-colors",
								showDeletedWt
									? "bg-neutral-800 text-neutral-200 border border-neutral-700"
									: "text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-300",
							)}
							title={
								showDeletedWt
									? "隐藏已清理 Worktree 的会话 (当前: 已显示)"
									: "显示已清理 Worktree 的会话（目录已删的历史记录）"
							}
						>
							<FolderGit2 size={13} />
						</button>

						{/* Add Workspace Button */}
						<button
							type="button"
							onClick={handleAddWorkspace}
							className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
							title="添加项目工作区目录"
						>
							<FolderPlus size={13} />
						</button>

						{/* Collapse/Expand All Button */}
						<button
							type="button"
							onClick={handleToggleAllGroups}
							className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200 transition-colors"
							title={areAllCollapsed ? "全部展开" : "全部折叠"}
						>
							{areAllCollapsed ? (
								<UnfoldVertical size={13} />
							) : (
								<FoldVertical size={13} />
							)}
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
						ref={searchInputRef}
						type="text"
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						onKeyDown={(e) => {
							if (isComposing(e)) return;
							if (e.key === "Escape") {
								e.preventDefault();
								if (searchQuery) {
									setSearchQuery("");
								} else {
									scrollRef.current?.focus();
								}
							}
						}}
						placeholder="搜索会话、分支、标签... (Cmd+F)"
						className="w-full rounded-lg border border-neutral-800 bg-neutral-950/80 py-1.5 pl-8 pr-7 text-xs text-neutral-200 placeholder:text-neutral-500 focus:border-neutral-700 focus:outline-none transition-colors"
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

			{/* Session Groups Scroll Area (keyboard accessible) */}
			<div
				ref={scrollRef}
				tabIndex={0}
				onKeyDown={handleListKeyDown}
				className="flex-1 overflow-y-auto divide-y divide-neutral-800/40 focus:outline-none"
			>
				{/* Cold-start skeleton rows: realistic two-line rows with status dots */}
				{!hasLoaded && (
					<div className="p-2 space-y-3 animate-pulse">
						<div className="flex items-center gap-2 mb-2 px-1">
							<div className="h-3.5 bg-neutral-800/80 rounded w-20" />
							<div className="h-3.5 bg-neutral-800/40 rounded w-5 ml-auto" />
						</div>
						{[1, 2, 3, 4, 5].map((i) => (
							<div
								key={i}
								className="flex flex-col gap-1.5 px-2 py-1.5 rounded bg-neutral-800/20"
							>
								{/* Line 1: Status dot + #id + title */}
								<div className="flex items-center gap-2">
									<div className="h-2 w-2 rounded-full bg-neutral-700/80 shrink-0" />
									<div className="h-2.5 w-6 rounded bg-neutral-700/60 shrink-0" />
									<div
										className="h-2.5 rounded bg-neutral-700/50"
										style={{ width: `${60 + (i % 3) * 25}px` }}
									/>
									<div className="h-2 w-8 rounded bg-neutral-800 ml-auto shrink-0" />
								</div>
								{/* Line 2: branch + model + usage */}
								<div className="flex items-center gap-1.5 pl-4">
									<div className="h-2 w-12 rounded bg-neutral-800/70" />
									<div className="h-2 w-14 rounded bg-neutral-800/60" />
									<div className="h-2 w-10 rounded bg-neutral-800/50" />
								</div>
							</div>
						))}
					</div>
				)}

				{hasLoaded && (
					<>
						{/* 0. 📌 Pinned Sessions: fixed on the very top */}
						{grouped.pinnedNodes.length > 0 && (
							<div className="py-1">
								<div
									onClick={() => toggleGroup("__pinned", true)}
									className="group flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 hover:bg-neutral-800/40 text-neutral-300"
								>
									<div className="flex items-center gap-1.5 min-w-0">
										{isGroupOpen("__pinned", true) ? (
											<ChevronDown
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										) : (
											<ChevronRight
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										)}
										<Pin
											size={13}
											className="text-amber-400 fill-amber-400/30 shrink-0"
										/>
										<span className="font-semibold text-[13px] text-neutral-200 truncate">
											已置顶
										</span>
										<span className="rounded-full bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
											{grouped.pinnedNodes.length}
										</span>
										{!isGroupOpen("__pinned", true) &&
											renderBubbleBadges(
												getGroupStatusCounts(grouped.pinnedNodes),
											)}
									</div>
								</div>

								{isGroupOpen("__pinned", true) && (
									<SessionList
										nodes={grouped.pinnedNodes}
										scopeKey="__pinned"
										searching={searching}
										onSetCount={setSectionCount}
										expanded={expandedSections}
										onToggle={toggleSection}
										collapsedSideChats={collapsedSideChats}
										onToggleSideChat={toggleSideChat}
										workspaces={workspaces}
										allVisibleIds={allVisibleIds}
										onRowFocus={focusList}
										onBatchAction={handleBatchAction}
									/>
								)}
							</div>
						)}

						{/* 1. 🌐 Global Workspace (PLAN.md §67): fixed on top, runs in place */}
						{grouped.globalGroup && (
							<div className="py-1">
								<div
									onClick={() => toggleGroup("__global", true)}
									className="group flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 hover:bg-neutral-800/40 text-neutral-300"
								>
									<div className="flex items-center gap-1.5 min-w-0">
										{isGroupOpen("__global", true) ? (
											<ChevronDown
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										) : (
											<ChevronRight
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										)}
										<Globe size={14} className="text-indigo-400 shrink-0" />
										<span
											className="font-semibold text-[13px] text-neutral-200 truncate"
											title={grouped.globalGroup.workspace.path}
										>
											全局工作区
										</span>
										<span className="rounded-full bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
											{grouped.globalGroup.totalCount}
										</span>
										{!isGroupOpen("__global", true) &&
											renderBubbleBadges(
												getGroupStatusCounts(grouped.globalGroup.subgroups),
											)}
									</div>

									<button
										type="button"
										onClick={(e) =>
											handlePlusClick(grouped.globalGroup!.workspace, e)
										}
										title="新建会话"
										disabled={
											creatingWs === grouped.globalGroup.workspace.id
										}
										className="rounded p-1 text-neutral-500 hover:bg-neutral-700/60 hover:text-neutral-200 disabled:opacity-40"
									>
										{creatingWs === grouped.globalGroup.workspace.id ? (
											<Loader2 size={13} className="animate-spin" />
										) : (
											<Plus size={13} />
										)}
									</button>
								</div>

								{isGroupOpen("__global", true) && (
									<div>
										{grouped.globalGroup.totalCount === 0 ? (
											<div className="px-6 py-2 text-[11px] text-neutral-500 italic">
												暂无会话
											</div>
										) : (
											<SessionList
												nodes={grouped.globalGroup.subgroups.flatMap((group) => group.nodes)}
												scopeKey="__global"
												searching={searching}
												onSetCount={setSectionCount}
												expanded={expandedSections}
												onToggle={toggleSection}
												collapsedSideChats={collapsedSideChats}
												onToggleSideChat={toggleSideChat}
												workspaces={workspaces}
												allVisibleIds={allVisibleIds}
												onRowFocus={focusList}
												onBatchAction={handleBatchAction}
											/>
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
									onClick={() => toggleGroup(wg.workspace.id, true)}
									onContextMenu={(e) =>
										handleWorkspaceContextMenu(wg.workspace, e)
									}
									className="group flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 hover:bg-neutral-800/40 text-neutral-300"
								>
									<div className="flex items-center gap-1.5 min-w-0">
										{isGroupOpen(wg.workspace.id, true) ? (
											<ChevronDown
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										) : (
											<ChevronRight
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										)}
										<Folder size={14} className="text-amber-500/80 shrink-0" />
										<span
											className="font-semibold text-[13px] text-neutral-200 truncate"
											title={`${wg.workspace.name} (${wg.workspace.path})`}
										>
											{wg.workspace.name}
										</span>
										<span className="rounded-full bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
											{wg.totalCount}
										</span>
										{!isGroupOpen(wg.workspace.id, true) &&
											renderBubbleBadges(
												getGroupStatusCounts(wg.subgroups),
											)}
									</div>

									<button
										type="button"
										onClick={(e) => handlePlusClick(wg.workspace, e)}
										title="新建会话（选择当前目录或独立 Worktree）"
										disabled={creatingWs === wg.workspace.id}
										className="rounded p-1 text-neutral-500 hover:bg-neutral-700/60 hover:text-neutral-200 disabled:opacity-40"
									>
										{creatingWs === wg.workspace.id ? (
											<Loader2 size={13} className="animate-spin" />
										) : (
											<Plus size={13} />
										)}
									</button>
								</div>

								{/* Workspace Group Body */}
								{isGroupOpen(wg.workspace.id, true) && (
									<div>
										{wg.totalCount === 0 ? (
											<div className="px-6 py-2 text-[11px] text-neutral-500 italic">
												暂无会话
											</div>
										) : wg.hasMultipleSubgroups ? (
											wg.subgroups.map((sub) => (
												<CollapsibleSubgroup
													key={sub.key}
													sub={sub}
													scopeKey={`${wg.workspace.id}|${sub.key}`}
													searching={searching}
													onSetCount={setSectionCount}
													expanded={expandedSections}
													onToggle={toggleSection}
													collapsedSideChats={collapsedSideChats}
													onToggleSideChat={toggleSideChat}
													onBatchArchive={() =>
														batchArchiveSessions(
															sub.label,
															sub.nodes.map((n) => n.session),
														)
													}
													workspaces={workspaces}
													allVisibleIds={allVisibleIds}
													onRowFocus={focusList}
													onBatchAction={handleBatchAction}
													ws={wg.workspace}
													onCreateSession={startSessionAt}
												/>
											))
										) : (
											// Single subgroup: if it has a non-default branch/worktree,
											// render an informative static header instead of hiding it.
											<div>
												{wg.subgroups[0] &&
													wg.subgroups[0].kind !== "default" && (
														<div className="flex items-center gap-1 px-4 py-1 text-[11px] text-neutral-400">
															<FolderGit2
																size={11}
																className="text-neutral-500"
															/>
															<span className="font-mono text-neutral-300 truncate">
																{wg.subgroups[0].label}
															</span>
															{wg.subgroups[0].deleted && (
																<span className="rounded bg-neutral-800 px-1 text-[9px] text-neutral-500">
																	已清理
																</span>
															)}
														</div>
													)}
												<SessionList
													nodes={wg.subgroups[0]?.nodes ?? []}
													scopeKey={`${wg.workspace.id}|default`}
													searching={searching}
													onSetCount={setSectionCount}
													expanded={expandedSections}
													onToggle={toggleSection}
													collapsedSideChats={collapsedSideChats}
													onToggleSideChat={toggleSideChat}
													workspaces={workspaces}
													allVisibleIds={allVisibleIds}
													onRowFocus={focusList}
													onBatchAction={handleBatchAction}
												/>
											</div>
										)}
									</div>
								)}
							</div>
						))}

						{/* 3. Unassigned Bucket (PLAN.md §66 未归档桶): collapsed by default */}
						{grouped.unassigned.length > 0 && (
							<div className="py-1">
								<div
									onClick={() => toggleGroup("__unassigned", false)}
									className="group flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 hover:bg-neutral-800/40 text-neutral-300"
								>
									<div className="flex items-center gap-1.5 min-w-0">
										{isGroupOpen("__unassigned", false) ? (
											<ChevronDown
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										) : (
											<ChevronRight
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										)}
										<Clock size={14} className="text-neutral-400 shrink-0" />
										<span className="font-semibold text-[13px] text-neutral-200 truncate">
											{UNASSIGNED_LABEL}
										</span>
										<span className="rounded-full bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
											{grouped.unassigned.length}
										</span>
										{!isGroupOpen("__unassigned", false) &&
											renderBubbleBadges(
												getGroupStatusCounts(grouped.unassigned),
											)}
									</div>

									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											setAssignAllTarget(
												grouped.unassigned.map((n) => n.session.id),
											);
										}}
										className="rounded p-1 text-neutral-500 opacity-0 hover:bg-neutral-700/60 hover:text-neutral-200 focus:opacity-100 group-hover:opacity-100"
										title="将全部未归档会话归入某个工作区…"
									>
										<FolderInput size={13} />
									</button>
								</div>

								{isGroupOpen("__unassigned", false) && (
									<SessionList
										nodes={grouped.unassigned}
										scopeKey="__unassigned"
										searching={searching}
										onSetCount={setSectionCount}
										expanded={expandedSections}
										onToggle={toggleSection}
										collapsedSideChats={collapsedSideChats}
										onToggleSideChat={toggleSideChat}
										workspaces={workspaces}
										allVisibleIds={allVisibleIds}
										onRowFocus={focusList}
										onBatchAction={handleBatchAction}
									/>
								)}
							</div>
						)}

						{/* 4. Deleted Worktrees Bucket: kept visible (dimmed) instead of vanishing */}
						{grouped.deletedNodes.length > 0 && (
							<div className="py-1 opacity-70">
								<div
									onClick={() => toggleGroup("__deleted", false)}
									className="group flex cursor-pointer select-none items-center justify-between px-2.5 py-1.5 hover:bg-neutral-800/40 text-neutral-300"
								>
									<div className="flex items-center gap-1.5 min-w-0">
										{isGroupOpen("__deleted", false) ? (
											<ChevronDown
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										) : (
											<ChevronRight
												size={13}
												className="text-neutral-500 shrink-0"
											/>
										)}
										<FolderGit2
											size={14}
											className="text-neutral-500 shrink-0"
										/>
										<span className="font-semibold text-[13px] text-neutral-300 truncate">
											{DELETED_LABEL}
										</span>
										<span className="rounded-full bg-neutral-800 px-1.5 py-0.2 text-[10px] text-neutral-400 font-mono">
											{grouped.deletedNodes.length}
										</span>
										{!isGroupOpen("__deleted", false) &&
											renderBubbleBadges(
												getGroupStatusCounts(grouped.deletedNodes),
											)}
									</div>

									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											batchArchiveSessions(
												DELETED_LABEL,
												grouped.deletedNodes.map((n) => n.session),
											);
										}}
										className="mr-1 rounded p-1 text-neutral-500 opacity-0 hover:bg-neutral-700/60 hover:text-amber-300 focus:opacity-100 group-hover:opacity-100"
										title="一键归档全部已清理 Worktree 的会话"
									>
										<Archive size={12} />
									</button>
								</div>

								{isGroupOpen("__deleted", false) && (
									<SessionList
										nodes={grouped.deletedNodes}
										scopeKey="__deleted"
										searching={searching}
										onSetCount={setSectionCount}
										expanded={expandedSections}
										onToggle={toggleSection}
										collapsedSideChats={collapsedSideChats}
										onToggleSideChat={toggleSideChat}
										workspaces={workspaces}
										allVisibleIds={allVisibleIds}
										onRowFocus={focusList}
										onBatchAction={handleBatchAction}
									/>
								)}
							</div>
						)}

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
											点击工作区旁 "+ " 开始探索
										</div>
									</>
								)}
							</div>
						)}
					</>
				)}
			</div>

			{/* Undo bar for recent single-session archive (§交互约定 4) */}
			{undoItem && (
				<div className="flex items-center justify-between border-t border-neutral-800 bg-neutral-950 px-3 py-2 text-xs text-neutral-200">
					<div className="truncate pr-2">
						已归档「
						<span className="text-neutral-100 font-medium">
							{undoItem.title}
						</span>
						」
					</div>
					<button
						type="button"
						onClick={() => undoArchive(undoItem.sessionId)}
						className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-1 text-[11px] text-indigo-300 hover:bg-neutral-700 shrink-0"
					>
						<Undo2 size={12} />
						撤销
					</button>
				</div>
			)}
			{/* Bottom footer: Settings */}
			<div className="flex shrink-0 items-center justify-between border-t border-neutral-800/80 px-3 py-2 bg-neutral-900/50">
				<button
					type="button"
					onClick={() =>
						setCenter(
							centerView === "settings"
								? selectedSessionId
									? "session"
									: "home"
								: "settings",
						)
					}
					className={clsx(
						"flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors",
						centerView === "settings"
							? "bg-neutral-800 text-neutral-100 font-medium"
							: "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
					)}
				>
					<SettingsIcon size={14} />
					<span>设置</span>
				</button>
			</div>


			{/* Popover: "+" New Session Options */}
			{plusMenu && (
				<div
					ref={plusMenuRef}
					style={{
						position: "fixed",
						left: `${plusMenu.x}px`,
						top: `${plusMenu.y}px`,
						zIndex: 60,
					}}
					className="w-48 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-2xl text-neutral-300"
				>
					<div className="px-3 py-1 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider">
						新建会话
					</div>
					<button
						type="button"
						onClick={() => startSessionInDir(plusMenu.ws, false)}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						<Folder size={13} className="text-amber-400" />
						在当前目录创建
					</button>

					{plusMenu.ws.kind !== "global" && (
						<button
							type="button"
							onClick={() => startSessionInDir(plusMenu.ws, true)}
							className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
						>
							<FolderGit2 size={13} className="text-indigo-400" />
							在独立 Worktree 创建
						</button>
					)}
				</div>
			)}

			{/* Context menu: Workspace header */}
			{wsMenu && (
				<div
					ref={wsMenuRef}
					style={{
						position: "fixed",
						left: `${wsMenu.x}px`,
						top: `${wsMenu.y}px`,
						zIndex: 60,
					}}
					className="w-44 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-xs shadow-2xl text-neutral-300"
				>
					<button
						type="button"
						onClick={() => {
							const ws = wsMenu.ws;
							setWsMenu(null);
							openModal("new-session", {
								workspaceId: ws.id,
								cwd: ws.path,
							});
						}}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						<Plus size={13} />
						新建会话…
					</button>

					<button
						type="button"
						onClick={() => handleRevealWorkspace(wsMenu.ws)}
						className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
					>
						<FolderOpen size={13} />
						在访达中打开
					</button>

					{wsMenu.ws.kind !== "global" && (
						<>
							<div className="my-1 border-t border-neutral-800" />
							<button
								type="button"
								onClick={() => handleRemoveWorkspace(wsMenu.ws)}
								className="flex w-full items-center gap-2 px-3 py-1.5 text-rose-400 hover:bg-rose-950/50 hover:text-rose-300 text-left"
							>
								<Trash2 size={13} />
								从工作区中移除
							</button>
						</>
					)}
				</div>
			)}

			{/* Modal: Batch Assign unassigned sessions */}
			{assignAllTarget && (
				<div
					onMouseDown={(e) => {
						if (e.target === e.currentTarget) setAssignAllTarget(null);
					}}
					className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
				>
					<div
						onClick={(e) => e.stopPropagation()}
						className="w-full max-w-sm rounded-lg border border-neutral-700 bg-neutral-900 p-4 text-neutral-200 shadow-2xl"
					>
						<div className="flex items-center justify-between pb-3">
							<span className="font-semibold text-sm">
								将 {assignAllTarget.length} 个会话归入工作区
							</span>
							<button
								type="button"
								onClick={() => setAssignAllTarget(null)}
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
									onClick={() => handleBatchAssign(ws.id)}
									className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-xs hover:bg-neutral-800 text-neutral-200"
								>
									{ws.kind === "global" ? (
										<Globe size={13} className="text-indigo-400 shrink-0" />
									) : (
										<Folder size={13} className="text-amber-400 shrink-0" />
									)}
									<span className="truncate">{ws.name}</span>
								</button>
							))}
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

interface SessionListProps {
	nodes: SessionTreeNode[];
	scopeKey: string;
	searching: boolean;
	expanded: Record<string, number>;
	onToggle: (key: string) => void;
	onSetCount: (key: string, count: number) => void;
	collapsedSideChats: Record<string, boolean>;
	onToggleSideChat: (id: string) => void;
	indent?: number;
	workspaces: Workspace[];
	allVisibleIds?: string[];
	onRowFocus?: () => void;
	onBatchAction?: (action: "archive" | "pin" | "delete", ids: string[]) => void;
}

/**
 * Renders a list of session tree nodes with progressive disclosure (RECENT_LIMIT
 * rows initially, +RECENT_STEP per "show more" click) and hierarchical
 * side-chat folding.
 */
function SessionList({
	nodes,
	scopeKey,
	searching,
	indent = 0,
	expanded,
	onToggle,
	onSetCount,
	collapsedSideChats,
	onToggleSideChat,
	workspaces,
	allVisibleIds,
	onRowFocus,
	onBatchAction,
}: SessionListProps) {
	// Side-chat tree folding: if an ancestor is collapsed, hide this node.
	const visibleBySideChat = useMemo(() => {
		if (searching) return nodes;
		const hiddenRoots = new Set<string>();
		const result: SessionTreeNode[] = [];
		const stack: { id: string; depth: number }[] = [];

		for (const node of nodes) {
			while (
				stack.length > 0 &&
				stack[stack.length - 1].depth >= node.depth
			) {
				stack.pop();
			}
			const parentIsHidden = stack.some((entry) =>
				hiddenRoots.has(entry.id),
			);
			if (!parentIsHidden) {
				result.push(node);
			}
			if (collapsedSideChats[node.session.id]) {
				hiddenRoots.add(node.session.id);
			}
			stack.push({ id: node.session.id, depth: node.depth });
		}
		return result;
	}, [nodes, searching, collapsedSideChats]);

	// Compute which nodes have children in this list
	const childrenMap = useMemo(() => {
		const set = new Set<string>();
		for (const n of nodes) {
			if (n.session.parentId) set.add(n.session.parentId);
		}
		return set;
	}, [nodes]);

	const renderNode = (node: SessionTreeNode) => (
		<SessionRow
			key={node.session.id}
			session={node.session}
			depth={node.depth}
			indent={indent}
			hasChildren={childrenMap.has(node.session.id)}
			childrenCollapsed={Boolean(collapsedSideChats[node.session.id])}
			onToggleChildren={onToggleSideChat}
			workspaces={workspaces}
			allVisibleIds={allVisibleIds}
			onRowFocus={onRowFocus}
			onBatchAction={onBatchAction}
		/>
	);

	if (searching) {
		return <>{visibleBySideChat.map(renderNode)}</>;
	}

	const { recent, older } = partitionNodes(visibleBySideChat);
	const moreKey = `${scopeKey}|more`;
	const olderKey = `${scopeKey}|older`;
	const olderMoreKey = `${scopeKey}|older-more`;

	const recentCount = Math.min(
		Math.max(expanded[moreKey] ?? RECENT_LIMIT, RECENT_LIMIT),
		recent.length,
	);
	const visibleRecent = recent.slice(0, recentCount);

	const showOlder = Boolean(expanded[olderKey]);
	const olderCount = Math.min(
		Math.max(expanded[olderMoreKey] ?? RECENT_LIMIT, RECENT_LIMIT),
		older.length,
	);
	const visibleOlder = older.slice(0, olderCount);

	// Progressive-disclosure footer: "show N more" while items remain, then a
	// collapse row once the section is fully revealed.
	const renderPagingFooter = (
		count: number,
		total: number,
		moreKey: string,
		label: string,
		onCollapse: () => void,
	) => {
		const hidden = total - count;
		if (hidden > 0) {
			const next = Math.min(RECENT_STEP, hidden);
			return (
				<button
					type="button"
					onClick={() => onSetCount(moreKey, count + RECENT_STEP)}
					className="flex w-full items-center gap-1 px-6 py-1 text-[10px] text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
				>
					<ChevronRight size={11} className="shrink-0" />
					再显示 {next} 条（剩余 {hidden} 条{label}）
				</button>
			);
		}
		if (total > RECENT_LIMIT) {
			return (
				<button
					type="button"
					onClick={onCollapse}
					className="flex w-full items-center gap-1 px-6 py-1 text-[10px] text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
				>
					<ChevronDown size={11} className="shrink-0" />
					收起
				</button>
			);
		}
		return null;
	};

	return (
		<>
			{visibleRecent.map(renderNode)}
			{renderPagingFooter(
				recentCount,
				recent.length,
				moreKey,
				"近 7 天的会话",
				() => onSetCount(moreKey, RECENT_LIMIT),
			)}
			{older.length > 0 && (
				<>
					<button
						type="button"
						onClick={() => {
							// Folding the section also resets its paging back to the cap.
							if (showOlder) onSetCount(olderMoreKey, RECENT_LIMIT);
							onToggle(olderKey);
						}}
						className="flex w-full items-center gap-1 px-6 py-1 text-[10px] text-neutral-500 hover:bg-neutral-800/40 hover:text-neutral-300"
					>
						{showOlder ? (
							<ChevronDown size={11} className="shrink-0" />
						) : (
							<ChevronRight size={11} className="shrink-0" />
						)}
						更早的会话 ({older.length})
					</button>
					{showOlder && visibleOlder.map(renderNode)}
					{showOlder &&
						renderPagingFooter(
							olderCount,
							older.length,
							olderMoreKey,
							"更早的会话",
							() => {
								onSetCount(olderMoreKey, RECENT_LIMIT);
								onToggle(olderKey);
							},
						)}
				</>
			)}
		</>
	);
}

interface CollapsibleSubgroupProps {
	sub: BranchSubgroup;
	scopeKey: string;
	searching: boolean;
	expanded: Record<string, number>;
	onToggle: (key: string) => void;
	onSetCount: (key: string, count: number) => void;
	collapsedSideChats: Record<string, boolean>;
	onToggleSideChat: (id: string) => void;
	onBatchArchive: () => void;
	workspaces: Workspace[];
	allVisibleIds?: string[];
	onRowFocus?: () => void;
	onBatchAction?: (action: "archive" | "pin" | "delete", ids: string[]) => void;
	ws: Workspace;
	onCreateSession: (ws: Workspace, cwd: string) => void;
}

/**
 * A worktree/branch subgroup collapsible header.
 */
function CollapsibleSubgroup({
	sub,
	scopeKey,
	searching,
	expanded,
	onToggle,
	onSetCount,
	collapsedSideChats,
	onToggleSideChat,
	onBatchArchive,
	workspaces,
	allVisibleIds,
	onRowFocus,
	onBatchAction,
	ws,
	onCreateSession,
}: CollapsibleSubgroupProps) {
	const open = searching || Boolean(expanded[`${scopeKey}|sub`]);

	return (
		<div className="mt-1">
			<div className="group/sub flex items-center">
				<button
					type="button"
					onClick={() => onToggle(`${scopeKey}|sub`)}
					className="flex min-w-0 flex-1 items-center gap-1 px-4 py-1 text-[11px] font-medium text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-300"
				>
					{open ? (
						<ChevronDown size={11} className="shrink-0 text-neutral-500" />
					) : (
						<ChevronRight size={11} className="shrink-0 text-neutral-500" />
					)}
					{sub.kind === "worktree" ? (
						<FolderGit2 size={11} className="text-neutral-500" />
					) : (
						<Folder size={11} className="text-neutral-500" />
					)}
					<span className="truncate">{sub.label}</span>
					{sub.deleted && (
						<span className="shrink-0 rounded bg-neutral-800 px-1 text-[9px] text-neutral-500">
							已清理
						</span>
					)}
					<span className="font-mono text-neutral-600">({sub.totalCount})</span>
				</button>
				{!sub.deleted && sub.createCwd && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onCreateSession(ws, sub.createCwd!);
						}}
						className="mr-1 shrink-0 rounded p-0.5 text-neutral-600 opacity-0 hover:bg-neutral-700/60 hover:text-neutral-200 focus:opacity-100 group-hover/sub:opacity-100"
						title="在该目录下新建会话"
					>
						<Plus size={11} />
					</button>
				)}
				{sub.deleted && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onBatchArchive();
						}}
						className="mr-2 shrink-0 rounded p-0.5 text-neutral-600 opacity-0 hover:bg-neutral-700/60 hover:text-amber-300 focus:opacity-100 group-hover/sub:opacity-100"
						title="批量归档该组全部会话"
					>
						<Archive size={11} />
					</button>
				)}
			</div>
			{open && (
				<SessionList
					nodes={sub.nodes}
					scopeKey={scopeKey}
					searching={searching}
					indent={14}
					expanded={expanded}
					onToggle={onToggle}
					onSetCount={onSetCount}
					collapsedSideChats={collapsedSideChats}
					onToggleSideChat={onToggleSideChat}
					workspaces={workspaces}
					allVisibleIds={allVisibleIds}
					onRowFocus={onRowFocus}
					onBatchAction={onBatchAction}
				/>
			)}
		</div>
	);
}
