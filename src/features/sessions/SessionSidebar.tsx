/**
 * Left sidebar column: complete session list grouped by workspace (§11 A).
 * - 🌐 Global workspace fixed on top (PLAN.md §67)
 * - Registered workspaces with right-click actions (Finder, remove)
 * - Worktree/branch subgrouping
 * - Unassigned ("未归入工作区") bucket collapsed by default
 * - Deleted worktree bucket ("已清理的工作树") kept visible (dimmed)
 * - Search + Archive toggle
 * - Keyboard navigation (↑/↓ to select, Enter to open, Delete to archive, Shift+Delete to delete)
 * - Accessibility: role="listbox", real button headers, aria-activedescendant
 * - Single source of truth for rendered rows via visibleRows.ts
 */

import { open } from "@tauri-apps/plugin-dialog";
import {
	Bell,
	AlertCircle,
	Archive,
	Boxes,
	Check,
	ChevronDown,
	Clock,
	Folder,
	FolderGit2,
	FolderOpen,
	FolderPlus,
	FolderInput,
	FolderSearch,
	GitBranch,
	Loader2,
	MoreHorizontal,
	Pencil,
	Pin,
	Plus,
	SquarePen,
	Search,
	Settings as SettingsIcon,
	SlidersHorizontal,
	Tag,
	Trash2,
	UnfoldVertical,
	FoldVertical,
	PanelLeftClose,
	X,
} from "lucide-react";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import type { Anchor } from "../../components/FloatingLayer";
import { FloatingLayer } from "../../components/FloatingLayer";
import { HoverScrollText } from "../../components/HoverScrollText";
import type {
	SessionGroup,
	Workspace,
	SessionMeta,
} from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isInside } from "../../lib/paths";
import { isComposing } from "../../lib/hooks";
import {
	addWorkspace,
	createSessionGroup,
	deleteSessionGroup,
	removeWorkspace,
	renameSessionGroup,
	updateSessionMeta,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useComposer } from "../../stores/composer";
import { useLive } from "../../stores/live";
import { isBlankDraft } from "../../lib/createSession";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { useSettings } from "../settings/store";
import { WorktreeHoverCard } from "../git/WorktreeHoverCard";
import { useInboxBadge, useModeActivity } from "../inbox/useInboxBadge";
import { ModeActivityDot } from "./ModeActivityDot";
import { switchSpaceMode } from "./switchMode";
import { ArchiveUndoBar } from "./ArchiveUndoBar";
import { archiveSessions } from "./archiveUndo";
import { GroupHeader, getGroupStatusCounts } from "./GroupHeader";
import {
	type BranchSubgroup,
	type GroupedSessionsResult,
	DELETED_LABEL,
	UNASSIGNED_LABEL,
	filterSessions,
	groupSessions,
	inferWorktreeName,
	needsAttention,
	snapshotOrder,
} from "./grouping";
import {
	SPACE_MODE_META,
	SPACE_MODES,
	isGlobalWorkspaceId,
	modeGlobalWorkspace,
	modeHasProjects,
} from "./modes";
import { startNewSession, startSessionAt, startSessionInDir } from "./newSession";
import {
	requestArchive,
	requestAssign,
	requestDelete,
	requestRename,
	requestRowMenu,
} from "./sessionActions";
import { SessionDialogs } from "./SessionDialogs";
import { LoadFailed } from "../../components/LoadFailed";
import { deriveLoadState } from "../../lib/loadState";
import { SessionRow } from "./SessionRow";
import { SIDEBAR_SEARCH_OPEN_EVENT } from "./sidebarShortcuts";
import { useSidebarStore } from "./sidebarStore";
import { SIDEBAR_LIST_ATTR, getVisibleSessionIds } from "./visibleRows";
import { groupsForMode, splitSessionsByGroup, useSessionGroups } from "./sessionGroups";
import { claimEscape } from "../../lib/escapeClaim";
import { useTrafficLightsVisible } from "../../lib/trafficLights";

const RECENT_LIMIT = 3;
const RECENT_STEP = 5;
/** Projects without worktrees show more sessions up front. */
const NO_WORKTREE_RECENT_LIMIT = 5;

export interface WorkspacePalette {
	folderColor: string;
}

export const WORKSPACE_PALETTES: WorkspacePalette[] = [
	{ folderColor: "text-sky-600 dark:text-sky-400" },
	{ folderColor: "text-emerald-600 dark:text-emerald-400" },
	{ folderColor: "text-amber-600 dark:text-amber-400" },
	{ folderColor: "text-purple-600 dark:text-purple-400" },
	{ folderColor: "text-rose-600 dark:text-rose-400" },
	{ folderColor: "text-teal-600 dark:text-teal-400" },
];

export function getWorkspacePalette(idOrName: string): WorkspacePalette {
	if (isGlobalWorkspaceId(idOrName)) {
		return { folderColor: "text-indigo-600 dark:text-indigo-400" };
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
	anchor: Anchor;
}

interface WsMenuState {
	ws: Workspace;
	anchor: Anchor;
}
/**
 * Accessible menu container with autofocus and keyboard arrow navigation (Q08).
 */
function MenuContainer({
	children,
	ariaLabel,
	onClose,
	triggerRef,
	className,
}: {
	children: React.ReactNode;
	ariaLabel: string;
	onClose: () => void;
	triggerRef?: React.RefObject<HTMLElement | null>;
	className?: string;
}) {
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const timer = window.setTimeout(() => {
			const items = menuRef.current?.querySelectorAll<HTMLElement>(
				'[role="menuitem"]:not([disabled])',
			);
			items?.[0]?.focus();
		}, 0);
		return () => {
			clearTimeout(timer);
			triggerRef?.current?.focus();
		};
	}, [triggerRef]);

	const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		const items = Array.from(
			menuRef.current?.querySelectorAll<HTMLElement>(
				'[role="menuitem"]:not([disabled])',
			) ?? [],
		);
		if (items.length === 0) return;
		const currentIndex = items.indexOf(document.activeElement as HTMLElement);

		if (e.key === "ArrowDown") {
			e.preventDefault();
			e.stopPropagation();
			const nextIndex = currentIndex < items.length - 1 ? currentIndex + 1 : 0;
			items[nextIndex]?.focus();
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			e.stopPropagation();
			const prevIndex = currentIndex > 0 ? currentIndex - 1 : items.length - 1;
			items[prevIndex]?.focus();
		} else if (e.key === "Home") {
			e.preventDefault();
			e.stopPropagation();
			items[0]?.focus();
		} else if (e.key === "End") {
			e.preventDefault();
			e.stopPropagation();
			items[items.length - 1]?.focus();
		} else if (e.key === "Escape") {
			claimEscape(e);
			e.stopPropagation();
			onClose();
		}
	};

	return (
		<div
			ref={menuRef}
			role="menu"
			aria-label={ariaLabel}
			onKeyDown={handleKeyDown}
			className={clsx("focus:outline-none", className)}
		>
			{children}
		</div>
	);
}


