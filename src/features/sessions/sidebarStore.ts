/**
 * Zustand store for SessionSidebar view state.
 * Survives sidebar collapse/unmount (Cmd+B) and persists user choices.
 */

import { create } from "zustand";
import type { SpaceMode } from "../../lib/contracts";
import { isSpaceMode } from "./modes";

export const ACTIVE_MODE_KEY = "ompws:active-space-mode";
export const COLLAPSED_GROUPS_KEY = "ompws:collapsed-groups";

export function readActiveMode(): SpaceMode {
	try {
		const raw = localStorage.getItem(ACTIVE_MODE_KEY);
		return isSpaceMode(raw) ? raw : "code";
	} catch {
		return "code";
	}
}

export function writeActiveMode(mode: SpaceMode): void {
	try {
		localStorage.setItem(ACTIVE_MODE_KEY, mode);
	} catch {
		/* ignore storage quota or private mode */
	}
}

export function readCollapsedGroups(): Record<string, boolean> {
	try {
		const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
				return parsed;
			}
		}
	} catch {
		/* ignore malformed json */
	}
	return {
		__unassigned: false,
		__deleted: false,
	};
}

export function writeCollapsedGroups(state: Record<string, boolean>): void {
	try {
		localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(state));
	} catch {
		/* ignore */
	}
}
export interface SidebarState {
	/** Active space mode: the whole sidebar shows only this mode's data. */
	activeMode: SpaceMode;
	setActiveMode: (mode: SpaceMode) => void;

	/** Explicit user expand/collapse toggles for workspace and special groups */
	groupOpen: Record<string, boolean>;
	setGroupOpen: (
		update:
			| Record<string, boolean>
			| ((prev: Record<string, boolean>) => Record<string, boolean>),
	) => void;
	toggleGroup: (key: string, defaultOpen?: boolean) => void;
	isGroupOpen: (key: string, defaultOpen?: boolean) => boolean;

	/** Whether archived sessions are included in grouping */
	showArchived: boolean;
	setShowArchived: (show: boolean) => void;
	toggleShowArchived: () => void;

	/**
	 * Per-section disclosure state:
	 * - `…|more`: how many top-level session rows to render (default 3)
	 * - `…|sub`: 0/1 open flag for worktree/branch subgroups
	 */
	expandedSections: Record<string, number>;
	setExpandedSections: (
		update:
			| Record<string, number>
			| ((prev: Record<string, number>) => Record<string, number>),
	) => void;
	/** S5: store an explicit open flag (1 = open, 0 = collapsed) */
	toggleSection: (key: string, defaultOpen?: boolean) => void;
	setSectionCount: (key: string, count: number) => void;

	/** S16: in-flight creation key formatted as `${ws.id}|${cwd}` so only the clicked control spins */
	creatingKey: string | null;
	setCreatingKey: (key: string | null) => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
	activeMode: readActiveMode(),
	setActiveMode: (mode: SpaceMode) => {
		writeActiveMode(mode);
		set({ activeMode: mode });
	},

	groupOpen: readCollapsedGroups(),
	setGroupOpen: (update) => {
		set((state) => {
			const next = typeof update === "function" ? update(state.groupOpen) : update;
			writeCollapsedGroups(next);
			return { groupOpen: next };
		});
	},
	toggleGroup: (key: string, defaultOpen = true) => {
		set((state) => {
			const current = state.groupOpen[key] !== undefined ? state.groupOpen[key] : defaultOpen;
			const next = { ...state.groupOpen, [key]: !current };
			writeCollapsedGroups(next);
			return { groupOpen: next };
		});
	},
	isGroupOpen: (key: string, defaultOpen = true) => {
		const open = get().groupOpen[key];
		return open !== undefined ? open : defaultOpen;
	},

	showArchived: false,
	setShowArchived: (showArchived: boolean) => set({ showArchived }),
	toggleShowArchived: () => set((s) => ({ showArchived: !s.showArchived })),

	expandedSections: {},
	setExpandedSections: (update) => {
		set((state) => {
			const next =
				typeof update === "function" ? update(state.expandedSections) : update;
			return { expandedSections: next };
		});
	},
	toggleSection: (key: string, defaultOpen = true) => {
		set((state) => {
			const current =
				state.expandedSections[key] !== undefined
					? state.expandedSections[key] === 1
					: defaultOpen;
			return {
				expandedSections: {
					...state.expandedSections,
					[key]: current ? 0 : 1,
				},
			};
		});
	},
	setSectionCount: (key: string, count: number) => {
		set((state) => ({
			expandedSections: {
				...state.expandedSections,
				[key]: count,
			},
		}));
	},

	creatingKey: null,
	setCreatingKey: (creatingKey: string | null) => set({ creatingKey }),
}));
