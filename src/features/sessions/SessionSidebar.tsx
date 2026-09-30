import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import {
	AlertCircle,
	Archive,
	Check,
	ChevronDown,
	ChevronRight,
	Clock,
	FoldVertical,
	Folder,
	FolderGit2,
	FolderInput,
	FolderOpen,
	FolderPlus,
	GitBranch,
	Globe,
	Inbox,
	Layers,
	Loader2,
	MessageCircleQuestion,
	Pin,
	Plus,
	Search,
	Settings as SettingsIcon,
	SlidersHorizontal,
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
	UNASSIGNED_LABEL,
	groupSessions,
} from "./grouping";
import { SessionRow } from "./SessionRow";

/** Sessions shown per section before a "show more" row appears. */
const RECENT_LIMIT = 3;
/** Extra sessions revealed per "show more" click — never dumps the whole list. */
const RECENT_STEP = 5;
const COLLAPSED_GROUPS_KEY = "ompws:collapsed-groups";
const ACTIVE_WORKSPACE_KEY = "ompws:active-workspace-id";

function readActiveWorkspaceId(): string {
	try {
		return localStorage.getItem(ACTIVE_WORKSPACE_KEY) || "all";
	} catch {
		return "all";
	}
}

function writeActiveWorkspaceId(id: string) {
	try {
		localStorage.setItem(ACTIVE_WORKSPACE_KEY, id);
	} catch {
		/* ignore */
	}
}


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
export interface WorkspacePalette {
	cardBorder: string;
	folderColor: string;
	spineBorder: string;
	leftAccent: string;
}

export const WORKSPACE_PALETTES: WorkspacePalette[] = [
	{
		cardBorder: "border-sky-500/35 hover:border-sky-500/55 dark:border-sky-500/25 dark:hover:border-sky-500/40",
		folderColor: "text-sky-600 dark:text-sky-400",
		spineBorder: "border-sky-500/30 dark:border-sky-500/30",
		leftAccent: "border-l-[3px] border-l-sky-500",
	},
	{
		cardBorder: "border-emerald-500/35 hover:border-emerald-500/55 dark:border-emerald-500/25 dark:hover:border-emerald-500/40",
		folderColor: "text-emerald-600 dark:text-emerald-400",
		spineBorder: "border-emerald-500/30 dark:border-emerald-500/30",
		leftAccent: "border-l-[3px] border-l-emerald-500",
	},
	{
		cardBorder: "border-amber-500/35 hover:border-amber-500/55 dark:border-amber-500/25 dark:hover:border-amber-500/40",
		folderColor: "text-amber-600 dark:text-amber-400",
		spineBorder: "border-amber-500/30 dark:border-amber-500/30",
		leftAccent: "border-l-[3px] border-l-amber-500",
	},
	{
		cardBorder: "border-purple-500/35 hover:border-purple-500/55 dark:border-purple-500/25 dark:hover:border-purple-500/40",
		folderColor: "text-purple-600 dark:text-purple-400",
		spineBorder: "border-purple-500/30 dark:border-purple-500/30",
		leftAccent: "border-l-[3px] border-l-purple-500",
	},
	{
		cardBorder: "border-rose-500/35 hover:border-rose-500/55 dark:border-rose-500/25 dark:hover:border-rose-500/40",
		folderColor: "text-rose-600 dark:text-rose-400",
		spineBorder: "border-rose-500/30 dark:border-rose-500/30",
		leftAccent: "border-l-[3px] border-l-rose-500",
	},
	{
		cardBorder: "border-teal-500/35 hover:border-teal-500/55 dark:border-teal-500/25 dark:hover:border-teal-500/40",
		folderColor: "text-teal-600 dark:text-teal-400",
		spineBorder: "border-teal-500/30 dark:border-teal-500/30",
		leftAccent: "border-l-[3px] border-l-teal-500",
	},
];