export function SessionSidebar() {
	const sessions = useSessions((s) => s.sessions);
	const workspaces = useSessions((s) => s.workspaces);
	const hasLoaded = useSessions((s) => s.hasLoaded);
	const loadSessions = useSessions((s) => s.load);
	const storeLoadError = useSessions((s) => s.loadError);
	const loadState = deriveLoadState(hasLoaded, storeLoadError);

	const selectSession = useUi((s) => s.selectSession);
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const highlightId = useUi((s) => s.highlightId);
	const setHighlightId = useUi((s) => s.setHighlightId);
	const centerView = useUi((s) => s.centerView);
	const toggleSidebar = useUi((s) => s.toggleSidebar);
	const setCenter = useUi((s) => s.setCenter);
	const openSettings = useUi((s) => s.openSettings);
	const closeSettings = useUi((s) => s.closeSettings);

	const inboxBadge = useInboxBadge();
	// Windowed macOS (overlay traffic lights visible) splits the topbar into
	// two rows; fullscreen / non-mac keeps one row.
	const trafficLightsVisible = useTrafficLightsVisible();
	// Persistent sidebar store state (survives Cmd+B)
	const activeMode = useSidebarStore((s) => s.activeMode);
	const setActiveMode = useSidebarStore((s) => s.setActiveMode);
	const modeActivity = useModeActivity();
	const otherActivity = useMemo(() => {
		let badge = 0;
		let running = 0;
		for (const mode of SPACE_MODES) {
			if (mode === activeMode) continue;
			badge += modeActivity[mode].badge;
			running += modeActivity[mode].running;
		}
		return badge > 0 || running > 0 ? { badge, running } : null;
	}, [modeActivity, activeMode]);
	// groupOpen subscribed selector (C1, Q02)
	const groupOpen = useSidebarStore((s) => s.groupOpen);
	const setGroupOpen = useSidebarStore((s) => s.setGroupOpen);
	const toggleGroup = useSidebarStore((s) => s.toggleGroup);
	const searchQuery = useSidebarStore((s) => s.searchQuery);
	const setSearchQuery = useSidebarStore((s) => s.setSearchQuery);
	const showArchived = useSidebarStore((s) => s.showArchived);
	const setShowArchived = useSidebarStore((s) => s.setShowArchived);
	const expandedSections = useSidebarStore((s) => s.expandedSections);
	const setSectionCount = useSidebarStore((s) => s.setSectionCount);
	const toggleSection = useSidebarStore((s) => s.toggleSection);
	const creatingKey = useSidebarStore((s) => s.creatingKey);

	// 无项目-area session groups (all modes; filtered per activeMode below)
	const sessionGroups = useSessionGroups((s) => s.groups);
	const loadSessionGroups = useSessionGroups((s) => s.load);
	useEffect(() => {
		void loadSessionGroups();
	}, [loadSessionGroups]);

	const searching = searchQuery.trim().length > 0;

	// C1, C3 / Q03: derive isGroupOpen from groupOpen and force open while searching
	const isGroupOpen = useCallback(
		(key: string, defaultOpen = true) => {
			if (searching) return true;
			const open = groupOpen[key];
			return open !== undefined ? open : defaultOpen;
		},
		[groupOpen, searching],
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	// Dropdown and menu state
	const [modeMenuOpen, setModeMenuOpen] = useState(false);
	const [searchOpen, setSearchOpen] = useState(false);
	// ⌘F (focusSidebarSearch) asks the sidebar to reveal the collapsed search row.
	useEffect(() => {
		const open = () => setSearchOpen(true);
		window.addEventListener(SIDEBAR_SEARCH_OPEN_EVENT, open);
		return () => window.removeEventListener(SIDEBAR_SEARCH_OPEN_EVENT, open);
	}, []);
	const [filterPopoverOpen, setFilterPopoverOpen] = useState(false);
	const [plusMenu, setPlusMenu] = useState<PlusMenuState | null>(null);
	const [wsMenu, setWsMenu] = useState<WsMenuState | null>(null);
	const wsMenuTriggerRef = useRef<HTMLElement | null>(null);

	// 无项目 area UI state: open ⋯ group menu, inline rename, inline create.
	const [grpMenu, setGrpMenu] = useState<{
		group: SessionGroup;
		anchor: Anchor;
	} | null>(null);
	const grpMenuTriggerRef = useRef<HTMLElement | null>(null);
	const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
	const [groupNameDraft, setGroupNameDraft] = useState("");
	const [newGroupOpen, setNewGroupOpen] = useState(false);
	const [newGroupName, setNewGroupName] = useState("");
	const newGroupInputRef = useRef<HTMLInputElement>(null);
	const groupRenameInputRef = useRef<HTMLInputElement>(null);
	/** Guards create/rename against the blur that follows their own commit. */
	const groupEditInFlight = useRef(false);

	// Focus the inline group-name inputs when they open
	useEffect(() => {
		if (newGroupOpen) newGroupInputRef.current?.focus();
	}, [newGroupOpen]);
	useEffect(() => {
		if (renamingGroupId) groupRenameInputRef.current?.focus();
	}, [renamingGroupId]);

	// Frozen order during hover to prevent row reshuffling under mouse (G14)
	const [frozenOrder, setFrozenOrder] = useState<ReadonlyMap<string, number> | undefined>(undefined);
	const lastGroupedRef = useRef<GroupedSessionsResult | null>(null);

	const scrollRef = useRef<HTMLDivElement>(null);
	const modeSwitcherRef = useRef<HTMLButtonElement>(null);
	const modeMenuRef = useRef<HTMLDivElement>(null);
	// Mode menu is rendered in-flow under the header (no portal/measure), so
	// outside clicks are handled here.
	useEffect(() => {
		if (!modeMenuOpen) return;
		const onDown = (e: MouseEvent) => {
			const t = e.target as Node;
			if (modeMenuRef.current?.contains(t)) return;
			if (modeSwitcherRef.current?.contains(t)) return;
			setModeMenuOpen(false);
		};
		document.addEventListener("mousedown", onDown, true);
		return () => document.removeEventListener("mousedown", onDown, true);
	}, [modeMenuOpen]);
	const filterBtnRef = useRef<HTMLButtonElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const plusTriggerRef = useRef<HTMLElement | null>(null);
	const debounceTimerRef = useRef<number | null>(null);

	const focusList = useCallback(() => scrollRef.current?.focus(), []);

	// Initial data load (P5: record loadError for retryable inline empty state)
	useEffect(() => {
		loadSessions()
			.then(() => {
				setLoadError(null);
				setErrorMessage(null);
			})
			.catch((err) => {
				const msg = errMsg(err);
				setLoadError(msg);
				setErrorMessage(`加载会话列表失败: ${msg}`);
			});
	}, [loadSessions]);

	const globalWs = useMemo(
		() => modeGlobalWorkspace(workspaces, activeMode),
		[workspaces, activeMode],
	);

	const modeGroups = useMemo(
		() => groupsForMode(sessionGroups, activeMode),
		[sessionGroups, activeMode],
	);

	// Auto-follow: selecting a session of another space switches the mode so
	// the picked row is always visible (replaces the old ws-scope autofollow).
	const prevSelectedIdRef = useRef<string | null>(
		useUi.getState().selectedSessionId ?? useUi.getState().lastSessionId ?? null,
	);
	useEffect(() => {
		if (selectedSessionId && selectedSessionId !== prevSelectedIdRef.current) {
			prevSelectedIdRef.current = selectedSessionId;
			const current = sessions[selectedSessionId];
			if (current && current.mode !== activeMode) {
				setActiveMode(current.mode);
			}
		} else {
			prevSelectedIdRef.current = selectedSessionId;
		}
	}, [selectedSessionId, sessions, activeMode, setActiveMode]);

	// Each space shows one list: 通用对话 → global sessions + groups; project
	// modes → project directories. Search stays scoped to the active space.
	const showLoose = !modeHasProjects(activeMode);
	const showProjects = modeHasProjects(activeMode);

	// S10: Cancel pending arrow-key selection timer whenever selection changes or on unmount
	useEffect(() => {
		if (debounceTimerRef.current !== null) {
			clearTimeout(debounceTimerRef.current);
			debounceTimerRef.current = null;
		}
		return () => {
			if (debounceTimerRef.current !== null) {
				clearTimeout(debounceTimerRef.current);
				debounceTimerRef.current = null;
			}
		};
	}, [selectedSessionId]);

	// Worktree status sync
	const worktrees = useWorktrees((s) => s.byWorkspace);
	useEffect(() => {
		void useWorktrees.getState().refresh(workspaces);
	}, [workspaces]);

	useEffect(() => {
		const onFocus = () => void useWorktrees.getState().refresh();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, []);

	// Background worktree mismatch sync (C12: ref-based debounce independent of sessions identity)
	const worktreeRefreshTimer = useRef<number | null>(null);
	const unmatchedCwdSigRef = useRef<string | null>(null);
	useEffect(() => {
		const sig = Object.values(sessions)
			.filter(
				(s) =>
					s.workspaceId &&
					inferWorktreeName(s.cwd) !== null &&
					!(worktrees[s.workspaceId] ?? []).some((w) => isInside(s.cwd, w.path)),
			)
			.map((s) => s.id)
			.sort()
			.join(",");

		if (sig.length === 0) {
			unmatchedCwdSigRef.current = "";
			clearTimeout(worktreeRefreshTimer.current ?? undefined);
			worktreeRefreshTimer.current = null;
			return;
		}

		if (sig === unmatchedCwdSigRef.current) {
			// Sig didn't change: keep any existing debounce timer running
			return;
		}

		unmatchedCwdSigRef.current = sig;

		clearTimeout(worktreeRefreshTimer.current ?? undefined);
		worktreeRefreshTimer.current = window.setTimeout(() => {
			worktreeRefreshTimer.current = null;
			void useWorktrees.getState().refresh(useSessions.getState().workspaces);
		}, 500);
	}, [sessions, worktrees, workspaces]);

	useEffect(() => {
		return () => {
			clearTimeout(worktreeRefreshTimer.current ?? undefined);
			worktreeRefreshTimer.current = null;
		};
	}, []);

	// Compute grouped sessions with optional frozen order (C2: pass worktrees)
	// Blank drafts (unnamed, no transcript, nothing typed) are not listed; they
	// appear once the user types something or sends a message.
	const composerActiveIds = useComposer((s) =>
		Object.keys(s.drafts)
			.filter((id) => s.drafts[id]?.trim() || (s.images[id]?.length ?? 0) > 0)
			.concat(Object.keys(s.images).filter((id) => (s.images[id]?.length ?? 0) > 0))
			.sort()
			.join(","),
	);
	const sessionsList = useMemo(() => {
		const active = new Set(composerActiveIds ? composerActiveIds.split(",") : []);
		const lives = useLive.getState().sessions;
		return Object.values(sessions).filter(
			(s) => active.has(s.id) || !isBlankDraft(s, lives[s.id]),
		);
	}, [sessions, composerActiveIds]);
	// Worktree grouping is a code-mode concept; other modes always get a flat list per project.
	const groupByWorktreeSetting = useSettings((s) => s.settings?.sessionGroupByWorktree ?? true);
	const groupByWorktree = activeMode === "code" && groupByWorktreeSetting;
	const grouped = useMemo(() => {
		const res = groupSessions(sessionsList, workspaces, {
			searchQuery,
			showArchived,
			mode: activeMode,
			frozenOrder,
			worktrees,
			groupByWorktree,
		});
		lastGroupedRef.current = res;
		return res;
	}, [sessionsList, workspaces, searchQuery, showArchived, activeMode, frozenOrder, worktrees, groupByWorktree]);

	// 无项目 sessions of the active mode, split into per-group buckets.
	const noProjectSplit = useMemo(() => {
		const all = grouped.globalGroup
			? grouped.globalGroup.subgroups.flatMap((g) => g.sessions)
			: [];
		return splitSessionsByGroup(all, modeGroups);
	}, [grouped.globalGroup, modeGroups]);

	// Collect group keys for expand/collapse all
	const allGroupKeys = useMemo(() => {
		const keys: string[] = [];
		if (grouped.pinnedSessions.length > 0) keys.push("__pinned");
		// 无项目 area + its user groups
		keys.push("__global");
		for (const g of modeGroups) keys.push(`grp:${g.id}`);
		for (const wg of grouped.workspaceGroups) {
			keys.push(wg.workspace.id);
			if (wg.subgroups.some((s) => !s.deleted && s.sessions.length === 0))
				keys.push(`${wg.workspace.id}|__empty`);
			if (wg.deletedSubgroups.length > 0) keys.push(`${wg.workspace.id}|__deleted`);
		}
		keys.push("__unassigned");
		if (grouped.deletedSessions.length > 0) keys.push("__deleted");
		return keys;
	}, [grouped, modeGroups, searching]);


	const areAllCollapsed = useMemo(() => {
		if (allGroupKeys.length === 0) return false;
		return allGroupKeys.every(
			(id) =>
				!isGroupOpen(
					id,
					id !== "__unassigned" &&
						!id.endsWith("__deleted") &&
						!id.endsWith("__empty"),
				),
		);
	}, [allGroupKeys, isGroupOpen, groupOpen]);

	// S13: Merge into previous state, covers subgroups, no-op while searching
	const handleToggleAllGroups = () => {
		if (searching) return;
		const shouldExpand = areAllCollapsed;
		setGroupOpen((prev) => {
			const next = { ...prev };
			for (const id of allGroupKeys) {
				next[id] = shouldExpand;
			}
			return next;
		});
		// Also expand/collapse all subgroups
		const subKeys: string[] = [];
		for (const wg of grouped.workspaceGroups) {
			for (const sub of wg.subgroups) {
				// Empty live subgroups render inside the "__empty" folder and
				// get that folder's scope prefix instead.
				subKeys.push(
					!sub.deleted && sub.sessions.length === 0
						? `${wg.workspace.id}|__empty|${sub.key}|sub`
						: `${wg.workspace.id}|${sub.key}|sub`,
				);
			}
			for (const sub of wg.deletedSubgroups) {
				subKeys.push(`${wg.workspace.id}|__deleted|${sub.key}|sub`);
			}
		}
		if (subKeys.length > 0) {
			for (const key of subKeys) {
				setSectionCount(key, shouldExpand ? 1 : 0);
			}
		}
	};

	// Centralized batch actions (C7, C8: stable deps, toggle pinned)
	const handleBatchAction = useCallback(
		async (action: "archive" | "pin" | "delete", ids: string[]) => {
			if (ids.length === 0) return;
			if (action === "archive") {
				await archiveSessions(ids, { title: `批量归档 (${ids.length})` });
			} else if (action === "delete") {
				await requestDelete(ids);
			} else if (action === "pin") {
				const currentSessions = useSessions.getState().sessions;
				const allPinned = ids.every((id) => currentSessions[id]?.pinned);
				const nextPinned = !allPinned;
				const results = await Promise.allSettled(
					ids.map((id) => updateSessionMeta(id, { pinned: nextPinned })),
				);
				const successes: SessionMeta[] = [];
				let failCount = 0;
				results.forEach((res, idx) => {
					if (res.status === "fulfilled") {
						const meta = res.value;
						if (meta) {
							successes.push(meta);
						} else {
							const existing = useSessions.getState().sessions[ids[idx]];
							if (existing) successes.push({ ...existing, pinned: nextPinned });
						}
					} else {
						failCount++;
					}
				});
				if (successes.length > 0) {
					useSessions.getState().upsert(successes);
					toast.success(
						nextPinned
							? `已置顶 ${successes.length} 个会话`
							: `已取消置顶 ${successes.length} 个会话`,
					);
				}
				if (failCount > 0) {
					toast.error(
						nextPinned
							? `置顶失败 ${failCount} 个会话`
							: `取消置顶失败 ${failCount} 个会话`,
					);
				}
			}
		},
		[],
	);

	const batchArchiveSessions = async (title: string, sessionList: SessionMeta[]) => {
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
		await archiveSessions(unarchived.map((s) => s.id), {
			title: `批量归档「${title}」`,
		});
	};

	// Reset frozen order on filter/mode changes, blur, pointerdown outside, or menu interactions (C9)
	useEffect(() => {
		setFrozenOrder(undefined);
	}, [searchQuery, showArchived, activeMode]);

	useEffect(() => {
		const handleBlur = () => setFrozenOrder(undefined);
		const handlePointerDown = (e: PointerEvent) => {
			if (scrollRef.current && !scrollRef.current.contains(e.target as Node)) {
				setFrozenOrder(undefined);
			}
		};
		window.addEventListener("blur", handleBlur);
		window.addEventListener("pointerdown", handlePointerDown);
		return () => {
			window.removeEventListener("blur", handleBlur);
			window.removeEventListener("pointerdown", handlePointerDown);
		};
	}, []);

	useEffect(() => {
		if (wsMenu || plusMenu || filterPopoverOpen || modeMenuOpen || grpMenu) {
			setFrozenOrder(undefined);
		}
	}, [wsMenu, plusMenu, filterPopoverOpen, modeMenuOpen, grpMenu]);

	// Q06 + reveal: when selectedSessionId changes and its row is not rendered,
	// expand the containing workspace/group and subgroup, then scroll into view.
	const prevRevealedIdRef = useRef<string | null>(null);
	// First effect run = app boot / sidebar remount: treat the restored
	// selection as already-seen and do NOT auto-scroll, otherwise every launch
	// jumps the list mid-way and hides the group headers.
	const didInitRevealRef = useRef(false);
	useEffect(() => {
		if (!selectedSessionId) {
			prevRevealedIdRef.current = null;
			return;
		}

		if (!didInitRevealRef.current) {
			didInitRevealRef.current = true;
			prevRevealedIdRef.current = selectedSessionId;
			return;
		}

		const target = sessions[selectedSessionId];
		if (!target) return;

		if (selectedSessionId === prevRevealedIdRef.current) return;
		prevRevealedIdRef.current = selectedSessionId;

		// 1. Filter checks: do nothing if filtered out by search / archived / mode
		if (target.archived && !showArchived) return;
		if (searching && filterSessions([target], { searchQuery, showArchived }).length === 0) return;
		if (target.mode !== activeMode) return;

		// 2. Identify containing group and subgroup
		let groupKeyToExpand: string | null = null;
		let subgroupKeyToExpand: string | null = null;
		let isSubgroupInGroupOpen = false;

		if (target.pinned) {
			groupKeyToExpand = "__pinned";
		} else if (globalWs && target.workspaceId === globalWs.id) {
			// 无项目 area: expand the SessionGroup holding the row (ungrouped
			// rows render directly under the always-visible area list).
			if (target.groupId) groupKeyToExpand = `grp:${target.groupId}`;
		} else if (target.workspaceId) {
			groupKeyToExpand = target.workspaceId;
			const wg = grouped.workspaceGroups.find((w) => w.workspace.id === target.workspaceId);
			if (wg) {
				const liveSub = wg.subgroups.find((sub) =>
					sub.sessions.some((s) => s.id === selectedSessionId),
				);
				if (liveSub) {
					if (wg.hasMultipleSubgroups || liveSub.kind !== "default" || !liveSub.isMain) {
						subgroupKeyToExpand = `${wg.workspace.id}|${liveSub.key}|sub`;
					}
				} else {
					const delSub = wg.deletedSubgroups.find((sub) =>
						sub.sessions.some((s) => s.id === selectedSessionId),
					);
					if (delSub) {
						const folderKey = `${wg.workspace.id}|__deleted`;
						if (!groupOpen[folderKey]) {
							setGroupOpen((prev) => ({ ...prev, [folderKey]: true }));
						}
						subgroupKeyToExpand = `${wg.workspace.id}|__deleted|${delSub.key}|sub`;
					}
				}
			}
		} else {
			// Unassigned
			const inDeleted = grouped.deletedSessions.some((s) => s.id === selectedSessionId);
			if (inDeleted) {
				groupKeyToExpand = "__deleted";
			} else {
				groupKeyToExpand = "__unassigned";
				const unassignedGrp = grouped.unassignedGroups?.find((grp) =>
					grp.sessions.some((s) => s.id === selectedSessionId),
				);
				if (unassignedGrp) {
					subgroupKeyToExpand = `__unassigned|${unassignedGrp.key}`;
					isSubgroupInGroupOpen = true;
				}
			}
		}

		// 3. Expand containing group if collapsed
		if (groupKeyToExpand) {
			const isTopLevelOpen =
				groupOpen[groupKeyToExpand] !== undefined
					? groupOpen[groupKeyToExpand]
					: groupKeyToExpand !== "__unassigned" && !groupKeyToExpand.endsWith("__deleted");
			if (!isTopLevelOpen) {
				setGroupOpen((prev) => ({ ...prev, [groupKeyToExpand!]: true }));
			}
		}

		// 4. Expand containing subgroup if collapsed
		if (subgroupKeyToExpand) {
			if (isSubgroupInGroupOpen) {
				const isSubOpen =
					groupOpen[subgroupKeyToExpand] !== undefined
						? groupOpen[subgroupKeyToExpand]
						: true;
				if (!isSubOpen) {
					setGroupOpen((prev) => ({ ...prev, [subgroupKeyToExpand!]: true }));
				}
			} else {
				const isSubOpen =
					expandedSections[subgroupKeyToExpand] !== undefined
						? expandedSections[subgroupKeyToExpand] === 1
						: true;
				if (!isSubOpen) {
					setSectionCount(subgroupKeyToExpand, 1);
				}
			}
		}

		// 5. Scroll into view on #session-row-<id>
		requestAnimationFrame(() => {
			const row = document.getElementById(`session-row-${selectedSessionId}`);
			if (row) {
				row.scrollIntoView({ block: "nearest" });
			} else {
				window.setTimeout(() => {
					const el = document.getElementById(`session-row-${selectedSessionId}`);
					el?.scrollIntoView({ block: "nearest" });
				}, 60);
			}
		});
	}, [
		selectedSessionId,
		sessions,
		grouped,
		groupOpen,
		expandedSections,
		showArchived,
		searching,
		searchQuery,
		activeMode,
		globalWs,
		setGroupOpen,
		setSectionCount,
	]);

	// Workspace management actions — adds land in the CURRENT space mode.
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
				const ws = await addWorkspace(selectedPath, activeMode);
				await loadSessions();
				toast.success("已添加工作区");
				await startSessionInDir(ws, false);
			}
		} catch (err) {
			toast.error(`添加工作区失败: ${errMsg(err)}`);
		}
	};

	const handleRemoveWorkspace = async (ws: Workspace) => {
		setWsMenu(null);
		if (ws.kind === "global") {
			toast.info("全局工作区不可移除");
			return;
		}
		const ok = await confirmDialog(
			`确定从工作区列表中移除「${ws.name}」？\n所属会话将变为未归入工作区，磁盘文件不受影响。`,
			{ title: "移除工作区", danger: true, okLabel: "移除" },
		);
		if (!ok) return;
		try {
			await removeWorkspace(ws.id);
			await loadSessions();
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

	// Popover menu opening
	const handlePlusClick = (ws: Workspace, e: React.MouseEvent) => {
		e.stopPropagation();
		e.preventDefault();
		if (e.altKey || !groupByWorktree) {
			void startSessionInDir(ws, false);
			return;
		}
		const anchorEl = e.currentTarget as HTMLElement;
		plusTriggerRef.current = anchorEl;
		// S28: toggle its own menu
		setPlusMenu((prev) =>
			prev?.ws.id === ws.id ? null : { ws, anchor: anchorEl },
		);
	};

	const handleWorkspaceContextMenu = (ws: Workspace, e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		wsMenuTriggerRef.current = e.currentTarget as HTMLElement;
		setWsMenu({
			ws,
			anchor: { x: e.clientX, y: e.clientY },
		});
	};

	// ---- 无项目 area: SessionGroup CRUD ----
	const handleCreateGroup = async () => {
		const name = newGroupName.trim();
		setNewGroupName("");
		setNewGroupOpen(false);
		if (!name || groupEditInFlight.current) return;
		groupEditInFlight.current = true;
		try {
			await createSessionGroup(activeMode, name);
			await loadSessionGroups();
			toast.success(`已创建分组「${name}」`);
		} catch (err) {
			toast.error(`创建分组失败: ${errMsg(err)}`);
		} finally {
			groupEditInFlight.current = false;
		}
	};

	const handleRenameGroup = async (group: SessionGroup) => {
		const name = groupNameDraft.trim();
		setGroupNameDraft("");
		setRenamingGroupId(null);
		if (!name || name === group.name || groupEditInFlight.current) return;
		groupEditInFlight.current = true;
		try {
			await renameSessionGroup(group.id, name);
			await loadSessionGroups();
			toast.success("已重命名分组");
		} catch (err) {
			toast.error(`重命名分组失败: ${errMsg(err)}`);
		} finally {
			groupEditInFlight.current = false;
		}
	};

	const handleDeleteGroup = async (group: SessionGroup) => {
		setGrpMenu(null);
		const ok = await confirmDialog(
			`确定删除分组「${group.name}」？\n分组内的会话将移回 Universal 列表，不会被删除。`,
			{ title: "删除分组", danger: true, okLabel: "删除分组" },
		);
		if (!ok) return;
		try {
			await deleteSessionGroup(group.id);
			// Ungroup locally right away; sessions:updated may follow with the
			// backend's own view.
			const all = useSessions.getState().sessions;
			const moved = Object.values(all)
				.filter((s) => s.groupId === group.id)
				.map((s) => ({ ...s, groupId: null }));
			if (moved.length > 0) useSessions.getState().upsert(moved);
			await loadSessionGroups();
			toast.success(`已删除分组「${group.name}」`);
		} catch (err) {
			toast.error(`删除分组失败: ${errMsg(err)}`);
		}
	};

	const handleGroupContextMenu = (group: SessionGroup, e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		grpMenuTriggerRef.current = e.currentTarget as HTMLElement;
		setGrpMenu({ group, anchor: { x: e.clientX, y: e.clientY } });
	};

	// List container keyboard navigation (S2, S8, S10, S11, S12/G17, S21)
	const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
		// S8: only handle when list container itself has focus
		if (e.target !== e.currentTarget) return;

		const container = scrollRef.current;
		if (!container) return;

		const visibleIds = getVisibleSessionIds();
		if (visibleIds.length === 0) return;

		const activeId = highlightId ?? selectedSessionId ?? "";
		const currentIndex = visibleIds.indexOf(activeId);

		if (e.key === "ArrowDown") {
			e.preventDefault();
			e.stopPropagation(); // S11
			const nextIdx =
				currentIndex < 0 ? 0 : Math.min(currentIndex + 1, visibleIds.length - 1);
			const nextId = visibleIds[nextIdx];
			setHighlightId(nextId);
			const el = document.getElementById(`session-row-${nextId}`);
			el?.scrollIntoView({ block: "nearest" });

			if (debounceTimerRef.current !== null) {
				clearTimeout(debounceTimerRef.current);
			}
			debounceTimerRef.current = window.setTimeout(() => {
				selectSession(nextId);
			}, 300);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			e.stopPropagation(); // S11
			const prevIdx =
				currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
			const prevId = visibleIds[prevIdx];
			setHighlightId(prevId);
			const el = document.getElementById(`session-row-${prevId}`);
			el?.scrollIntoView({ block: "nearest" });

			if (debounceTimerRef.current !== null) {
				clearTimeout(debounceTimerRef.current);
			}
			debounceTimerRef.current = window.setTimeout(() => {
				selectSession(prevId);
			}, 300);
		} else if (e.key === "Enter") {
			const targetId = highlightId ?? selectedSessionId;
			if (targetId) {
				e.preventDefault();
				e.stopPropagation(); // S11
				if (debounceTimerRef.current !== null) {
					clearTimeout(debounceTimerRef.current);
					debounceTimerRef.current = null;
				}
				selectSession(targetId);
			}
		} else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
			// S12/G17: toggle the group the highlighted row actually lives in
			if (searching) return;
			const targetId = highlightId ?? selectedSessionId;
			if (!targetId) return;

			const rowEl = document.getElementById(`session-row-${targetId}`);
			const groupEl = rowEl?.closest<HTMLElement>("[data-group-key]");
			const groupKey = groupEl?.dataset.groupKey;
			if (!groupKey) return;

			e.preventDefault();
			e.stopPropagation(); // S11

			if (groupKey.includes("|sub")) {
				// Subgroup
				const isSubOpen =
					expandedSections[groupKey] !== undefined
						? expandedSections[groupKey] === 1
						: true;
				if (e.key === "ArrowLeft" && isSubOpen) {
					setSectionCount(groupKey, 0);
				} else if (e.key === "ArrowRight" && !isSubOpen) {
					setSectionCount(groupKey, 1);
				}
			} else {
				// Group header
				const isCurrentlyOpen = isGroupOpen(
					groupKey,
					groupKey !== "__unassigned" && !groupKey.endsWith("__deleted"),
				);
				if (e.key === "ArrowLeft" && isCurrentlyOpen) {
					setGroupOpen((prev) => ({ ...prev, [groupKey]: false }));
				} else if (e.key === "ArrowRight" && !isCurrentlyOpen) {
					setGroupOpen((prev) => ({ ...prev, [groupKey]: true }));
				}
			}
		} else if (e.shiftKey && (e.key === "Delete" || e.key === "Backspace")) {
			// Shift+Delete: Permanent delete
			const targetId = highlightId ?? selectedSessionId;
			if (!targetId) return;
			e.preventDefault();
			e.stopPropagation(); // S11
			void requestDelete([targetId]);
		} else if (e.key === "Delete" || e.key === "Backspace") {
			// Delete: Archive session (S21, P12)
			const targetId = highlightId ?? selectedSessionId;
			if (!targetId) return;
			// P12: Delete/Backspace on an already archived row is a no-op
			if (sessions[targetId]?.archived) return;
			e.preventDefault();
			e.stopPropagation(); // S11
			requestArchive(targetId);
		} else if (e.key === "F2") {
			// F2: Rename (C16: only if rendered in DOM)
			const targetId = highlightId ?? selectedSessionId;
			if (!targetId) return;
			if (!document.getElementById(`session-row-${targetId}`)) return;
			e.preventDefault();
			e.stopPropagation(); // S11
			requestRename(targetId);
		} else if (
			(e.shiftKey && e.key === "F10") ||
			e.key === "ContextMenu"
		) {
			// Context menu key (C16: only if rendered in DOM)
			const targetId = highlightId ?? selectedSessionId;
			if (!targetId) return;
			if (!document.getElementById(`session-row-${targetId}`)) return;
			e.preventDefault();
			e.stopPropagation(); // S11
			requestRowMenu(targetId);
		}
	};

	// Shared header controls, rendered in one row (fullscreen / non-mac) or
	// split across two rows (windowed macOS — traffic lights need row one).
	const modeMeta = SPACE_MODE_META[activeMode];
	const ModeSwitcherIcon = modeMeta.icon;
	const modeSwitcherButton = (
		<button
			ref={modeSwitcherRef}
			type="button"
			aria-haspopup="menu"
			aria-expanded={modeMenuOpen}
			onClick={() => {
				setModeMenuOpen((v) => !v);
				setFilterPopoverOpen(false);
			}}
			className="group relative flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-[var(--bg-hover)]/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
			title={`${modeMeta.label} 模式 (点击切换)`}
		>
			<ModeSwitcherIcon size={16} className="shrink-0 text-indigo-400" />
			<span className="whitespace-nowrap text-[17px] font-semibold leading-none tracking-[-0.01em] text-neutral-50">
				{modeMeta.label}
			</span>
			<ChevronDown
				size={14}
				strokeWidth={2}
				className={clsx(
					"shrink-0 text-neutral-500 transition-transform group-hover:text-neutral-300",
					modeMenuOpen && "rotate-180 text-neutral-300",
				)}
			/>
			{otherActivity && (
				<ModeActivityDot activity={otherActivity} variant="dot" className="absolute -right-0.5 top-0.5" />
			)}
		</button>
	);
	const inboxButton = (
		<button
			type="button"
			onClick={() => setCenter("inbox")}
			aria-label="收件箱"
			title="收件箱"
			className={clsx(
				"relative flex h-7 w-7 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
				centerView === "inbox"
					? "bg-[var(--bg-active-fill)] text-indigo-400"
					: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
			)}
		>
			<Bell size={16} strokeWidth={1.5} />
			{inboxBadge > 0 && (
				<span className="absolute right-0.5 top-0.5 min-w-[13px] rounded-full bg-indigo-500 px-[3px] text-center font-mono text-[8.5px] font-medium leading-[13px] text-white">
					{inboxBadge > 99 ? "99+" : inboxBadge}
				</span>
			)}
		</button>
	);
	const searchButton = (
		<button
			type="button"
			onClick={() => {
				if (searchOpen && !searchQuery && !showArchived) {
					setSearchOpen(false);
				} else {
					setSearchOpen(true);
					setTimeout(() => searchInputRef.current?.focus(), 0);
				}
			}}
			aria-label="搜索"
			title="搜索会话、分支 (⌘F)"
			className={clsx(
				"flex h-7 w-7 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
				searchOpen || searchQuery
					? "bg-[var(--bg-active-fill)] text-neutral-100"
					: "text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
			)}
		>
			<Search size={16} strokeWidth={1.5} />
		</button>
	);
	const collapseButton = (
		<button
			type="button"
			onClick={toggleSidebar}
			className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-[var(--bg-hover)] hover:text-neutral-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
			title="收起左侧栏 (⌘B)"
		>
			<PanelLeftClose size={16} strokeWidth={1.5} />
		</button>
	);

	return (
		<aside className="@container flex h-full flex-col bg-transparent text-neutral-300 text-xs select-none">
			{/* Topbar: mode title + inbox/search/collapse in the draggable title-bar strip.
			    Windowed macOS splits it into two rows — row one keeps the h-10 window-chrome
			    line aligned with the center header and carries traffic lights + collapse;
			    row two carries the mode switcher + inbox/search. */}
			{trafficLightsVisible ? (
				<>
					<div
						data-tauri-drag-region
						className="flex h-10 shrink-0 items-center border-b border-[var(--border-divider)] px-2.5 select-none"
					>
						{/* Reserves room for the overlay traffic lights on the left. */}
						<div className="w-[64px] shrink-0" />
						<div className="ml-auto flex shrink-0 items-center" data-tauri-drag-region>
							{collapseButton}
						</div>
					</div>
					<div
						data-tauri-drag-region
						className="flex h-10 shrink-0 items-center border-b border-[var(--border-divider)] px-2.5 select-none"
					>
						<div className="flex min-w-0 flex-1 items-center gap-1" data-tauri-drag-region>
							{modeSwitcherButton}
							<div className="ml-auto flex shrink-0 items-center gap-1">
								{inboxButton}
								{searchButton}
							</div>
						</div>
					</div>
				</>
			) : (
				<div
					data-tauri-drag-region
					className="flex h-10 shrink-0 items-center border-b border-[var(--border-divider)] px-2.5 select-none"
				>
					<div className="flex min-w-0 flex-1 items-center gap-1" data-tauri-drag-region>
						{modeSwitcherButton}
						<div className="ml-auto flex shrink-0 items-center gap-1">
							{inboxButton}
							{searchButton}
							{collapseButton}
						</div>
					</div>
				</div>
			)}
			<div className="relative border-b border-[var(--border-divider)] bg-transparent px-2 pb-2 pt-1">

				{/* Search & Filter Bar: revealed by the search icon / ⌘F, or while a filter is active */}
				{(searchOpen || searchQuery || showArchived) && (
				<div className="mt-1.5 flex items-center gap-1.5">
					<div className="relative flex min-w-0 flex-1 items-center">
						<Search
							size={13}
							className="pointer-events-none absolute left-2.5 text-neutral-500"
						/>
						<input
							ref={searchInputRef}
							type="text"
							data-sidebar-search="true"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
							onKeyDown={(e) => {
								if (isComposing(e)) return;
								if (e.key === "ArrowDown") {
									e.preventDefault();
									scrollRef.current?.focus();
									const visibleIds = getVisibleSessionIds();
									if (visibleIds[0]) setHighlightId(visibleIds[0]);
								} else if (e.key === "Enter") {
									e.preventDefault();
									const visibleIds = getVisibleSessionIds();
									if (visibleIds[0]) selectSession(visibleIds[0]);
								} else if (e.key === "Escape") {
									claimEscape(e);
									if (searchQuery) setSearchQuery("");
									else setSearchOpen(false);
									scrollRef.current?.focus();
								}
							}}
							placeholder="搜索会话、分支..."
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
						ref={filterBtnRef}
						type="button"
						aria-haspopup="menu"
						aria-expanded={filterPopoverOpen}
						onClick={() => {
							setFilterPopoverOpen((v) => !v);
							setModeMenuOpen(false);
						}}
						className={clsx(
							"relative flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
							showArchived
								? "border-amber-500/40 bg-amber-500/15 text-amber-300"
								: "hairline bg-[var(--well-bg)] text-neutral-400 hover:bg-[var(--bg-hover)] hover:text-neutral-200",
						)}
						title="过滤与显示设置"
					>
						<SlidersHorizontal size={13} />
						{showArchived && (
							<span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />
						)}
					</button>
				</div>
				)}

				{/* First-class Navigation List (S22: real accessible buttons, no button-in-button) */}
				<div className="space-y-1 pt-1.5 pb-0.5">
					{/* 1. 新建会话 */}
					<div className="group flex h-9 items-center justify-between rounded-lg px-2.5 text-[14px] font-medium text-[var(--text)] transition-colors hover:bg-[var(--bg-hover)]">
						<button
							type="button"
							onClick={() => void startNewSession()}
							className="flex min-w-0 flex-1 items-center gap-3 self-stretch text-left focus-visible:outline-none focus-visible:underline"
							title="新建会话 (⌘N)"
						>
							<SquarePen
								size={17}
								strokeWidth={1.75}
								className="shrink-0 text-neutral-300 transition-colors group-hover:text-neutral-100"
							/>
							<span className="truncate">新建会话</span>
						</button>
						<span className="shrink-0 select-none font-mono text-[11px] text-neutral-400 opacity-0 transition-opacity group-hover:opacity-100 @max-[220px]:hidden">
							⌘N
						</span>
					</div>

					{/* 3. 定时任务 */}
					<button
						type="button"
						onClick={() => setCenter("schedules")}
						className={clsx(
							"group flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
							centerView === "schedules"
								? "bg-[var(--bg-active-fill)] font-semibold text-[var(--text)] shadow-xs hairline"
								: "font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]",
						)}
						title="定时任务"
					>
						<Clock
							size={17}
							strokeWidth={1.75}
							className={clsx(
								"shrink-0 transition-colors",
								centerView === "schedules"
									? "text-amber-400"
									: "text-neutral-400 group-hover:text-neutral-200",
							)}
						/>
						<span className="truncate">定时任务</span>
					</button>

					{/* 4. Skills 管理 */}
					<button
						type="button"
						onClick={() => setCenter("skills")}
						className={clsx(
							"group flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
							centerView === "skills"
								? "bg-[var(--bg-active-fill)] font-semibold text-[var(--text)] shadow-xs hairline"
								: "font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]",
						)}
						title="Skills 管理"
					>
						<Boxes
							size={17}
							strokeWidth={1.75}
							className={clsx(
								"shrink-0 transition-colors",
								centerView === "skills"
									? "text-emerald-400"
									: "text-neutral-400 group-hover:text-neutral-200",
							)}
						/>
						<span className="truncate">Skills 管理</span>
					</button>
				</div>

				{/* Space Mode Switcher Dropdown (anchored to the header, 8px gutter + 32px title row + 4px gap) */}
				{modeMenuOpen && (
					<div
						ref={modeMenuRef}
						className="absolute left-2 top-1 z-(--z-popover) max-h-[70vh] w-[200px] overflow-y-auto rounded-xl border border-[var(--border-divider)] vibrancy-popover p-1.5 text-xs text-neutral-300 shadow-apple-modal backdrop-blur-2xl"
					>
					<MenuContainer
						ariaLabel="切换模式"
						onClose={() => setModeMenuOpen(false)}
						triggerRef={modeSwitcherRef}
					>
						<div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
							切换模式
						</div>
						{SPACE_MODES.map((mode) => {
							const meta = SPACE_MODE_META[mode];
							const ModeIcon = meta.icon;
							const isSelected = mode === activeMode;
							return (
								<button
									key={mode}
									type="button"
									role="menuitem"
									onClick={() => {
										switchSpaceMode(mode);
										setModeMenuOpen(false);
									}}
									className={clsx(
										"flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors",
										isSelected
											? "bg-[var(--bg-hover)] font-medium text-[var(--text)]"
											: "text-[var(--text-muted)] hover:bg-[var(--bg-hover)]/60 hover:text-[var(--text)]",
									)}
								>
									<div className="flex items-center gap-2">
										<ModeIcon
											size={13}
											className={clsx(
												isSelected ? "text-indigo-400" : "text-neutral-400",
											)}
										/>
										<span>{meta.label}</span>
									</div>
									{isSelected ? (
										<Check size={13} className="text-indigo-400" />
									) : (
										<ModeActivityDot activity={modeActivity[mode]} />
									)}
								</button>
							);
						})}
						<div className="px-2 pt-1.5 pb-0.5 text-[10px] leading-4 text-neutral-600">
							每个模式有独立的项目与会话；Universal 不属于任何项目
						</div>
					</MenuContainer>
					</div>
				)}
			</div>

			{/* Filter Popover */}
			{filterPopoverOpen && filterBtnRef.current && (
				<FloatingLayer
					anchor={filterBtnRef.current}
					placement="bottom-end"
					offset={4}
					layer="popover"
					ignoreRefs={[filterBtnRef]}
					onDismiss={() => setFilterPopoverOpen(false)}
					className="w-56 p-2 text-xs text-neutral-300"
				>
					<div
						role="menu"
						aria-label="显示与过滤"
						className="space-y-0.5 focus:outline-none"
					>
						<div className="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500">
							显示与过滤
						</div>
						<button
							type="button"
							role="menuitem"
							onClick={() => setShowArchived(!showArchived)}
							className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left transition-colors hover:bg-neutral-800"
						>
							<div className="flex items-center gap-2">
								<Archive size={13} className="text-amber-400" />
								<span>显示已归档会话</span>
							</div>
							{showArchived && <Check size={13} className="text-indigo-400" />}
						</button>
						<div className="my-1 border-t border-neutral-800" />
						<button
							type="button"
							role="menuitem"
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
				</FloatingLayer>
			)}

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

			{/* Session Groups Scroll Area: listbox with visible ring */}
			<div
				ref={scrollRef}
				tabIndex={0}
				role="listbox"
				aria-activedescendant={highlightId ? `session-row-${highlightId}` : undefined}
				{...{ [SIDEBAR_LIST_ATTR]: "true" }}
				onFocus={(e) => {
					// K2: when list container receives focus and nothing is highlighted,
					// highlight selected row or first visible row so per-row ring is the only focus indicator
					if (e.target === e.currentTarget && !useUi.getState().highlightId) {
						const currentSelected = useUi.getState().selectedSessionId;
						if (currentSelected) {
							setHighlightId(currentSelected);
						} else {
							const visibleIds = getVisibleSessionIds();
							if (visibleIds.length > 0) {
								setHighlightId(visibleIds[0]);
							}
						}
					}
				}}
				onKeyDown={handleListKeyDown}
				onPointerEnter={() => {
					if (lastGroupedRef.current) {
						setFrozenOrder(snapshotOrder(lastGroupedRef.current));
					}
				}}
				onPointerLeave={() => {
					setFrozenOrder(undefined);
				}}
				className="group/list flex-1 overflow-y-auto divide-y divide-neutral-800/40 pb-8 focus:outline-none"
			>
				{loadState === "error" && (
					<LoadFailed what="会话列表" error={storeLoadError} onRetry={() => void loadSessions().catch(() => {})} />
				)}
				{/* Cold-start skeleton rows */}
				{loadState === "loading" && (
					<div className="p-2 space-y-3 animate-pulse" role="status">
						<div className="px-1 text-[11px] text-neutral-500">正在加载中</div>
						<div className="flex items-center gap-2 mb-2 px-1">
							<div className="h-3.5 bg-neutral-800/80 rounded w-20" />
							<div className="h-3.5 bg-neutral-800/40 rounded w-5 ml-auto" />
						</div>
						{[1, 2, 3, 4, 5].map((i) => (
							<div
								key={i}
								className="flex flex-col gap-1.5 px-2 py-1.5 rounded bg-neutral-800/20"
							>
								<div className="flex items-center gap-2">
									<div className="h-2 w-2 rounded-full bg-neutral-700/80 shrink-0" />
									<div className="h-2.5 w-6 rounded bg-neutral-700/60 shrink-0" />
									<div
										className="h-2.5 rounded bg-neutral-700/50"
										style={{ width: `${60 + (i % 3) * 25}px` }}
									/>
									<div className="h-2 w-8 rounded bg-neutral-800 ml-auto shrink-0" />
								</div>
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
								<GroupHeader
									groupKey="__pinned"
									title="已置顶"
									icon={
										<Pin
											size={13}
											className="text-amber-500 dark:text-amber-400 fill-amber-500/30 shrink-0"
										/>
									}
									isOpen={isGroupOpen("__pinned", true)}
									onToggle={() => toggleGroup("__pinned", true)}
									statusCounts={getGroupStatusCounts(grouped.pinnedSessions)}
								/>

								{isGroupOpen("__pinned", true) && (
									<div className="pb-1 ml-[14px]" data-group-key="__pinned">
										<div className="ml-[8px] pl-2 my-0.5">
											<SessionList
												sessions={grouped.pinnedSessions}
												scopeKey="__pinned"
												searching={searching}
												onSetCount={setSectionCount}
												expanded={expandedSections}
												workspaces={workspaces}
												onRowFocus={focusList}
												onBatchAction={handleBatchAction}
												withSpine
											/>
										</div>
									</div>
								)}
							</div>
						)}

						{/* 1. 无项目 area: the active mode's isolated global-workspace
						    sessions — ungrouped rows + user SessionGroups (§Spaces). */}
						{showLoose && (() => {
							return (
							<div className="mt-0.5">

									<div className="pb-1" data-group-key="__global">
										{/* Ungrouped 无项目 sessions */}
										{noProjectSplit.ungrouped.length > 0 && (
											<div className="space-y-1 px-2 my-0.5">
												<SessionList
													sessions={noProjectSplit.ungrouped}
													scopeKey="__global"
													searching={searching}
													onSetCount={setSectionCount}
													expanded={expandedSections}
													workspaces={workspaces}
													onRowFocus={focusList}
													onBatchAction={handleBatchAction}
													large
												/>
											</div>
										)}
										{noProjectSplit.ungrouped.length === 0 &&
											modeGroups.length === 0 &&
											!searching && (
												<div className="ml-[8px] px-2 py-1 text-[11px] text-[var(--text-dim)] italic">
													暂无会话
												</div>
											)}

										{/* User session groups of this mode */}
										{modeGroups.map((g) => {
											const grpSessions = noProjectSplit.byGroup[g.id] ?? [];
											const grpKey = `grp:${g.id}`;
											const grpOpen = isGroupOpen(grpKey, true);
											const grpCreating =
												globalWs && creatingKey === `${globalWs.id}|${globalWs.path}`;
											return (
												<div key={g.id} className="mt-0.5">
													{renamingGroupId === g.id ? (
														<div className="mx-1 px-1.5 py-1">
															<input
																ref={groupRenameInputRef}
																autoFocus
																type="text"
																value={groupNameDraft}
																onClick={(e) => e.stopPropagation()}
																onChange={(e) => setGroupNameDraft(e.target.value)}
																onBlur={() => {
																	if (groupEditInFlight.current) return;
																	void handleRenameGroup(g);
																}}
																onKeyDown={(e) => {
																	if (isComposing(e)) return;
																	if (e.key === "Enter") {
																		e.preventDefault();
																		void handleRenameGroup(g);
																	} else if (e.key === "Escape") {
																		claimEscape(e);
																		// Swallow the blur that follows unmount so
																		// Escape cancels instead of committing.
																		groupEditInFlight.current = true;
																		setRenamingGroupId(null);
																		window.setTimeout(() => {
																			groupEditInFlight.current = false;
																		}, 0);
																	}
																}}
																className="h-6 w-full rounded border border-[var(--primary)] bg-[var(--well-bg)] px-1.5 text-xs font-bold text-[var(--text)] outline-none"
															/>
														</div>
													) : (
														<GroupHeader
															groupKey={grpKey}
															title={g.name}
															icon={
																<Tag
																	size={13}
																	className="text-[var(--text-dim)] shrink-0"
																/>
															}
															isOpen={grpOpen}
															onToggle={() => toggleGroup(grpKey, true)}
															statusCounts={getGroupStatusCounts(grpSessions)}
															onContextMenu={(e) => handleGroupContextMenu(g, e)}
															actionButton={
																<div className="flex items-center shrink-0 ml-1">
																	<button
																		type="button"
																		onClick={(e) => {
																			e.stopPropagation();
																			if (globalWs)
																				void startSessionInDir(globalWs, false, g.id);
																		}}
																		title="在分组内新建会话"
																		disabled={!globalWs || creatingKey !== null}
																		className="rounded p-1 text-[var(--text-dim)] opacity-50 hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] disabled:opacity-40 shrink-0 transition-all duration-150 ease-out focus:opacity-100 focus-visible:opacity-100"
																	>
																		{grpCreating ? (
																			<Loader2 size={13} className="animate-spin" />
																		) : (
																			<Plus size={13} />
																		)}
																	</button>
																	<button
																		type="button"
																		onClick={(e) => {
																			e.stopPropagation();
																			const el = e.currentTarget as HTMLElement;
																			grpMenuTriggerRef.current = el;
																			setGrpMenu((prev) =>
																				prev?.group.id === g.id
																					? null
																					: { group: g, anchor: el },
																			);
																		}}
																		title="分组操作"
																		className="rounded p-1 text-[var(--text-dim)] opacity-50 hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text)] shrink-0 transition-all duration-150 ease-out focus:opacity-100 focus-visible:opacity-100"
																	>
																		<MoreHorizontal size={13} />
																	</button>
																</div>
															}
														/>
													)}
													{grpOpen && (
														<div className="pb-1 ml-[14px]" data-group-key={grpKey}>
															{grpSessions.length > 0 ? (
																<div className="ml-[8px] pl-2 my-0.5">
																	<SessionList
																		sessions={grpSessions}
																		scopeKey={grpKey}
																		searching={searching}
																		onSetCount={setSectionCount}
																		expanded={expandedSections}
																		workspaces={workspaces}
																		onRowFocus={focusList}
																		onBatchAction={handleBatchAction}
																		withSpine
																	/>
																</div>
															) : (
																!searching && (
																	<div className="ml-[22px] px-2 py-1 text-[11px] text-[var(--text-dim)] italic">
																		暂无会话
																	</div>
																)
															)}
														</div>
													)}
												</div>
											);
										})}

										{/* + 新建分组 inline entry */}
										{newGroupOpen ? (
											<div className="mx-1 mt-0.5 px-1.5 py-1">
												<input
													ref={newGroupInputRef}
													autoFocus
													type="text"
													value={newGroupName}
													placeholder="分组名称"
													onClick={(e) => e.stopPropagation()}
													onChange={(e) => setNewGroupName(e.target.value)}
													onBlur={() => {
														if (groupEditInFlight.current) return;
														if (newGroupName.trim()) void handleCreateGroup();
														else setNewGroupOpen(false);
													}}
													onKeyDown={(e) => {
														if (isComposing(e)) return;
														if (e.key === "Enter") {
															e.preventDefault();
															void handleCreateGroup();
														} else if (e.key === "Escape") {
															claimEscape(e);
															// Swallow the blur that follows unmount so
															// Escape cancels instead of creating.
															groupEditInFlight.current = true;
															setNewGroupOpen(false);
															setNewGroupName("");
															window.setTimeout(() => {
																groupEditInFlight.current = false;
															}, 0);
														}
													}}
													className="h-6 w-full rounded border border-[var(--primary)] bg-[var(--well-bg)] px-1.5 text-xs text-[var(--text)] outline-none"
												/>
											</div>
										) : (
											<button
												type="button"
												onClick={(e) => {
													e.stopPropagation();
													setNewGroupName("");
													setNewGroupOpen(true);
												}}
												className="mt-0.5 flex w-[calc(100%-8px)] items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-hover)] hover:text-[var(--text)] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
											>
												<Plus size={12} className="shrink-0" />
												<span>新建分组</span>
											</button>
										)}
									</div>
							</div>
							);
						})()}

						{showProjects && (
						<>
						{/* 2. 项目 section header: 「添加工作区目录…」 lands in the CURRENT space */}
						<div className="mx-1 mt-1 flex items-center justify-between rounded-md px-2 py-1">
							<span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-dim)]">
								项目
							</span>
							<button
								type="button"
								onClick={() => void handleAddWorkspace()}
								title="添加工作区目录…"
								className="rounded p-1 text-[var(--text-dim)] opacity-50 hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] shrink-0 transition-all duration-150 ease-out focus:opacity-100 focus-visible:opacity-100"
							>
								<Plus size={13} />
							</button>
						</div>

						{/* 3. Registered Project Workspaces */}
						{grouped.workspaceGroups.map((wg) => {
									const palette = getWorkspacePalette(
										wg.workspace.id || wg.workspace.name,
									);
									const isOpen = isGroupOpen(wg.workspace.id, true);
									const statusCounts = getGroupStatusCounts(wg.subgroups);
									const isCreatingHeader =
										creatingKey === `${wg.workspace.id}|${wg.workspace.path}`;

									return (
										<div key={wg.workspace.id} className="mt-0.5">
											<GroupHeader
												groupKey={wg.workspace.id}
												title={wg.workspace.name}
												icon={
													isOpen ? (
														<FolderOpen
															size={14}
															className={clsx("shrink-0", palette.folderColor)}
														/>
													) : (
														<Folder
															size={14}
															className={clsx("shrink-0", palette.folderColor)}
														/>
													)
												}
												titleElement={
													<HoverScrollText
														text={wg.workspace.name}
														className="font-bold text-[12.5px] text-[var(--text)] min-w-0 flex-1"
														title={wg.workspace.name}
													/>
												}
												isOpen={isOpen}
												onToggle={() => toggleGroup(wg.workspace.id, true)}
												statusCounts={statusCounts}
												onContextMenu={(e) =>
													handleWorkspaceContextMenu(wg.workspace, e)
												}
												actionButton={
													<button
														type="button"
														onClick={(e) => handlePlusClick(wg.workspace, e)}
														title="新建会话（选择当前目录或独立工作树）"
														disabled={creatingKey !== null}
														className="rounded p-1 text-[var(--text-dim)] opacity-50 hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] disabled:opacity-40 shrink-0 transition-all duration-150 ease-out focus:opacity-100 focus-visible:opacity-100"
													>
														{isCreatingHeader ? (
															<Loader2 size={13} className="animate-spin" />
														) : (
															<Plus size={13} />
														)}
													</button>
												}
											/>

											{/* Workspace Group Body */}
											{isOpen && (() => {
												const liveSubs = wg.subgroups.filter((s) => !s.deleted && s.sessions.length > 0);
												const emptySubs = wg.subgroups.filter((s) => !s.deleted && s.sessions.length === 0);
												const isTrulyEmpty =
													wg.totalCount === 0 &&
													(wg.pinnedCount ?? 0) === 0 &&
													liveSubs.length === 0 &&
													emptySubs.length === 0 &&
													wg.deletedSubgroups.length === 0;
												return (
												<div className="pb-1" data-group-key={wg.workspace.id}>
													{isTrulyEmpty ? (
														<div className="px-6 py-2 text-[11px] text-[var(--text-dim)] italic">
															暂无会话
														</div>
													) : (
														<>
															{liveSubs.length > 1 ||
															(liveSubs[0] && liveSubs[0].kind !== "default" && !liveSubs[0].isMain) ? (
																liveSubs.map((sub) => (
																	<CollapsibleSubgroup
																		key={sub.key}
																		sub={sub}
																		scopeKey={`${wg.workspace.id}|${sub.key}`}
																		searching={searching}
																		onSetCount={setSectionCount}
																		expanded={expandedSections}
																		onToggle={toggleSection}
																		onBatchArchive={() =>
																			void batchArchiveSessions(
																				sub.label,
																				sub.sessions,
																			)
																		}
																		workspaces={workspaces}
																		onRowFocus={focusList}
																		onBatchAction={handleBatchAction}
																		ws={wg.workspace}
																		onCreateSession={startSessionAt}
																		creatingKey={creatingKey}
																	/>
																))
															) : (
																<div className="ml-[22px] pl-2 my-0.5">
																	<SessionList
																		sessions={liveSubs[0]?.sessions ?? []}
																		scopeKey={`${wg.workspace.id}|default`}
																		searching={searching}
																		onSetCount={setSectionCount}
																		expanded={expandedSections}
																		workspaces={workspaces}
																		onRowFocus={focusList}
																		onBatchAction={handleBatchAction}
																		withSpine
																		recentLimit={NO_WORKTREE_RECENT_LIMIT}
																	/>
																</div>
															)}
															<EmptyWorktreesFolder
																folderKey={`${wg.workspace.id}|__empty`}
																ws={wg.workspace}
																subgroups={emptySubs}
																searching={searching}
																isOpen={isGroupOpen(
																	`${wg.workspace.id}|__empty`,
																	false,
																)}
																onToggle={() =>
																	toggleGroup(
																		`${wg.workspace.id}|__empty`,
																		false,
																	)
																}
																expanded={expandedSections}
																onToggleSection={toggleSection}
																onSetCount={setSectionCount}
																workspaces={workspaces}
																onRowFocus={focusList}
																onBatchAction={handleBatchAction}
																onCreateSession={startSessionAt}
																creatingKey={creatingKey}
															/>
															<DeletedWorktreesFolder
																folderKey={`${wg.workspace.id}|__deleted`}
																ws={wg.workspace}
																subgroups={wg.deletedSubgroups}
																searching={searching}
																isOpen={isGroupOpen(
																	`${wg.workspace.id}|__deleted`,
																	false,
																)}
																onToggle={() =>
																	toggleGroup(
																		`${wg.workspace.id}|__deleted`,
																		false,
																	)
																}
																onBatchArchive={batchArchiveSessions}
																expanded={expandedSections}
																onToggleSection={toggleSection}
																onSetCount={setSectionCount}
																workspaces={workspaces}
																onRowFocus={focusList}
																onBatchAction={handleBatchAction}
																onCreateSession={startSessionAt}
																creatingKey={creatingKey}
															/>
														</>
													)}
												</div>
												);
											})()}
										</div>
									);
								})}

								{/* 3. Unassigned Bucket (G15: per-cwd subgroups under UNASSIGNED_LABEL) */}
								{(grouped.unassigned.length > 0 ||
									(grouped.unassignedGroups &&
										grouped.unassignedGroups.length > 0)) && (
									<div className="mt-0.5">
										<GroupHeader
											groupKey="__unassigned"
											title={UNASSIGNED_LABEL}
											icon={
												<FolderSearch
													size={14}
													className="text-[var(--text-dim)] shrink-0"
												/>
											}
											isOpen={isGroupOpen("__unassigned", false)}
											onToggle={() => toggleGroup("__unassigned", false)}
											statusCounts={getGroupStatusCounts(grouped.unassigned)}
										/>

										{isGroupOpen("__unassigned", false) && (() => {
											// Cap rendered directory subgroups (user: bucket can hold
											// hundreds of sessions across dozens of directories).
											const UNASSIGNED_DIR_LIMIT = 10;
											const UNASSIGNED_DIR_STEP = 10;
											const dirMoreKey = "__unassigned|dir_more";
											const dirGroups = grouped.unassignedGroups ?? [];
											const visibleDirCount = Math.min(
												Math.max(
													expandedSections[dirMoreKey] ?? UNASSIGNED_DIR_LIMIT,
													UNASSIGNED_DIR_LIMIT,
												),
												dirGroups.length,
											);
											const hiddenDirs = dirGroups.length - visibleDirCount;
											const shownDirs = searching
												? dirGroups
												: dirGroups.slice(0, visibleDirCount);
											return (
											<div className="pb-1" data-group-key="__unassigned">
												{dirGroups.length > 0 ? (
													shownDirs.map((grp) => {
														const subKey = `__unassigned|${grp.key}`;
														// Default collapsed so the bucket renders as a
														// compact list of directory headers, not a wall
														// of session rows ("线性堆叠太多").
														const isSubOpen = searching || isGroupOpen(subKey, false);
														return (
															<UnassignedDirSubgroup
																key={grp.key}
																grp={grp}
																subKey={subKey}
																searching={searching}
																isSubOpen={isSubOpen}
																onToggle={() => toggleGroup(subKey, false)}
																onSetCount={setSectionCount}
																expanded={expandedSections}
																workspaces={workspaces}
																onRowFocus={focusList}
																onBatchAction={handleBatchAction}
																onArchive={() =>
																	void batchArchiveSessions(grp.label, grp.sessions)
																}
																onAddWorkspace={async () => {
																	try {
																		await addWorkspace(grp.cwd, activeMode);
																		await loadSessions();
																		toast.success(`已添加工作区「${grp.label}」`);
																	} catch (err) {
																		toast.error(`添加工作区失败: ${errMsg(err)}`);
																	}
																}}
															/>
														);
													})
												) : (
													<div className="ml-[22px] pl-2 my-0.5">
														<SessionList
															sessions={grouped.unassigned}
															scopeKey="__unassigned"
															searching={searching}
															onSetCount={setSectionCount}
															expanded={expandedSections}
															workspaces={workspaces}
															onRowFocus={focusList}
															onBatchAction={handleBatchAction}
															withSpine
														/>
													</div>
												)}
												{dirGroups.length > UNASSIGNED_DIR_LIMIT && !searching && (
													<div className="flex items-center py-1.5 px-3 ml-[14px] text-[11px] font-medium select-none">
														<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
														{hiddenDirs > 0 && (
															<button
																type="button"
																onClick={() =>
																	setSectionCount(dirMoreKey, visibleDirCount + UNASSIGNED_DIR_STEP)
																}
																className="flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
															>
																<Plus size={11} className="shrink-0" />
																<span>
																	展开 {Math.min(UNASSIGNED_DIR_STEP, hiddenDirs)} 个目录
																</span>
															</button>
														)}
														{hiddenDirs > 0 && visibleDirCount > UNASSIGNED_DIR_LIMIT && (
															<span className="mx-1.5 text-[var(--text-dim)] opacity-40">｜</span>
														)}
														{visibleDirCount > UNASSIGNED_DIR_LIMIT && (
															<button
																type="button"
																onClick={() => setSectionCount(dirMoreKey, UNASSIGNED_DIR_LIMIT)}
																className="flex items-center gap-0.5 rounded-md px-2 py-1 text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
															>
																<ChevronDown size={11} className="shrink-0 rotate-180" />
																<span>收起</span>
															</button>
														)}
														<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
													</div>
												)}
												{/* Bucket-wide actions live in a footer instead of the
												 * header — header icons crowded the row (user feedback). */}
												<div className="flex items-center py-1.5 px-3 ml-[14px] text-[11px] font-medium select-none">
													<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
													<button
														type="button"
														onClick={() =>
															void batchArchiveSessions(
																UNASSIGNED_LABEL,
																grouped.unassigned,
															)
														}
														className="flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] hover:text-amber-300 hover:bg-[var(--bg-hover)] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
													>
														<Archive size={11} className="shrink-0" />
														<span className="whitespace-nowrap">全部归档 ({grouped.unassigned.length})</span>
													</button>
													<span className="mx-1.5 text-[var(--text-dim)] opacity-40">｜</span>
													<button
														type="button"
														onClick={() =>
															requestAssign(grouped.unassigned.map((s) => s.id))
														}
														className="flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
													>
														<FolderInput size={11} className="shrink-0" />
														<span className="whitespace-nowrap">归入工作区…</span>
													</button>
													<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
												</div>
											</div>
											);
										})()}
									</div>
								)}

								{/* 4. Deleted Worktrees Bucket: DELETED_LABEL */}
								{grouped.deletedSessions.length > 0 && (
									<div className="mt-0.5 opacity-60 hover:opacity-100 transition-opacity">
										<GroupHeader
											groupKey="__deleted"
											title={DELETED_LABEL}
											icon={
												<FolderGit2
													size={14}
													className="text-[var(--text-dim)] shrink-0"
												/>
											}
											isOpen={isGroupOpen("__deleted", false)}
											onToggle={() => toggleGroup("__deleted", false)}
											statusCounts={getGroupStatusCounts(
												grouped.deletedSessions,
											)}
											actionButton={
												<button
													type="button"
													onClick={(e) => {
														e.stopPropagation();
														void batchArchiveSessions(
															DELETED_LABEL,
															grouped.deletedSessions,
														);
													}}
													className="mr-1 rounded p-1 text-neutral-500 opacity-50 hover:opacity-100 hover:bg-neutral-700/60 hover:text-amber-300 focus:opacity-100 transition-opacity"
													title="一键归档全部已清理工作树的会话"
												>
													<Archive size={12} />
												</button>
											}
										/>

										{isGroupOpen("__deleted", false) && (
											<div className="pb-1" data-group-key="__deleted">
												<div className="ml-[22px] pl-2 my-0.5">
													<SessionList
														sessions={grouped.deletedSessions}
														scopeKey="__deleted"
														searching={searching}
														onSetCount={setSectionCount}
														expanded={expandedSections}
														workspaces={workspaces}
														onRowFocus={focusList}
														onBatchAction={handleBatchAction}
														withSpine
													/>
												</div>
											</div>
										)}
									</div>
								)}

						</>
						)}
						{/* Search with 0 hits or Empty State (G11, S20) */}
						{grouped.totalVisible === 0 && showProjects && (
							<div className="flex flex-col items-center justify-center p-6 text-center text-neutral-500">
								{searchQuery ? (
									(() => {
										// Search is scoped to the active space; archived matches
										// of this mode get a one-click hint.
										const modeSessionList = Object.values(sessions).filter(
											(s) => s.mode === activeMode,
										);
										const allMatches = filterSessions(modeSessionList, {
											searchQuery,
											showArchived: true,
										});
										const archivedMatches = allMatches.filter((s) => s.archived);

										return (
											<div className="space-y-2">
												<Search size={24} className="mx-auto text-neutral-600" />
												<div className="text-xs">未找到匹配会话</div>
												{archivedMatches.length > 0 && !showArchived && (
													<button
														type="button"
														onClick={() => setShowArchived(true)}
														className="block mx-auto text-[11px] text-amber-400 hover:underline"
													>
														含归档 {archivedMatches.length} 条 · 显示归档
													</button>
												)}
												<button
													type="button"
													onClick={() => setSearchQuery("")}
													className="block mx-auto mt-2 text-[11px] text-neutral-400 hover:underline"
												>
													清空搜索条件
												</button>
											</div>
										);
									})()
								) : Object.keys(sessions).length === 0 && loadError ? (
									// P5: retryable inline error block when loading failed
									<div className="space-y-2">
										<AlertCircle size={24} className="mx-auto text-rose-500" />
										<div className="text-xs font-medium text-rose-300">
											加载会话列表失败
										</div>
										<div className="text-[11px] text-neutral-400">
											{loadError}
										</div>
										<button
											type="button"
											onClick={async () => {
												setLoadError(null);
												setErrorMessage(null);
												try {
													await loadSessions();
												} catch (err) {
													const msg = errMsg(err);
													setLoadError(msg);
													setErrorMessage(`加载会话列表失败: ${msg}`);
												}
											}}
											className="mt-3 flex items-center gap-1.5 rounded-md border border-neutral-700/60 bg-neutral-800/90 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700/80 transition-colors shadow-sm mx-auto"
										>
											重试
										</button>
									</div>
								) : grouped.workspaceGroups.length === 0 ? (
									// S20: per-space empty state — the mode owns nothing yet
									<div className="w-full space-y-1 text-left">
										<div className="px-2 text-[12px] text-neutral-500">
											这个模式还没有会话
										</div>
										<button
											type="button"
											onClick={() => void handleAddWorkspace()}
											className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text)]"
										>
											<FolderPlus size={15} strokeWidth={1.75} className="shrink-0" />
											<span className="truncate">添加项目目录</span>
										</button>
									</div>
								) : null}
							</div>
						)}
					</>
				)}
			</div>

			{/* Undo bar for recent archive (Contract 4, S25) */}
			<ArchiveUndoBar />

			{/* Settings footer (S18: single accessible button) */}
			<div className="shrink-0 p-2">
				<button
					type="button"
					onClick={() =>
						centerView === "settings" ? closeSettings() : openSettings()
					}
					className={clsx(
						"group flex h-9 w-full items-center gap-3 rounded-lg px-2.5 text-left text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]",
						centerView === "settings"
							? "bg-[var(--bg-active-fill)] font-semibold text-[var(--text)] shadow-xs hairline"
							: "font-medium text-[var(--text)] hover:bg-[var(--bg-hover)]",
					)}
					title="设置"
				>
					<SettingsIcon
						size={17}
						strokeWidth={1.75}
						className={clsx(
							"shrink-0 transition-colors",
							centerView === "settings"
								? "text-neutral-100"
								: "text-neutral-400 group-hover:text-neutral-200",
						)}
					/>
					<span className="truncate">设置</span>
				</button>
			</div>

			{/* Popover: "+" New Session Options (S28: ignoreRefs to toggle itself) */}
			{plusMenu && (
				<FloatingLayer
					anchor={plusMenu.anchor}
					placement="bottom-start"
					offset={4}
					layer="menu"
					ignoreRefs={plusTriggerRef.current ? [plusTriggerRef] : undefined}
					onDismiss={() => setPlusMenu(null)}
					className="w-48 py-1 text-xs text-neutral-300"
				>
					<MenuContainer
						ariaLabel="新建会话选项"
						onClose={() => setPlusMenu(null)}
						triggerRef={plusTriggerRef}
					>
						<div className="px-3 py-1 text-[10px] text-neutral-500 font-semibold uppercase tracking-wider">
							新建会话
						</div>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								const ws = plusMenu.ws;
								setPlusMenu(null);
								void startSessionInDir(ws, false);
							}}
							disabled={creatingKey !== null}
							className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left disabled:opacity-40"
						>
							<Folder size={13} className="text-amber-400" />
							在当前目录创建
						</button>

						{plusMenu.ws.kind !== "global" && groupByWorktree && (() => {
							const liveWts =
								useWorktrees.getState().byWorkspace[plusMenu.ws.id] ?? [];
							const hasGitWorktrees = liveWts.length > 0;

							return (
								<button
									type="button"
									role="menuitem"
									disabled={!hasGitWorktrees || creatingKey !== null}
									onClick={() => {
										const ws = plusMenu.ws;
										setPlusMenu(null);
										useUi.getState().openModal("new-session", {
											workspaceId: ws.id,
											cwd: ws.path,
											useWorktree: true,
										});
									}}
									className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left disabled:opacity-40 disabled:hover:bg-transparent"
									title={
										!hasGitWorktrees
											? "该工作区无 Git 仓库支持独立工作树"
											: undefined
									}
								>
									<FolderGit2 size={13} className="text-indigo-400" />
									在独立工作树创建
								</button>
							);
						})()}
					</MenuContainer>
				</FloatingLayer>
			)}

			{/* Context menu: Workspace header */}
			{wsMenu && (
				<FloatingLayer
					anchor={wsMenu.anchor}
					placement="bottom-start"
					offset={4}
					layer="menu"
					onDismiss={() => setWsMenu(null)}
					className="w-44 py-1 text-xs text-neutral-300"
				>
					<MenuContainer
						ariaLabel="工作区管理"
						onClose={() => setWsMenu(null)}
						triggerRef={wsMenuTriggerRef}
					>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								const ws = wsMenu.ws;
								setWsMenu(null);
								void startSessionInDir(ws, false);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
						>
							<Plus size={13} />
							新建会话…
						</button>

						<button
							type="button"
							role="menuitem"
							onClick={() => void handleRevealWorkspace(wsMenu.ws)}
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
									role="menuitem"
									onClick={() => void handleRemoveWorkspace(wsMenu.ws)}
									className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--status-error)] hover:bg-rose-500/15 text-left"
								>
									<Trash2 size={13} />
									从工作区中移除
								</button>
							</>
						)}
					</MenuContainer>
				</FloatingLayer>
			)}

			{/* Context menu: SessionGroup header (⋯ button / right-click) */}
			{grpMenu && (
				<FloatingLayer
					anchor={grpMenu.anchor}
					placement="bottom-start"
					offset={4}
					layer="menu"
					ignoreRefs={grpMenuTriggerRef.current ? [grpMenuTriggerRef] : undefined}
					onDismiss={() => setGrpMenu(null)}
					className="w-44 py-1 text-xs text-neutral-300"
				>
					<MenuContainer
						ariaLabel="分组操作"
						onClose={() => setGrpMenu(null)}
						triggerRef={grpMenuTriggerRef}
					>
						<button
							type="button"
							role="menuitem"
							onClick={() => {
								const g = grpMenu.group;
								setGrpMenu(null);
								setGroupNameDraft(g.name);
								setRenamingGroupId(g.id);
							}}
							className="flex w-full items-center gap-2 px-3 py-1.5 hover:bg-neutral-800 hover:text-neutral-100 text-left"
						>
							<Pencil size={13} />
							重命名
						</button>
						<button
							type="button"
							role="menuitem"
							onClick={() => void handleDeleteGroup(grpMenu.group)}
							className="flex w-full items-center gap-2 px-3 py-1.5 text-[var(--status-error)] hover:bg-rose-500/15 text-left"
						>
							<Trash2 size={13} />
							删除分组
						</button>
					</MenuContainer>
				</FloatingLayer>
			)}

			{/* Global dialogs rendered portaled once (Contract 3, S7) */}
			<SessionDialogs />
		</aside>
	);
}

interface SessionListProps {
	sessions: SessionMeta[];
	scopeKey: string;
	searching: boolean;
	expanded: Record<string, number>;
	onSetCount: (key: string, count: number) => void;
	withSpine?: boolean;
	large?: boolean;
	recentLimit?: number;
	workspaces: Workspace[];
	onRowFocus?: () => void;
	onBatchAction: (action: "archive" | "pin" | "delete", ids: string[]) => void;
}

/**
 * Renders a list of sessions with progressive disclosure and attention-row pinning (G5).
 */
function SessionList({
	sessions,
	scopeKey,
	searching,
	withSpine = false,
	large = false,
	recentLimit = RECENT_LIMIT,
	expanded,
	onSetCount,
	workspaces,
	onRowFocus,
	onBatchAction,
}: SessionListProps) {
	const selectedSessionId = useUi((s) => s.selectedSessionId);

	const SEARCH_LIMIT = 8;
	const SEARCH_STEP = 10;
	const limit = searching ? SEARCH_LIMIT : recentLimit;
	const step = searching ? SEARCH_STEP : RECENT_STEP;

	const moreKey = `${scopeKey}|more`;
	const visibleCount = Math.min(
		Math.max(expanded[moreKey] ?? limit, limit),
		sessions.length,
	);

	// G5, P4: Rows beyond the limit remain rendered if needsAttention(s) or s.id === selectedSessionId
	const isRowRendered = (s: SessionMeta, idx: number) =>
		idx < visibleCount || needsAttention(s) || s.id === selectedSessionId;

	const renderedSessions = sessions.filter(isRowRendered);
	const hiddenCount = sessions.length - renderedSessions.length;

	// C17: 展开 N 条 label = number of not-yet-rendered rows that the click will reveal
	const nextVisibleCount = Math.min(visibleCount + step, sessions.length);
	const newlyRevealedInWindow = sessions
		.slice(visibleCount, nextVisibleCount)
		.filter((s) => !needsAttention(s) && s.id !== selectedSessionId).length;
	const expandable =
		newlyRevealedInWindow > 0
			? newlyRevealedInWindow
			: Math.min(step, hiddenCount);
	const showExpand = hiddenCount > 0;
	const showCollapse = visibleCount > limit;

	// Q11: where a sticky row sits above rows still hidden by paging, draw a
	// hairline gap row labelled with the skipped count at that exact gap —
	// once per gap, not the earlier per-row "···" that read as broken rows.
	const skippedBefore = new Map<number, number>();
	let skipped = 0;
	for (let i = 0; i < sessions.length; i++) {
		if (isRowRendered(sessions[i], i)) {
			if (skipped > 0) {
				skippedBefore.set(i, skipped);
				skipped = 0;
			}
		} else {
			skipped++;
		}
	}

	return (
		<>
			{sessions.map((session, idx) => {
				if (!isRowRendered(session, idx)) return null;

				const gap = skippedBefore.get(idx);
				return (
					<React.Fragment key={session.id}>
						{gap !== undefined && (
							<div
								aria-hidden="true"
								className="mx-3 my-0.5 flex items-center gap-2 select-none"
							>
								<span className="h-px flex-1 bg-[var(--border-divider)] opacity-50" />
								<span className="text-[9px] text-[var(--text-dim)] opacity-70 whitespace-nowrap">
									{gap} 条未显示
								</span>
								<span className="h-px flex-1 bg-[var(--border-divider)] opacity-50" />
							</div>
						)}
						<SessionRow
							session={session}
							withSpine={withSpine}
							large={large}
							workspaces={workspaces}
							onRowFocus={onRowFocus}
							onBatchAction={onBatchAction}
						/>
					</React.Fragment>
				);
			})}
			{(showExpand || showCollapse) && (
				<div className="flex items-center py-1.5 px-3 text-[11px] font-medium select-none">
					<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
					{showExpand && (
						<button
							type="button"
							onClick={() => onSetCount(moreKey, visibleCount + step)}
							className="flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
						>
							<Plus size={11} className="shrink-0" />
							<span>展开 {expandable} 条</span>
						</button>
					)}
					{showExpand && showCollapse && (
						<span className="mx-1.5 text-[var(--text-dim)] opacity-40">｜</span>
					)}
					{showCollapse && (
						<button
							type="button"
							onClick={() => onSetCount(moreKey, limit)}
							className="flex items-center gap-0.5 rounded-md px-2 py-1 text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
						>
							<ChevronDown size={11} className="shrink-0 rotate-180" />
							<span>收起</span>
						</button>
					)}
					<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
				</div>
			)}
		</>
	);
}