export function getWorkspacePalette(idOrName: string): WorkspacePalette {
	if (idOrName === "__global") {
		return {
			cardBorder: "border-indigo-500/35 hover:border-indigo-500/55 dark:border-indigo-500/25 dark:hover:border-indigo-500/40",
			folderColor: "text-indigo-600 dark:text-indigo-400",
			spineBorder: "border-indigo-500/30 dark:border-indigo-500/30",
			leftAccent: "border-l-[3px] border-l-indigo-500",
		};
	}
	let hash = 0;
	for (let i = 0; i < idOrName.length; i++) {
		hash = (hash << 5) - hash + idOrName.charCodeAt(i);
		hash |= 0;
	}
	const idx = Math.abs(hash) % WORKSPACE_PALETTES.length;
	return WORKSPACE_PALETTES[idx];
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
	// Default to false: sessions on deleted worktrees do not clutter the sidebar by default (PLAN.md §66)
	const [showDeletedWt, setShowDeletedWt] = useState(false);
	// Group open states (explicit user toggles). Defaults:
	// - project/global workspaces: open
	// - unassigned bucket: collapsed
	// - deleted worktree bucket: collapsed
	const [groupOpen, setGroupOpen] = useState<Record<string, boolean>>(() =>
		readCollapsedGroups(),
	);

	// Per-section disclosure state, keyed per subgroup:
	// - `…|more` stores how many top-level session blocks are visible (default RECENT_LIMIT)
	// - `…|older` / `…|sub` are 0/1 open flags
	const [expandedSections, setExpandedSections] = useState<
		Record<string, number>
	>({});
	const toggleSection = (key: string) =>
		setExpandedSections((prev) => ({ ...prev, [key]: prev[key] ? 0 : 1 }));
	const setSectionCount = (key: string, count: number) =>
		setExpandedSections((prev) => ({ ...prev, [key]: count }));

	const searching = searchQuery.trim().length > 0;

	// In-flight workspace creation indicator
	const [creatingWs, setCreatingWs] = useState<string | null>(null);

	// Visible error message banner
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// Active workspace selection ("all", "__global", or workspace.id)
	const [activeWorkspaceId, setActiveWorkspaceIdState] = useState<string>(() =>
		readActiveWorkspaceId(),
	);
	const setActiveWorkspaceId = (id: string) => {
		setActiveWorkspaceIdState(id);
		writeActiveWorkspaceId(id);
	};

	const [wsDropdownOpen, setWsDropdownOpen] = useState(false);
	const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);

	// Popover menus: "+" button and workspace header right-click
	const [plusMenu, setPlusMenu] = useState<PlusMenuState | null>(null);
	const [wsMenu, setWsMenu] = useState<WsMenuState | null>(null);
	const [assignAllTarget, setAssignAllTarget] = useState<string[] | null>(null);

	const scrollRef = useRef<HTMLDivElement>(null);
	const plusMenuRef = useRef<HTMLDivElement>(null);
	const wsMenuRef = useRef<HTMLDivElement>(null);
	const wsDropdownRef = useRef<HTMLDivElement>(null);
	const filterPopoverRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const focusList = () => scrollRef.current?.focus();

	const globalWs = useMemo(
		() => workspaces.find((w) => w.kind === "global") ?? null,
		[workspaces],
	);
	const projectWorkspaces = useMemo(
		() =>
			workspaces
				.filter((w) => w.kind !== "global")
				.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
		[workspaces],
	);

	const activeWs = useMemo(() => {
		if (activeWorkspaceId === "__global") return globalWs;
		if (activeWorkspaceId === "all") return null;
		return workspaces.find((w) => w.id === activeWorkspaceId) ?? null;
	}, [workspaces, activeWorkspaceId, globalWs]);

	const sessionCountsByWs = useMemo(() => {
		const map = new Map<string, number>();
		for (const s of Object.values(sessions)) {
			if (!s.archived && s.workspaceId) {
				map.set(s.workspaceId, (map.get(s.workspaceId) ?? 0) + 1);
			}
		}
		return map;
	}, [sessions]);

	// Fallback to "all" if active workspace was deleted
	useEffect(() => {
		if (
			hasLoaded &&
			activeWorkspaceId !== "all" &&
			activeWorkspaceId !== "__global" &&
			!workspaces.some((w) => w.id === activeWorkspaceId)
		) {
			setActiveWorkspaceId("all");
		}
	}, [hasLoaded, workspaces, activeWorkspaceId]);

	// Auto-follow active session's workspace when selection changes
	const prevSelectedIdRef = useRef<string | null>(selectedSessionId);
	useEffect(() => {
		if (selectedSessionId && selectedSessionId !== prevSelectedIdRef.current) {
			prevSelectedIdRef.current = selectedSessionId;
			const current = sessions[selectedSessionId];
			if (
				current?.workspaceId &&
				activeWorkspaceId !== "all" &&
				current.workspaceId !== activeWorkspaceId
			) {
				setActiveWorkspaceId(current.workspaceId);
			}
		} else {
			prevSelectedIdRef.current = selectedSessionId;
		}
	}, [selectedSessionId, sessions, activeWorkspaceId]);

	// Close context/popover menus on outside click
	useEffect(() => {
		if (!plusMenu && !wsMenu && !wsDropdownOpen && !filterPopoverOpen) return;
		const onDown = (e: MouseEvent) => {
			const target = e.target as Node;
			if (plusMenuRef.current && !plusMenuRef.current.contains(target)) {
				setPlusMenu(null);
			}
			if (wsMenuRef.current && !wsMenuRef.current.contains(target)) {
				setWsMenu(null);
			}
			if (wsDropdownRef.current && !wsDropdownRef.current.contains(target)) {
				setWsDropdownOpen(false);
			}
			if (filterPopoverRef.current && !filterPopoverRef.current.contains(target)) {
				setFilterPopoverOpen(false);
			}
		};
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [plusMenu, wsMenu, wsDropdownOpen, filterPopoverOpen]);

	useEscapeKey(() => {
		if (wsDropdownOpen) {
			setWsDropdownOpen(false);
			return;
		}
		if (filterPopoverOpen) {
			setFilterPopoverOpen(false);
			return;
		}
		if (plusMenu) {
			setPlusMenu(null);
			return;
		}
		if (wsMenu) {
			setWsMenu(null);
			return;
		}
		if (assignAllTarget) {
			setAssignAllTarget(null);
			return;
		}
	}, Boolean(wsDropdownOpen || filterPopoverOpen || plusMenu || wsMenu || assignAllTarget));

	// Compute grouped tree
	const grouped = useMemo(() => {
		return groupSessions(sessions, workspaces, {
			searchQuery,
			showArchived,
			showDeletedWorktrees: showDeletedWt,
			activeWorkspaceId,
		});
	}, [sessions, workspaces, searchQuery, showArchived, showDeletedWt, activeWorkspaceId]);

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
		if (grouped.pinnedSessions.length > 0 && isGroupOpen("__pinned", true)) {
			list.push(...grouped.pinnedSessions.map((s) => s.id));
		}
		if (
			grouped.globalGroup &&
			(activeWorkspaceId === "__global" || isGroupOpen("__global", true))
		) {
			for (const sg of grouped.globalGroup.subgroups) {
				list.push(...sg.sessions.map((s) => s.id));
			}
		}
		for (const wg of grouped.workspaceGroups) {
			if (activeWorkspaceId !== "all" || isGroupOpen(wg.workspace.id, true)) {
				for (const sg of wg.subgroups) {
					list.push(...sg.sessions.map((s) => s.id));
				}
			}
		}
		if (isGroupOpen("__unassigned", false)) {
			list.push(...grouped.unassigned.map((s) => s.id));
		}
		if (isGroupOpen("__deleted", false)) {
			list.push(...grouped.deletedSessions.map((s) => s.id));
		}
		return Array.from(new Set(list));
	}, [grouped, groupOpen, searching, activeWorkspaceId]);

	const allGroupIds = useMemo(() => {
		const ids: string[] = [];
		if (grouped.pinnedSessions.length > 0) ids.push("__pinned");
		if (grouped.globalGroup) ids.push("__global");
		for (const wg of grouped.workspaceGroups) ids.push(wg.workspace.id);
		ids.push("__unassigned");
		if (grouped.deletedSessions.length > 0) ids.push("__deleted");
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

	interface GroupStatusCounts {
		working: number;
		awaiting: number;
		review: number;
		error: number;
	}

	const getGroupStatusCounts = (
		sessions: SessionMeta[] | BranchSubgroup[],
	): GroupStatusCounts => {
		let working = 0;
		let awaiting = 0;
		let review = 0;
		let error = 0;
		const check = (s: SessionMeta) => {
			if (s.status === "working") working++;
			else if (s.status === "awaiting_approval" || s.status === "awaiting_answer") awaiting++;
			else if (s.status === "review") review++;
			else if (s.status === "error") error++;
		};
		for (const item of sessions) {
			if ("sessions" in item) {
				for (const s of item.sessions) check(s);
			} else {
				check(item);
			}
		}
		return { working, awaiting, review, error };
	};

	const renderBubbleBadges = (counts: GroupStatusCounts) => {
		if (
			counts.working === 0 &&
			counts.awaiting === 0 &&
			counts.review === 0 &&
			counts.error === 0
		)
			return null;
		// Capsule with colored number only — the tiny dot inside is dropped so
		// the badge stays compact; color still carries the meaning.
		const badge = (n: number, cls: string, tip: string) => (
			<span
				key={tip}
				className={`rounded-full px-1.5 py-0.5 text-[9.5px] font-mono font-bold border ${cls}`}
				title={tip}
			>
				{n}
			</span>
		);
		return (
			<div className="flex items-center gap-1 ml-auto shrink-0 mr-1">
				{counts.working > 0 &&
					badge(counts.working, "bg-[var(--bg-hover)] text-[var(--text-muted)] border-[var(--border)]", `${counts.working} 个运行中会话`)}
				{counts.awaiting > 0 &&
					badge(counts.awaiting, "bg-sky-500/15 dark:bg-sky-500/25 text-sky-600 dark:text-sky-300 border-sky-500/40", `${counts.awaiting} 个待审批或回复`)}
				{counts.review > 0 &&
					badge(counts.review, "bg-emerald-500/15 dark:bg-emerald-500/25 text-emerald-600 dark:text-emerald-300 border-emerald-500/35", `${counts.review} 个待验收`)}
				{counts.error > 0 &&
					badge(counts.error, "bg-rose-500/15 dark:bg-rose-500/25 text-rose-600 dark:text-rose-300 border-rose-500/35", `${counts.error} 个异常会话`)}
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
				if (selectedSessionId && ids.includes(selectedSessionId)) {
					selectSession(null);
				}
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
				const ws = await addWorkspace(selectedPath);
				await loadSessions();
				if (ws?.id) {
					setActiveWorkspaceId(ws.id);
				}
				toast.success("已添加工作区");
			}
		} catch (err) {
			toast.error(`添加工作区失败: ${errMsg(err)}`);
		}
	};

	const handleHeaderNewSession = (e?: React.MouseEvent) => {
		if (activeWorkspaceId === "__global") {
			if (globalWs) void startSessionInDir(globalWs, false);
			return;
		}
		if (activeWs) {
			if (e) {
				handlePlusClick(activeWs, e);
			} else {
				void startSessionInDir(activeWs, false);
			}
			return;
		}
		if (projectWorkspaces.length === 1 && projectWorkspaces[0]) {
			if (e) {
				handlePlusClick(projectWorkspaces[0], e);
			} else {
				void startSessionInDir(projectWorkspaces[0], false);
			}
			return;
		}
		openModal("new-session");
	};

	useEffect(() => {
		const onGlobalKeyDown = (e: KeyboardEvent) => {
			if (isComposing(e)) return;
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
				const target = e.target as HTMLElement | null;
				if (
					target &&
					(target.tagName === "INPUT" ||
						target.tagName === "TEXTAREA" ||
						target.isContentEditable)
				) {
					return;
				}
				e.preventDefault();
				handleHeaderNewSession();
			} else if (
				(e.metaKey || e.ctrlKey) &&
				e.shiftKey &&
				e.key.toLowerCase() === "k"
			) {
				e.preventDefault();
				openModal("quick-ask");
			}
		};
		window.addEventListener("keydown", onGlobalKeyDown);
		return () => window.removeEventListener("keydown", onGlobalKeyDown);
	}, [activeWorkspaceId, activeWs, globalWs, projectWorkspaces, openModal]);

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
			if (activeWorkspaceId === ws.id) {
				setActiveWorkspaceId("all");
			}
			toast.success(`已移除工作区「${ws.name}」`);
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
				// Collapse the group it belongs to
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
			className="flex h-full flex-col bg-transparent text-neutral-300 text-xs select-none"
		>
			{/* Top Bar: Workspace Switcher Card + Search & Filters */}
			<div className="relative border-b border-[var(--border-divider)] bg-transparent p-2">
				<div className="flex items-center gap-1.5">
					<button
						type="button"
						onClick={() => {
							setWsDropdownOpen((v) => !v);
							setFilterPopoverOpen(false);
						}}
						className="group flex min-w-0 flex-1 items-center justify-between rounded-lg hairline bg-[var(--bg-active-fill)] px-2.5 py-1.5 text-left transition-all hover:bg-[var(--bg-hover)] active:scale-[0.99]"
						title="点击切换或管理工作区"
					>
						<div className="flex min-w-0 items-center gap-2">
							<div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[var(--bg-active-fill)] text-neutral-300">
								{activeWorkspaceId === "__global" ? (
									<Globe size={13} className="text-indigo-400" />
								) : activeWs ? (
									<Folder size={13} className="text-amber-400/90" />
								) : (
									<Layers size={13} className="text-neutral-400" />
								)}
							</div>
							<span className="truncate text-xs font-semibold text-neutral-200 group-hover:text-neutral-100">
								{activeWorkspaceId === "__global"
									? "全局工作区"
									: activeWs
										? activeWs.name
										: "全部工作区"}
							</span>
						</div>
						<ChevronDown
							size={13}
							className={clsx(
								"shrink-0 text-neutral-500 transition-transform",
								wsDropdownOpen && "rotate-180 text-neutral-300",
							)}
						/>
					</button>

					{/* Quick New Session Button */}
					<button
						type="button"
						onClick={handleHeaderNewSession}
						title={
							activeWs
								? `在「${activeWs.name}」新建会话 (Cmd+N)`
								: "新建会话 (Cmd+N)"
						}
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hairline bg-[var(--bg-active-fill)] text-neutral-300 shadow-sm transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95"
					>
						<Plus size={14} />
					</button>

					{/* Quick Ask Button */}
					<button
						type="button"
						onClick={() => openModal("quick-ask")}
						title="快速提问 (Cmd+Shift+K)"
						className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg hairline bg-[var(--bg-active-fill)] text-neutral-300 shadow-sm transition-all hover:bg-[var(--bg-hover)] hover:text-neutral-100 active:scale-95"
					>
						<MessageCircleQuestion size={14} />
					</button>
				</div>

				{/* Search & Filter Bar */}
				<div className="mt-1.5 flex items-center gap-1.5">
					<div className="relative flex min-w-0 flex-1 items-center">
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
							placeholder="搜索会话、分支... (Cmd+F)"
							className="w-full rounded-lg hairline bg-[var(--well-bg)] py-1.5 pl-8 pr-7 text-xs text-neutral-200 placeholder:text-neutral-500/70 transition-colors focus:ring-1 focus:ring-[#0A84FF]/50 focus:outline-none"
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

					{/* Filter & View Options Button */}
					<button
						type="button"
						onClick={() => {
							setFilterPopoverOpen((v) => !v);
							setWsDropdownOpen(false);
						}}
						className={clsx(
							"relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-all active:scale-95",
							showArchived || showDeletedWt
								? "border-amber-500/40 bg-amber-500/15 text-amber-300"
								: "hairline bg-[var(--well-bg)] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
						)}
						title="过滤与显示设置"
					>
						<SlidersHorizontal size={13} />
						{(showArchived || showDeletedWt) && (
							<span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
						)}
					</button>
				</div>

				{/* Workspace Switcher Dropdown */}
				{wsDropdownOpen && (
					<div
						ref={wsDropdownRef}
						className="absolute left-2 right-2 top-10 z-50 rounded-xl vibrancy-popover shadow-apple-modal hairline p-1.5 text-xs text-neutral-300 animate-in fade-in zoom-in-95 duration-100"
					>
						<div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
							工作区切换
						</div>

						{/* All Workspaces */}
						<button
							type="button"
							onClick={() => {
								setActiveWorkspaceId("all");
								setWsDropdownOpen(false);
							}}
							className={clsx(
								"flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors",
								activeWorkspaceId === "all"
									? "bg-[var(--bg-hover)] font-medium text-[var(--text)]"
									: "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]/60 hover:text-[var(--text)]",
							)}
						>
							<div className="flex items-center gap-2">
								<Layers size={13} className="text-neutral-400" />
								<span>全部工作区</span>
							</div>
							{activeWorkspaceId === "all" && (
								<Check size={13} className="text-indigo-400" />
							)}
						</button>

						{/* Global Workspace */}
						{globalWs && (
							<button
								type="button"
								onClick={() => {
									setActiveWorkspaceId("__global");
									setWsDropdownOpen(false);
								}}
								className={clsx(
									"flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors",
									activeWorkspaceId === "__global"
										? "bg-[var(--bg-hover)] font-medium text-[var(--text)]"
										: "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]/60 hover:text-[var(--text)]",
								)}
							>
								<div className="flex items-center gap-2">
									<Globe size={13} className="text-indigo-400" />
									<span>全局工作区</span>
								</div>
								{activeWorkspaceId === "__global" && (
									<Check size={13} className="text-indigo-400" />
								)}
							</button>
						)}

						{projectWorkspaces.length > 0 && (
							<div className="my-1 border-t border-neutral-800/80" />
						)}

						{/* Project Workspaces List */}
						<div className="max-h-56 overflow-y-auto space-y-0.5">
							{projectWorkspaces.map((ws) => {
								const isSelected = activeWorkspaceId === ws.id;
								const count = sessionCountsByWs.get(ws.id) ?? 0;
								return (
									<div
										key={ws.id}
										className={clsx(
											"group flex items-center justify-between rounded-md px-2 py-1.5 transition-colors",
											isSelected
												? "bg-[var(--bg-hover)] font-medium text-[var(--text)]"
												: "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]/60 hover:text-[var(--text)]",
										)}
									>
										<button
											type="button"
											onClick={() => {
												setActiveWorkspaceId(ws.id);
												setWsDropdownOpen(false);
											}}
											className="flex min-w-0 flex-1 items-center gap-2 text-left"
										>
											<Folder
												size={13}
												className="shrink-0 text-amber-400/90"
											/>
											<span
												className="truncate"
												title={`${ws.name} (${ws.path})`}
											>
												{ws.name}
											</span>
											<span className="rounded-full bg-neutral-800/80 px-1.5 py-0.2 text-[10px] font-mono text-neutral-400">
												{count}
											</span>
										</button>

										<div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													handleRevealWorkspace(ws);
												}}
												title="在访达中打开"
												className="rounded p-1 text-neutral-400 hover:bg-neutral-700/60 hover:text-neutral-200"
											>
												<FolderOpen size={12} />
											</button>
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													handleRemoveWorkspace(ws);
												}}
												title="移除工作区"
												className="rounded p-1 text-rose-400 hover:bg-rose-950/60 hover:text-rose-300"
											>
												<Trash2 size={12} />
											</button>
										</div>

										{isSelected && (
											<Check
												size={13}
												className="ml-1 shrink-0 text-indigo-400"
											/>
										)}
									</div>
								);
							})}
						</div>

						<div className="my-1 border-t border-neutral-800/80" />

						{/* Add Workspace Action */}
						<button
							type="button"
							onClick={() => {
								setWsDropdownOpen(false);
								handleAddWorkspace();
							}}
							className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-indigo-400 transition-colors hover:bg-indigo-950/40 hover:text-indigo-300"
						>
							<FolderPlus size={13} />
							<span>添加项目目录…</span>
						</button>
					</div>
				)}

				{/* Filter Popover */}
				{filterPopoverOpen && (
					<div
						ref={filterPopoverRef}
						className="absolute right-2 top-20 z-50 w-56 rounded-xl vibrancy-popover shadow-apple-modal hairline p-2 text-xs text-neutral-300 animate-in fade-in zoom-in-95 duration-100"
					>
						<div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
							显示与过滤
						</div>
						<button
							type="button"
							onClick={() => setShowArchived((v) => !v)}
							className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition-colors hover:bg-neutral-800"
						>
							<div className="flex items-center gap-2">
								<Archive size={13} className="text-amber-400" />
								<span>显示已归档会话</span>
							</div>
							{showArchived && <Check size={13} className="text-indigo-400" />}
						</button>
						<button
							type="button"
							onClick={() => setShowDeletedWt((v) => !v)}
							className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition-colors hover:bg-neutral-800"
						>
							<div className="flex items-center gap-2">
								<FolderGit2 size={13} className="text-neutral-400" />
								<span>显示已清理 Worktree</span>
							</div>
							{showDeletedWt && <Check size={13} className="text-indigo-400" />}
						</button>
						<div className="my-1 border-t border-neutral-800" />
						<button
							type="button"
							onClick={() => {
								handleToggleAllGroups();
								setFilterPopoverOpen(false);
							}}
							className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
						>
							{areAllCollapsed ? (
								<>
									<UnfoldVertical size={13} />
									<span>全部展开</span>
								</>
							) : (
								<>
									<FoldVertical size={13} />
									<span>全部折叠</span>
								</>
							)}
						</button>
					</div>
				)}
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
						{grouped.pinnedSessions.length > 0 && (
							<div className="mt-0.5">
								<div
									onClick={() => toggleGroup("__pinned", true)}
								className="group flex cursor-pointer select-none items-center justify-between mx-1 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text)] transition-colors"
								>
									<div className="flex items-center gap-1.5 min-w-0 flex-1">
										{isGroupOpen("__pinned", true) ? (
											<ChevronDown
												size={13}
												className="text-[var(--text-dim)] shrink-0"
											/>
										) : (
											<ChevronRight
												size={13}
												className="text-[var(--text-dim)] shrink-0"
											/>
										)}
										<Pin
											size={13}
											className="text-amber-500 dark:text-amber-400 fill-amber-500/30 shrink-0"
										/>
									<span className="font-bold text-[12.5px] text-[var(--text)] truncate">
											已置顶
										</span>
										{renderBubbleBadges(
											getGroupStatusCounts(grouped.pinnedSessions),
										)}
									</div>
								</div>

								{isGroupOpen("__pinned", true) && (
									<div className="pb-1">
										<SessionList
											sessions={grouped.pinnedSessions}
											scopeKey="__pinned"
											searching={searching}
											onSetCount={setSectionCount}
											expanded={expandedSections}
											workspaces={workspaces}
											allVisibleIds={allVisibleIds}
											onRowFocus={focusList}
											onBatchAction={handleBatchAction}
										/>
									</div>
								)}
							</div>
						)}
						{/* Single Workspace Mode: focused, calm view */}
						{activeWorkspaceId !== "all" && (
							<div className="py-1">
								{activeWorkspaceId === "__global" ? (
									grouped.globalGroup && grouped.globalGroup.totalCount > 0 ? (
										<SessionList
											sessions={grouped.globalGroup.subgroups.flatMap(
												(group) => group.sessions,
											)}
											scopeKey="__global"
											searching={searching}
											onSetCount={setSectionCount}
											expanded={expandedSections}
											workspaces={workspaces}
											allVisibleIds={allVisibleIds}
											onRowFocus={focusList}
											onBatchAction={handleBatchAction}
										/>
									) : (
										!searchQuery && (
											<div className="flex flex-col items-center justify-center p-8 text-center text-neutral-500">
												<div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-800/80 text-indigo-400">
													<Globe size={18} />
												</div>
												<div className="text-xs font-medium text-neutral-200">
													暂无全局会话
												</div>
												<div className="mt-1 text-[11px] text-neutral-500">
													在此全局空间开启探索会话
												</div>
												<button
													type="button"
													onClick={() =>
														globalWs && startSessionInDir(globalWs, false)
													}
													className="mt-4 flex items-center gap-1.5 rounded-md border border-neutral-700/60 bg-neutral-800/90 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700/80 transition-colors shadow-sm"
												>
													<Plus size={13} />
													新建会话
													<span className="ml-0.5 text-[10px] text-neutral-400 font-mono">
														⌘N
													</span>
												</button>
											</div>
										)
									)
								) : activeWs && grouped.workspaceGroups[0] ? (
									grouped.workspaceGroups[0].totalCount > 0 ? (
										// Semantics: every worktree/branch subgroup renders as CollapsibleSubgroup even when it is the only subgroup; bare default rows render with SessionList.
										grouped.workspaceGroups[0].hasMultipleSubgroups ||
										(grouped.workspaceGroups[0].subgroups[0] &&
											grouped.workspaceGroups[0].subgroups[0].kind !== "default") ? (
											grouped.workspaceGroups[0].subgroups.map((sub) => (
												<CollapsibleSubgroup
													key={sub.key}
													sub={sub}
													scopeKey={`${activeWs.id}|${sub.key}`}
													searching={searching}
													onSetCount={setSectionCount}
													expanded={expandedSections}
													onToggle={toggleSection}
													onBatchArchive={() =>
														batchArchiveSessions(
															sub.label,
														sub.sessions,
														)
													}
													workspaces={workspaces}
													allVisibleIds={allVisibleIds}
													onRowFocus={focusList}
													onBatchAction={handleBatchAction}
													ws={activeWs}
													onCreateSession={startSessionAt}
												/>
											))
										) : (
											<SessionList
											sessions={
												grouped.workspaceGroups[0].subgroups[0]?.sessions ?? []
											}
												scopeKey={`${activeWs.id}|default`}
												searching={searching}
												onSetCount={setSectionCount}
												expanded={expandedSections}
												workspaces={workspaces}
												allVisibleIds={allVisibleIds}
												onRowFocus={focusList}
												onBatchAction={handleBatchAction}
											/>
										)
									) : (
										!searchQuery && (
											<div className="flex flex-col items-center justify-center p-8 text-center text-neutral-500">
												<div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-neutral-800/80 text-amber-400">
													<Folder size={18} />
												</div>
												<div className="text-xs font-medium text-neutral-200">
													暂无会话
												</div>
												<div className="mt-1 text-[11px] text-neutral-500">
													为此工作区创建第一个代码或任务会话
												</div>
												<button
													type="button"
													onClick={() => startSessionInDir(activeWs, false)}
													className="mt-4 flex items-center gap-1.5 rounded-md border border-neutral-700/60 bg-neutral-800/90 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700/80 transition-colors shadow-sm"
												>
													<Plus size={13} />
													新建会话
													<span className="ml-0.5 text-[10px] text-neutral-400 font-mono">
														⌘N
													</span>
												</button>
											</div>
										)
									)
								) : null}
							</div>
						)}

						{/* All Workspaces Mode: multi-project overview */}
						{activeWorkspaceId === "all" && (
							<>
								{/* 1. Global Workspace */}
								{grouped.globalGroup && (() => {
									const palette = getWorkspacePalette("__global");
									const isOpen = isGroupOpen("__global", true);
									const statusCounts = getGroupStatusCounts(
										grouped.globalGroup.subgroups,
									);
									return (
										<div className="mt-0.5">
											<div
												onClick={() => toggleGroup("__global", true)}
											className="group flex cursor-pointer select-none items-center justify-between mx-1 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text)] transition-colors"
											>
												<div className="flex items-center gap-1.5 min-w-0 flex-1">
													{isOpen ? (
														<ChevronDown
															size={13}
															className="text-[var(--text-dim)] shrink-0"
														/>
													) : (
														<ChevronRight
															size={13}
															className="text-[var(--text-dim)] shrink-0"
														/>
													)}
													<Globe
														size={14}
														className={clsx("shrink-0", palette.folderColor)}
													/>
													<span
													className="font-bold text-[12.5px] text-[var(--text)] truncate"
														title={grouped.globalGroup.workspace.path}
													>
														全局工作区
													</span>
													{renderBubbleBadges(statusCounts)}
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
													className="rounded p-1 text-[var(--text-dim)] opacity-50 hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] disabled:opacity-40 shrink-0 transition-all duration-150 ease-out focus:opacity-100"
												>
													{creatingWs === grouped.globalGroup.workspace.id ? (
														<Loader2 size={13} className="animate-spin" />
													) : (
														<Plus size={13} />
													)}
												</button>
											</div>

											{isOpen && (
												<div className="pb-1">
													{grouped.globalGroup.totalCount === 0 ? (
														<div className="px-6 py-2 text-[11px] text-[var(--text-dim)] italic">
															暂无会话
														</div>
													) : (
														<SessionList
															sessions={grouped.globalGroup.subgroups[0]?.sessions ?? []}
															scopeKey="__global"
															searching={searching}
															onSetCount={setSectionCount}
															expanded={expandedSections}
															workspaces={workspaces}
															allVisibleIds={allVisibleIds}
															onRowFocus={focusList}
															onBatchAction={handleBatchAction}
														/>
													)}
												</div>
											)}
										</div>
									);
								})()}

								{/* 2. Registered Project Workspaces */}
								{grouped.workspaceGroups.map((wg) => {
									const palette = getWorkspacePalette(wg.workspace.id || wg.workspace.name);
									const isOpen = isGroupOpen(wg.workspace.id, true);
									const statusCounts = getGroupStatusCounts(wg.subgroups);
									return (
										<div key={wg.workspace.id} className="mt-0.5">
											{/* Workspace Group Header (Codex unified style) */}
											<div
												onClick={() => toggleGroup(wg.workspace.id, true)}
												onContextMenu={(e) =>
													handleWorkspaceContextMenu(wg.workspace, e)
												}
											className="group flex cursor-pointer select-none items-center justify-between mx-1 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text)] transition-colors"
											>
												<div className="flex items-center gap-1.5 min-w-0 flex-1">
													{isOpen ? (
														<ChevronDown
															size={13}
															className="text-[var(--text-dim)] shrink-0"
														/>
													) : (
														<ChevronRight
															size={13}
															className="text-[var(--text-dim)] shrink-0"
														/>
													)}
													{isOpen ? (
														<FolderOpen
															size={14}
															className={clsx("shrink-0", palette.folderColor)}
														/>
													) : (
														<Folder
															size={14}
															className={clsx("shrink-0", palette.folderColor)}
														/>
													)}
													<span
													className="font-bold text-[12.5px] text-[var(--text)] truncate"
														title={`${wg.workspace.name} (${wg.workspace.path})`}
													>
														{wg.workspace.name}
													</span>
													{renderBubbleBadges(statusCounts)}
												</div>

												<button
													type="button"
													onClick={(e) => handlePlusClick(wg.workspace, e)}
													title="新建会话（选择当前目录或独立 Worktree）"
													disabled={creatingWs === wg.workspace.id}
													className="rounded p-1 text-[var(--text-dim)] opacity-50 hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] disabled:opacity-40 shrink-0 transition-all duration-150 ease-out focus:opacity-100"
												>
													{creatingWs === wg.workspace.id ? (
														<Loader2 size={13} className="animate-spin" />
													) : (
														<Plus size={13} />
													)}
												</button>
											</div>

											{/* Workspace Group Body */}
											{isOpen && (
												<div className="pb-1">
													{wg.totalCount === 0 ? (
														<div className="px-6 py-2 text-[11px] text-[var(--text-dim)] italic">
															暂无会话
														</div>
													) : wg.hasMultipleSubgroups ||
													  (wg.subgroups[0] &&
															wg.subgroups[0].kind !== "default") ? (
														wg.subgroups.map((sub) => (
														<CollapsibleSubgroup
															key={sub.key}
															sub={sub}
															scopeKey={`${wg.workspace.id}|${sub.key}`}
															searching={searching}
															onSetCount={setSectionCount}
															expanded={expandedSections}
															onToggle={toggleSection}
															onBatchArchive={() =>
																batchArchiveSessions(
																	sub.label,
																sub.sessions,
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
														<div className="ml-[22px] pl-2 my-0.5">
															<SessionList
																sessions={wg.subgroups[0]?.sessions ?? []}
																scopeKey={`${wg.workspace.id}|default`}
																searching={searching}
																onSetCount={setSectionCount}
																expanded={expandedSections}
																workspaces={workspaces}
																allVisibleIds={allVisibleIds}
																onRowFocus={focusList}
																withSpine
															/>
														</div>
													)}
												</div>
											)}
										</div>
									);
								})}

								{/* 3. Unassigned Bucket (PLAN.md §66 未归档桶): collapsed by default */}
								{grouped.unassigned.length > 0 && (
									<div className="mt-0.5">
										<div
											onClick={() => toggleGroup("__unassigned", false)}
											className="group flex cursor-pointer select-none items-center justify-between mx-1 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text)] transition-colors"
										>
											<div className="flex items-center gap-1.5 min-w-0 flex-1">
												{isGroupOpen("__unassigned", false) ? (
													<ChevronDown
														size={13}
														className="text-[var(--text-dim)] shrink-0"
													/>
												) : (
													<ChevronRight
														size={13}
														className="text-[var(--text-dim)] shrink-0"
													/>
												)}
												<Clock size={14} className="text-[var(--text-dim)] shrink-0" />
												<span className="font-bold text-[12.5px] text-[var(--text)] truncate">
													{UNASSIGNED_LABEL}
												</span>
												{renderBubbleBadges(
													getGroupStatusCounts(grouped.unassigned),
												)}
											</div>

											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													setAssignAllTarget(
														grouped.unassigned.map((s) => s.id),
													);
												}}
												className="rounded p-1 text-neutral-500 opacity-50 hover:opacity-100 hover:bg-neutral-700/60 hover:text-neutral-200 focus:opacity-100 ml-1 shrink-0 transition-opacity"
												title="将全部未归档会话归入某个工作区…"
											>
												<FolderInput size={13} />
											</button>
										</div>

										{isGroupOpen("__unassigned", false) && (
											<div className="pb-1">
												<SessionList
													sessions={grouped.unassigned}
													scopeKey="__unassigned"
													searching={searching}
													onSetCount={setSectionCount}
													expanded={expandedSections}
													workspaces={workspaces}
												allVisibleIds={allVisibleIds}
												onRowFocus={focusList}
												onBatchAction={handleBatchAction}
												/>
											</div>
										)}
									</div>
								)}

								{/* 4. Deleted Worktrees Bucket: kept visible (dimmed) instead of vanishing */}
								{grouped.deletedSessions.length > 0 && (
									<div className="mt-0.5 opacity-60 hover:opacity-100 transition-opacity">
										<div
											onClick={() => toggleGroup("__deleted", false)}
											className="group flex cursor-pointer select-none items-center justify-between mx-1 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text)] transition-colors"
										>
											<div className="flex items-center gap-1.5 min-w-0 flex-1">
												{isGroupOpen("__deleted", false) ? (
													<ChevronDown
														size={13}
														className="text-[var(--text-dim)] shrink-0"
													/>
												) : (
													<ChevronRight
														size={13}
														className="text-[var(--text-dim)] shrink-0"
													/>
												)}
												<FolderGit2
													size={14}
													className="text-[var(--text-dim)] shrink-0"
												/>
												<span className="font-bold text-[12.5px] text-[var(--text)] truncate">
													{DELETED_LABEL}
												</span>
												{renderBubbleBadges(
													getGroupStatusCounts(grouped.deletedSessions),
												)}
											</div>

											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													batchArchiveSessions(
														DELETED_LABEL,
														grouped.deletedSessions,
													);
												}}
												className="mr-1 rounded p-1 text-neutral-500 opacity-50 hover:opacity-100 hover:bg-neutral-700/60 hover:text-amber-300 focus:opacity-100 transition-opacity"
												title="一键归档全部已清理 Worktree 的会话"
											>
												<Archive size={12} />
											</button>
										</div>

										{isGroupOpen("__deleted", false) && (
											<div className="pb-1">
												<SessionList
													sessions={grouped.deletedSessions}
													scopeKey="__deleted"
													searching={searching}
													onSetCount={setSectionCount}
													expanded={expandedSections}
													workspaces={workspaces}
												allVisibleIds={allVisibleIds}
												onRowFocus={focusList}
												onBatchAction={handleBatchAction}
												/>
											</div>
										)}
									</div>
								)}
							</>
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
								) : activeWorkspaceId === "all" ? (
									<>
										<Inbox size={24} className="mb-2 text-neutral-600" />
										<div className="text-xs">暂无任何会话</div>
										<div className="mt-1 text-[11px] text-neutral-600">
											点击工作区旁 "+ " 开始探索
										</div>
									</>
								) : null}
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
			{/* Bottom footer: Settings — whole row is the click target (button
				onClick bubbles up; button keeps focus + active styling) */}
			<div
				onClick={() =>
					setCenter(
						centerView === "settings"
							? selectedSessionId
								? "session"
								: "home"
							: "settings",
					)
				}
				className="group flex shrink-0 cursor-pointer items-center justify-between border-t border-neutral-800/80 px-3 py-2 bg-neutral-900/50 hover:bg-neutral-800/60 transition-colors"
			>
				<button
					type="button"
					className={clsx(
						"flex w-full items-center justify-start gap-2 rounded-md px-2 py-1 text-xs transition-colors",
						centerView === "settings"
							? "bg-neutral-800 text-neutral-100 font-medium"
							: "text-neutral-400 group-hover:text-neutral-200",
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
								className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--status-error)] hover:bg-rose-500/15 text-left"
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
					className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--overlay)] p-4"
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
	sessions: SessionMeta[];
	scopeKey: string;
	searching: boolean;
	expanded: Record<string, number>;
	onSetCount: (key: string, count: number) => void;
	indent?: number;
	/** Draw the subgroup guide line as a per-row segment (stops at last row). */
	withSpine?: boolean;
	workspaces: Workspace[];
	allVisibleIds?: string[];
	onRowFocus?: () => void;
	onBatchAction?: (action: "archive" | "pin" | "delete", ids: string[]) => void;
}