interface CollapsibleSubgroupProps {
	sub: BranchSubgroup;
	scopeKey: string;
	searching: boolean;
	expanded: Record<string, number>;
	onToggle: (key: string, defaultOpen?: boolean) => void;
	onSetCount: (key: string, count: number) => void;
	onBatchArchive?: () => void;
	workspaces: Workspace[];
	onRowFocus?: () => void;
	onBatchAction: (action: "archive" | "pin" | "delete", ids: string[]) => void;
	ws: Workspace;
	onCreateSession: (ws: Workspace, cwd: string) => void;
	creatingKey: string | null;
}

/**
 * A worktree/branch subgroup collapsible header (S5, S16, S22).
 */
function CollapsibleSubgroup({
	sub,
	scopeKey,
	searching,
	expanded,
	onSetCount,
	onBatchArchive,
	workspaces,
	onRowFocus,
	onBatchAction,
	ws,
	onCreateSession,
	creatingKey,
}: CollapsibleSubgroupProps) {
	// S5: Explicit open flag (1 = open, 0 = collapsed); deleted and empty
	// subgroups start collapsed — an empty subgroup's body is always empty.
	const userExpanded = expanded[`${scopeKey}|sub`];
	const isCollapsed =
		userExpanded !== undefined
			? userExpanded === 0
			: sub.deleted || sub.sessions.length === 0;
	const open = searching || !isCollapsed;

	const [hoverOpen, setHoverOpen] = useState(false);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);

	const isCreatingSubgroup =
		creatingKey !== null && sub.createCwd
			? creatingKey === `${ws.id}|${sub.createCwd}`
			: false;

	const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
		clearTimeout(closeTimer.current ?? undefined);
		closeTimer.current = null;
		const el = e.currentTarget;
		hoverTimer.current = window.setTimeout(() => {
			// Measure lazily: the header may scroll during the 400ms dwell, a
			// stale rect flashes the card at the wrong spot.
			setAnchorRect(el.getBoundingClientRect());
			setHoverOpen(true);
		}, 400);
	};

	const dismissHover = () => {
		clearTimeout(hoverTimer.current ?? undefined);
		hoverTimer.current = null;
		clearTimeout(closeTimer.current ?? undefined);
		closeTimer.current = null;
		setHoverOpen(false);
		setAnchorRect(null);
	};

	const handleMouseLeave = () => {
		clearTimeout(hoverTimer.current ?? undefined);
		hoverTimer.current = null;
		closeTimer.current = window.setTimeout(() => {
			dismissHover();
		}, 150);
	};

	// Deleted worktree folder dims the whole wrapper; inside it don't re-dim
	// the subgroup itself. Empty (live) subgroups dim their header only.
	const shouldDim = sub.sessions.length === 0 && !sub.deleted;

	return (
		<div
			data-group-key={`${scopeKey}|sub`}
			className={clsx(
				"mt-0.5 ml-[14px]",
				shouldDim && "opacity-60 hover:opacity-100 transition-opacity",
			)}
		>
			<GroupHeader
				groupKey={`${scopeKey}|sub`}
				isSubgroup
				title={sub.label}
				icon={
					sub.kind === "worktree" ? (
						<FolderGit2
							size={12}
							className="text-indigo-600 dark:text-indigo-400 shrink-0"
						/>
					) : (
						<GitBranch
							size={12}
							className="text-purple-600 dark:text-purple-400 shrink-0"
						/>
					)
				}
				titleElement={
					<span
						onMouseEnter={handleMouseEnter}
						onMouseLeave={handleMouseLeave}
						className="flex min-w-0 flex-1 items-center gap-1 text-left"
					>
						<HoverScrollText
							text={sub.label}
							className="min-w-0 flex-1 font-mono font-bold text-[var(--text)]"
							title={sub.label}
						/>
						{sub.isMain && (
							<span className="shrink-0 rounded bg-[var(--bg-hover)] px-1 text-[9px] text-[var(--text-dim)] font-normal">
								主目录
							</span>
						)}
						{sub.deleted && (
							<span className="shrink-0 rounded bg-[var(--bg-hover)] px-1 text-[9px] text-[var(--text-dim)] font-normal">
								已清理
							</span>
						)}
						{!sub.deleted && sub.sessions.length === 0 && (
							<span className="shrink-0 text-[10px] text-[var(--text-dim)] font-normal italic">
								暂无会话
							</span>
						)}
					</span>
				}
				isOpen={open}
				onToggle={() => {
					dismissHover();
					onSetCount(`${scopeKey}|sub`, open ? 0 : 1);
				}}
				statusCounts={getGroupStatusCounts(sub.sessions)}
				actionButton={
					<div className="flex items-center gap-0.5 shrink-0 ml-1">
						{/* 在访达中打开 removed per user: kept only on the row context
						 * menu and workspace header menu. */}
						{!sub.deleted && sub.createCwd && (
							<button
								type="button"
								disabled={creatingKey !== null}
								onClick={(e) => {
									dismissHover();
									e.stopPropagation();
									onCreateSession(ws, sub.createCwd!);
								}}
								className="shrink-0 rounded p-1 text-[var(--text-muted)] opacity-55 hover:opacity-100 transition-all hover:bg-[var(--bg-hover)] hover:text-[var(--accent)] disabled:opacity-40 focus-visible:opacity-100"
								title="在该分支创建新会话"
							>
								{isCreatingSubgroup ? (
									<Loader2 size={14} className="animate-spin" />
								) : (
									<Plus size={14} strokeWidth={2.4} />
								)}
							</button>
						)}
						{sub.deleted && onBatchArchive && (
							<button
								type="button"
								onClick={(e) => {
									dismissHover();
									e.stopPropagation();
									onBatchArchive();
								}}
								className="shrink-0 rounded p-0.5 text-[var(--text-dim)] opacity-50 hover:opacity-100 transition-all hover:bg-neutral-700/60 hover:text-amber-300 focus-visible:opacity-100"
								title="归档该分支全部会话"
							>
								<Archive size={11} />
							</button>
						)}
					</div>
				}
			/>

			{open && (
				<div className="ml-[22px] pl-2 my-0.5">
					<SessionList
						sessions={sub.sessions}
						scopeKey={scopeKey}
						searching={searching}
						expanded={expanded}
						onSetCount={onSetCount}
						workspaces={workspaces}
						onRowFocus={onRowFocus}
						onBatchAction={onBatchAction}
						withSpine
					/>
				</div>
			)}

			<WorktreeHoverCard
				title={sub.label}
				path={sub.path ?? sub.createCwd}
				sessionCount={sub.sessions.length}
				anchorRect={anchorRect}
				open={hoverOpen && anchorRect !== null}
				side="right"
				isCurrent={sub.isMain}
				onClose={dismissHover}
			/>
		</div>
	);
}

interface DeletedWorktreesFolderProps {
	folderKey: string;
	ws: Workspace;
	subgroups: BranchSubgroup[];
	searching: boolean;
	isOpen: boolean;
	onToggle: () => void;
	onBatchArchive: (title: string, sessions: SessionMeta[]) => Promise<void>;
	expanded: Record<string, number>;
	onToggleSection: (key: string, defaultOpen?: boolean) => void;
	onSetCount: (key: string, count: number) => void;
	workspaces: Workspace[];
	onRowFocus?: () => void;
	onBatchAction: (action: "archive" | "pin" | "delete", ids: string[]) => void;
	onCreateSession: (ws: Workspace, cwd: string) => void;
	creatingKey: string | null;
}

/**
 * Default-collapsed folder at the bottom of a project group for deleted worktrees (§DELETED_LABEL).
 */
function DeletedWorktreesFolder({
	folderKey,
	ws,
	subgroups,
	searching,
	isOpen,
	onToggle,
	onBatchArchive,
	expanded,
	onToggleSection,
	onSetCount,
	workspaces,
	onRowFocus,
	onBatchAction,
	onCreateSession,
	creatingKey,
}: DeletedWorktreesFolderProps) {
	if (subgroups.length === 0) return null;
	const allDeleted = subgroups.flatMap((sg) => sg.sessions);
	const DELETED_WT_LIMIT = 5;
	const DELETED_WT_STEP = 5;
	const wtMoreKey = `${folderKey}|wt_more`;
	const visibleSubgroupsCount = Math.min(
		Math.max(expanded[wtMoreKey] ?? DELETED_WT_LIMIT, DELETED_WT_LIMIT),
		subgroups.length,
	);
	const visibleSubgroups = subgroups.slice(0, visibleSubgroupsCount);
	const hiddenSubgroups = subgroups.length - visibleSubgroupsCount;

	return (
		<div className="mt-0.5 ml-[14px] opacity-60 hover:opacity-100 transition-opacity">
			<GroupHeader
				groupKey={folderKey}
				title={`${DELETED_LABEL} (${subgroups.length})`}
				icon={
					<FolderGit2
						size={12}
						className="text-[var(--text-dim)] shrink-0"
					/>
				}
				isOpen={isOpen || searching}
				onToggle={onToggle}
				statusCounts={getGroupStatusCounts(subgroups)}
				actionButton={
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							void onBatchArchive(DELETED_LABEL, allDeleted);
						}}
						className="mr-1 shrink-0 rounded p-0.5 text-[var(--text-dim)] opacity-50 hover:opacity-100 transition-all hover:bg-neutral-700/60 hover:text-amber-300 focus-visible:opacity-100"
						title="一键归档全部已清理工作树的会话"
					>
						<Archive size={11} />
					</button>
				}
			/>

			{(isOpen || searching) && (
				<div className="ml-[8px]" data-group-key={folderKey}>
					{visibleSubgroups.map((sub) => (
						<CollapsibleSubgroup
							key={`${folderKey}|${sub.key}`}
							sub={sub}
							scopeKey={`${folderKey}|${sub.key}`}
							searching={searching}
							onSetCount={onSetCount}
							expanded={expanded}
							onToggle={onToggleSection}
							onBatchArchive={() => onBatchArchive(sub.label, sub.sessions)}
							workspaces={workspaces}
							onRowFocus={onRowFocus}
							onBatchAction={onBatchAction}
							ws={ws}
							onCreateSession={onCreateSession}
							creatingKey={creatingKey}
						/>
					))}
					{subgroups.length > DELETED_WT_LIMIT && (
						<div className="flex items-center py-1.5 px-3 text-[11px] font-medium select-none">
							<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
							{hiddenSubgroups > 0 && (
								<button
									type="button"
									onClick={() =>
										onSetCount(wtMoreKey, visibleSubgroupsCount + DELETED_WT_STEP)
									}
									className="flex items-center gap-1 rounded-md px-2 py-1 text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
								>
									<Plus size={11} className="shrink-0" />
									<span>
										展开 {Math.min(DELETED_WT_STEP, hiddenSubgroups)} 个工作树
									</span>
								</button>
							)}
							{hiddenSubgroups > 0 && visibleSubgroupsCount > DELETED_WT_LIMIT && (
								<span className="mx-1.5 text-[var(--text-dim)] opacity-40">｜</span>
							)}
							{visibleSubgroupsCount > DELETED_WT_LIMIT && (
								<button
									type="button"
									onClick={() => onSetCount(wtMoreKey, DELETED_WT_LIMIT)}
									className="flex items-center gap-0.5 rounded-md px-2 py-1 text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-hover)] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-active)]"
								>
									<ChevronDown size={11} className="shrink-0 rotate-180" />
									<span>收起</span>
								</button>
							)}
							<span className="h-px flex-1 bg-[var(--border-divider)] opacity-40" />
						</div>
					)}
				</div>
			)}
		</div>
	);
}