/**
 * Renders a flat list of sessions with progressive disclosure (RECENT_LIMIT
 * rows initially, +RECENT_STEP per "show more" click). Forked sessions are
 * ordinary rows; SessionRow marks them with a small fork icon.
 */
function SessionList({
	sessions,
	scopeKey,
	searching,
	indent = 0,
	withSpine = false,
	expanded,
	onSetCount,
	workspaces,
	allVisibleIds,
	onRowFocus,
	onBatchAction,
}: SessionListProps) {
	const renderSession = (session: SessionMeta) => (
		<SessionRow
			key={session.id}
			session={session}
			indent={indent}
			withSpine={withSpine}
			workspaces={workspaces}
			allVisibleIds={allVisibleIds}
			onRowFocus={onRowFocus}
			onBatchAction={onBatchAction}
		/>
	);

	if (searching) {
		return <>{sessions.map(renderSession)}</>;
	}

	const moreKey = `${scopeKey}|more`;

	const visibleCount = Math.min(
		Math.max(expanded[moreKey] ?? RECENT_LIMIT, RECENT_LIMIT),
		sessions.length,
	);
	const visibleSessions = sessions.slice(0, visibleCount);
	// Progressive-disclosure footer: "show N more" while sessions remain, and a
	// collapse row whenever the list is expanded beyond RECENT_LIMIT.
	const renderPagingFooter = (
		count: number,
		hidden: number,
		moreKey: string,
		onCollapse: () => void,
	) => {
		const expandable = Math.min(RECENT_STEP, hidden);
		const showExpand = hidden > 0;
		const showCollapse = count > RECENT_LIMIT;
		if (!showExpand && !showCollapse) return null;
		return (
			<div className="flex items-center py-1 px-3 text-[10px] font-medium select-none">
				<span className="h-px flex-1 bg-[var(--border)] opacity-50" />
				{showExpand && (
					<button
						type="button"
						onClick={() => onSetCount(moreKey, count + RECENT_STEP)}
						className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors"
					>
						<Plus size={9} className="shrink-0" />
						<span>展开 {expandable} 条</span>
					</button>
				)}
				{showExpand && showCollapse && (
					<span className="mx-1.5 text-[var(--text-dim)] opacity-50">｜</span>
				)}
				{showCollapse && (
					<button
						type="button"
						onClick={onCollapse}
						className="flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[var(--text-dim)] hover:text-[var(--accent-strong)] transition-colors"
					>
						<ChevronDown size={9} className="shrink-0 rotate-180" />
						<span>收起</span>
					</button>
				)}
				<span className="h-px flex-1 bg-[var(--border)] opacity-50" />
			</div>
		);
	};
	return (
		<>
			{visibleSessions.map(renderSession)}
			{renderPagingFooter(visibleCount, sessions.length - visibleCount, moreKey, () =>
				onSetCount(moreKey, RECENT_LIMIT),
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
	onBatchArchive,
	workspaces,
	allVisibleIds,
	onRowFocus,
	onBatchAction,
	ws,
	onCreateSession,
}: CollapsibleSubgroupProps) {
	const userExpanded = expanded[`${scopeKey}|sub`];
	const isCollapsed = userExpanded !== undefined ? userExpanded === 1 : sub.deleted;
	const open = searching || !isCollapsed;

	return (
		<div className={clsx("mt-0.5 ml-[14px]", sub.deleted && "opacity-60 hover:opacity-100 transition-opacity")}>
			<div className="group/sub flex items-center">
				<button
					type="button"
					onClick={() => onToggle(`${scopeKey}|sub`)}
					className="flex min-w-0 flex-1 items-center gap-1.5 mx-1 px-2 py-1 text-[11px] font-semibold text-[var(--text)] hover:bg-[var(--bg-hover)] rounded-md transition-colors"
				>
					{open ? (
						<ChevronDown size={11} className="shrink-0 text-[var(--text-dim)]" />
					) : (
						<ChevronRight size={11} className="shrink-0 text-[var(--text-dim)]" />
					)}
					{sub.kind === "worktree" ? (
						<FolderGit2 size={12} className="text-indigo-600 dark:text-indigo-400 shrink-0" />
					) : (
						<GitBranch size={12} className="text-purple-600 dark:text-purple-400 shrink-0" />
					)}
					<span className="min-w-0 truncate font-mono font-bold text-[var(--text)]">
						{sub.label}
					</span>
					{sub.deleted && (
						<span className="shrink-0 rounded bg-[var(--bg-hover)] px-1 text-[9px] text-[var(--text-dim)] font-normal">
							已清理
						</span>
					)}
					{/* Session count stays hidden until the row is hovered */}
				</button>
				{!sub.deleted && sub.createCwd && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onCreateSession(ws, sub.createCwd!);
						}}
						className="mr-1 shrink-0 rounded p-0.5 text-[var(--text-dim)] opacity-50 hover:opacity-100 transition-all duration-150 ease-out hover:bg-[var(--bg-hover)] hover:text-[var(--accent)]"
						title="在该分支创建新会话"
					>
						<Plus size={12} />
					</button>
				)}
				{sub.deleted && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							onBatchArchive();
						}}
						className="mr-1 shrink-0 rounded p-0.5 text-[var(--text-dim)] opacity-50 hover:opacity-100 transition-all duration-150 ease-out hover:bg-neutral-700/60 hover:text-amber-300"
						title="归档该分支全部会话"
					>
						<Archive size={11} />
					</button>
				)}
			</div>
			{open && (
				<div className="ml-[22px] pl-2 my-0.5">
					<SessionList
						sessions={sub.sessions}
						scopeKey={scopeKey}
						searching={searching}
						indent={0}
						expanded={expanded}
						onSetCount={onSetCount}
						workspaces={workspaces}
						allVisibleIds={allVisibleIds}
						onRowFocus={onRowFocus}
						onBatchAction={onBatchAction}
						withSpine
					/>
				</div>
			)}
		</div>
	);
}