interface EmptyWorktreesFolderProps {
	folderKey: string;
	ws: Workspace;
	subgroups: BranchSubgroup[];
	searching: boolean;
	isOpen: boolean;
	onToggle: () => void;
	expanded: Record<string, number>;
	onToggleSection: (key: string, defaultOpen?: boolean) => void;
	onSetCount: (key: string, count: number) => void;
	workspaces: Workspace[];
	onRowFocus?: () => void;
	onBatchAction: (action: "archive" | "pin" | "delete", ids: string[]) => void;
	onCreateSession: (ws: Workspace, cwd: string) => void;
	creatingKey: string | null;
}

/**
 * Default-collapsed folder for empty worktree subgroups ("暂无会话") so they
 * stop occupying one row each under every project (user-reported clutter).
 * Each entry keeps its "+" create-session affordance.
 */
function EmptyWorktreesFolder({
	folderKey,
	ws,
	subgroups,
	searching,
	isOpen,
	onToggle,
	expanded,
	onToggleSection,
	onSetCount,
	workspaces,
	onRowFocus,
	onBatchAction,
	onCreateSession,
	creatingKey,
}: EmptyWorktreesFolderProps) {
	if (subgroups.length === 0) return null;

	return (
		<div className="mt-0.5 ml-[14px] opacity-70 hover:opacity-100 transition-opacity">
			<GroupHeader
				groupKey={folderKey}
				title={`空闲工作树 (${subgroups.length})`}
				icon={
					<GitBranch
						size={12}
						className="text-[var(--text-dim)] shrink-0"
					/>
				}
				isOpen={isOpen || searching}
				onToggle={onToggle}
			/>

			{(isOpen || searching) && (
				<div className="ml-[8px]" data-group-key={folderKey}>
					{subgroups.map((sub) => (
						<CollapsibleSubgroup
							key={`${folderKey}|${sub.key}`}
							sub={sub}
							scopeKey={`${folderKey}|${sub.key}`}
							searching={searching}
							onSetCount={onSetCount}
							expanded={expanded}
							onToggle={onToggleSection}
							workspaces={workspaces}
							onRowFocus={onRowFocus}
							onBatchAction={onBatchAction}
							ws={ws}
							onCreateSession={onCreateSession}
							creatingKey={creatingKey}
						/>
					))}
				</div>
			)}
		</div>
	);
}

interface UnassignedDirSubgroupProps {
	grp: { key: string; cwd: string; label: string; sessions: SessionMeta[] };
	subKey: string;
	searching: boolean;
	isSubOpen: boolean;
	onToggle: () => void;
	onSetCount: (key: string, count: number) => void;
	expanded: Record<string, number>;
	workspaces: Workspace[];
	onRowFocus?: () => void;
	onBatchAction: (action: "archive" | "pin" | "delete", ids: string[]) => void;
	onArchive: () => void;
	onAddWorkspace: () => void | Promise<void>;
}

/**
 * One directory subgroup under 未归入工作区: default-collapsed header with a
 * hover-scroll title, archive + add-as-workspace icon buttons, and the same
 * floating hover card used by worktree subgroups (400ms dwell, lazy rect).
 */
function UnassignedDirSubgroup({
	grp,
	subKey,
	searching,
	isSubOpen,
	onToggle,
	onSetCount,
	expanded,
	workspaces,
	onRowFocus,
	onBatchAction,
	onArchive,
	onAddWorkspace,
}: UnassignedDirSubgroupProps) {
	const [hoverOpen, setHoverOpen] = useState(false);
	const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
	const hoverTimer = useRef<number | null>(null);
	const closeTimer = useRef<number | null>(null);

	const dismissHover = () => {
		clearTimeout(hoverTimer.current ?? undefined);
		hoverTimer.current = null;
		clearTimeout(closeTimer.current ?? undefined);
		closeTimer.current = null;
		setHoverOpen(false);
		setAnchorRect(null);
	};

	return (
		<div className="mt-0.5 ml-[14px]" data-group-key={subKey}>
			<GroupHeader
				groupKey={subKey}
				isSubgroup
				title={grp.label}
				icon={<Folder size={12} className="text-neutral-400 shrink-0" />}
				titleElement={
					<span
						onMouseEnter={(e) => {
							clearTimeout(closeTimer.current ?? undefined);
							closeTimer.current = null;
							const el = e.currentTarget;
							hoverTimer.current = window.setTimeout(() => {
								// Measure lazily: the row may scroll during the dwell.
								setAnchorRect(el.getBoundingClientRect());
								setHoverOpen(true);
							}, 400);
						}}
						onMouseLeave={() => {
							clearTimeout(hoverTimer.current ?? undefined);
							hoverTimer.current = null;
							closeTimer.current = window.setTimeout(dismissHover, 150);
						}}
						className="flex min-w-0 flex-1 items-center gap-1 text-left"
					>
						<HoverScrollText
							text={grp.label}
							className="min-w-0 flex-1 font-mono font-bold text-[11px] text-[var(--text)]"
							title={grp.label}
						/>
					</span>
				}
				isOpen={isSubOpen}
				onToggle={onToggle}
				statusCounts={getGroupStatusCounts(grp.sessions)}
				actionButton={
					<div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								dismissHover();
								onArchive();
							}}
							className="rounded p-0.5 text-[var(--text-dim)] opacity-60 hover:opacity-100 hover:bg-neutral-700/60 hover:text-amber-300 transition-all"
							title="归档该目录下全部会话"
						>
							<Archive size={11} />
						</button>
						<button
							type="button"
							onClick={async (e) => {
								e.stopPropagation();
								dismissHover();
								await onAddWorkspace();
							}}
							className="rounded p-0.5 text-indigo-400 hover:bg-indigo-950/50 hover:text-indigo-300 transition-colors"
							title={`将 ${grp.cwd} 添加为工作区`}
						>
							<FolderPlus size={12} />
						</button>
					</div>
				}
			/>
			{isSubOpen && (
				<div className="ml-[22px] pl-2 my-0.5">
					<SessionList
						sessions={grp.sessions}
						scopeKey={subKey}
						searching={searching}
						onSetCount={onSetCount}
						expanded={expanded}
						workspaces={workspaces}
						onRowFocus={onRowFocus}
						onBatchAction={onBatchAction}
						withSpine
					/>
				</div>
			)}

			<WorktreeHoverCard
				title={grp.label}
				path={grp.cwd}
				sessionCount={grp.sessions.length}
				anchorRect={anchorRect}
				open={hoverOpen && anchorRect !== null}
				side="right"
				onClose={dismissHover}
			/>
		</div>
	);
}
