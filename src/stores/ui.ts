/**
 * UI state: selected session, center view, right tab, modals (§10). [LEAD]
 */

import { create } from "zustand";
import type { SpaceMode } from "../lib/contracts";
import { isSpaceMode } from "../features/sessions/modes";
import { readActiveMode, useSidebarStore } from "../features/sessions/sidebarStore";

export type CenterView =
	| "home"
	| "session"
	| "doc"
	| "inbox"
	| "schedules"
	| "skills"
	| "settings";
export type RightTab =
	| "explorer"
	| "sidechat"
	| "heatmap"
	| "git"
	| "services"
	| "terminal"
	| "plan"
	| "files";

export const MIN_SIDEBAR_WIDTH = 260;
export const MAX_SIDEBAR_WIDTH = 600;
export const SIDEBAR_COLLAPSE_THRESHOLD = 200;


const STORAGE_KEYS = {
	sidebarWidth: "ompws:sidebar-width",
	rightWidth: "ompws:right-width",
	sidebarOpen: "ompws:sidebar-open",
	rightOpen: "ompws:right-open",
	lastSession: "ompws:last-session",
	rightByMode: "ompws:right-by-mode",
	rightTabs: "ompws:right-tabs", // legacy global value, migrated into the Code area
	gitListHeight: "ompws:git-list-height",
	diffViewMode: "ompws:diff-view-mode",
	diffWrap: "ompws:diff-wrap",
};

const RIGHT_TABS: readonly RightTab[] = [
	"explorer",
	"sidechat",
	"heatmap",
	"git",
	"services",
	"terminal",
	"plan",
	"files",
];

/** Right-panel memory of one area (space mode). */
interface RightPanelMemo {
	open: boolean;
	tabs: RightTab[];
	active: RightTab | null;
}

/**
 * Groups whose strip tabs come from per-instance state that is not restored
 * at launch (file previews, per-session side chats): restoring the group
 * would leave a ghost tab with nothing behind it.
 */
const INSTANCE_TABS: Partial<Record<RightTab, true>> = { files: true, sidechat: true };

/** A never-visited area: panel closed, nothing open (the tab picker shows once opened). */
function defaultRightMemo(): RightPanelMemo {
	return { open: false, tabs: [], active: null };
}

function sanitizeTabs(raw: unknown): RightTab[] {
	if (!Array.isArray(raw)) return [];
	return RIGHT_TABS.filter((t) => raw.includes(t) && !INSTANCE_TABS[t]).sort(
		(a, b) => raw.indexOf(a) - raw.indexOf(b),
	);
}

/**
 * Persisted per-area memory. No tab is active at launch: the panel opens on
 * the tab picker. The pre-per-area global keys (`right-open`/`right-tabs`)
 * seed the Code area when the per-area key does not exist yet.
 */
function readRightByMode(): Partial<Record<SpaceMode, RightPanelMemo>> {
	const out: Partial<Record<SpaceMode, RightPanelMemo>> = {};
	try {
		const raw: unknown = JSON.parse(readString(STORAGE_KEYS.rightByMode) ?? "null");
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			for (const [mode, v] of Object.entries(raw)) {
				if (!isSpaceMode(mode) || !v || typeof v !== "object") continue;
				const m = v as { open?: unknown; tabs?: unknown };
				out[mode] = { open: m.open === true, tabs: sanitizeTabs(m.tabs), active: null };
			}
			return out;
		}
	} catch {
		/* corrupt value: fall through to legacy seed */
	}
	let legacyTabs: RightTab[] = [];
	try {
		legacyTabs = sanitizeTabs(JSON.parse(readString(STORAGE_KEYS.rightTabs) ?? "null"));
	} catch {
		/* corrupt legacy value */
	}
	out.code = {
		open: readBool(STORAGE_KEYS.rightOpen, true),
		tabs: legacyTabs,
		active: null,
	};
	return out;
}

let currentMode: SpaceMode = readActiveMode();
let rightByMode = readRightByMode();

function persistRightByMode(): void {
	const persisted: Record<string, { open: boolean; tabs: RightTab[] }> = {};
	for (const [mode, m] of Object.entries(rightByMode)) {
		persisted[mode] = { open: m.open, tabs: m.tabs.filter((t) => !INSTANCE_TABS[t]) };
	}
	writeStorage(STORAGE_KEYS.rightByMode, JSON.stringify(persisted));
}

/** Record the live panel state as the current area's memory and persist all areas. */
function persistRight(open: boolean, tabs: RightTab[], active: RightTab | null): void {
	rightByMode[currentMode] = { open, tabs, active };
	persistRightByMode();
}

const initialRight = rightByMode[currentMode] ?? defaultRightMemo();

function readNumber(
	key: string,
	fallback: number,
	min: number,
	max: number,
): number {
	try {
		if (typeof localStorage === "undefined") return fallback;
		const v = Number(localStorage.getItem(key));
		if (!Number.isNaN(v) && v >= min && v <= max) return v;
	} catch {
		/* storage unavailable */
	}
	return fallback;
}

function readBool(key: string, fallback: boolean): boolean {
	try {
		if (typeof localStorage === "undefined") return fallback;
		const v = localStorage.getItem(key);
		if (v === "true") return true;
		if (v === "false") return false;
	} catch {
		/* storage unavailable */
	}
	return fallback;
}

function writeStorage(key: string, val: string | number | boolean): void {
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(key, String(val));
		}
	} catch {
		/* storage quota exceeded / unavailable */
	}
}

function readString(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

function readDiffViewMode(): "unified" | "split" | null {
	const v = readString(STORAGE_KEYS.diffViewMode);
	return v === "unified" || v === "split" ? v : null;
}

export interface UiState {
	centerView: CenterView;
	previousCenterView: CenterView | null;
	selectedSessionId: string | null;
	selectedIds: Set<string>;
	highlightId: string | null;
	lastSessionId: string | null;
	docPath: string | null;
	rightTab: RightTab | null;
	/** Open right-panel tabs in display order (Chrome-style); `rightTab` is the active one. */
	openRightTabs: RightTab[];
	rightOpen: boolean;
	rightWidth: number;
	/** Height (px) of the Git panel's worktree list above the detail-pane divider. */
	gitListHeight: number;
	/** Diff viewer layout chosen by the user; `null` = pick by dialog width. */
	diffViewMode: "unified" | "split" | null;
	/** Soft-wrap long lines in the diff viewer. */
	diffWrap: boolean;
	sidebarOpen: boolean;
	sidebarWidth: number;
	sessionViewMode: Record<string, "chat" | "terminal">;

	/** Settings section to show when the settings view opens (e.g. from the theme menu). */
	settingsSection: string | null;
	/** Field/omp-config key to scroll to and highlight inside the settings view. */
	settingsFocus: string | null;
	/** Monotonic id bumped by every openSettings call so SettingsPage can apply each request once. */
	settingsRequest: number;
	/** True while the latest settings request is unconsumed by SettingsPage. */
	settingsPending: boolean;
	modal: { name: string; props: Record<string, unknown> } | null;
	selectSession(id: string | null): void;
	/** Drop the current session and its "last session" fallback; shows the blank home view. */
	leaveSession(): void;
	setSelectedIds(ids: Set<string> | string[]): void;
	toggleSelectId(id: string): void;
	setHighlightId(id: string | null): void;
	returnToSession(): void;
	openDoc(path: string): void;
	setCenter(v: CenterView): void;
	openSettings(section?: string, opts?: { focusKey?: string }): void;
	closeSettings(): void;
	/** Open (if needed) and activate `t`; never replaces another open tab. `null` deactivates. */
	setRightTab(t: RightTab | null): void;
	/** Close `t`; if it was active, activate its right neighbour, else left, else none. */
	closeRightTab(t: RightTab): void;
	toggleRight(): void;
	setRightOpen(open: boolean): void;
	setRightWidth(w: number): void;
	setGitListHeight(h: number): void;
	setDiffViewMode(m: "unified" | "split"): void;
	setDiffWrap(wrap: boolean): void;
	toggleSidebar(): void;
	setSidebarOpen(open: boolean): void;
	setSidebarWidth(w: number): void;
	setSessionViewMode(id: string, m: "chat" | "terminal"): void;

	openModal(name: string, props?: Record<string, unknown>): void;
	closeModal(): void;
}

export const useUi = create<UiState>((set) => ({
	centerView: "home",
	previousCenterView: null,
	selectedSessionId: null,
	selectedIds: new Set<string>(),
	highlightId: null,
	lastSessionId: readString(STORAGE_KEYS.lastSession),
	docPath: null,
	rightTab: initialRight.active,
	openRightTabs: initialRight.tabs,
	rightOpen: initialRight.open,
	rightWidth: readNumber(STORAGE_KEYS.rightWidth, 360, 260, 720),
	gitListHeight: readNumber(STORAGE_KEYS.gitListHeight, 220, 80, 2000),
	diffViewMode: readDiffViewMode(),
	diffWrap: readBool(STORAGE_KEYS.diffWrap, false),
	sidebarOpen: readBool(STORAGE_KEYS.sidebarOpen, true),
	sidebarWidth: readNumber(STORAGE_KEYS.sidebarWidth, 280, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH),
	sessionViewMode: {},
	settingsSection: null,
	settingsFocus: null,
	settingsRequest: 0,
	settingsPending: false,
	modal: null,
	selectSession: (id) => {
		if (id) writeStorage(STORAGE_KEYS.lastSession, id);
		set((s) => ({
			selectedSessionId: id,
			selectedIds: id ? new Set([id]) : new Set(),
			highlightId: id,
			lastSessionId: id ?? s.lastSessionId,
			centerView: id ? "session" : s.centerView === "session" ? "home" : s.centerView,
		}));
	},
	leaveSession: () => {
		try {
			if (typeof localStorage !== "undefined") localStorage.removeItem(STORAGE_KEYS.lastSession);
		} catch {
			/* storage unavailable */
		}
		set((s) => ({
			selectedSessionId: null,
			selectedIds: new Set<string>(),
			highlightId: null,
			lastSessionId: null,
			centerView: s.centerView === "settings" ? s.centerView : "home",
		}));
	},
	setSelectedIds: (ids) =>
		set({ selectedIds: ids instanceof Set ? ids : new Set(ids) }),
	toggleSelectId: (id) =>
		set((s) => {
			const next = new Set(s.selectedIds);
			if (next.has(id)) {
				next.delete(id);
			} else {
				next.add(id);
			}
			return { selectedIds: next };
		}),
	setHighlightId: (id) => set({ highlightId: id }),
	returnToSession: () =>
		set((s) => {
			const targetId = s.selectedSessionId || s.lastSessionId;
			if (targetId) {
				return {
					selectedSessionId: targetId,
					centerView: "session",
				};
			}
			return { centerView: "home" };
		}),
	openDoc: (path) => set({ docPath: path, centerView: "doc" }),
	setCenter: (v) =>
		set((s) => ({
			previousCenterView:
				v === "settings"
					? s.centerView !== "settings"
						? s.centerView
						: s.previousCenterView
					: s.previousCenterView,
			centerView: v,
		})),
	openSettings: (section, opts) =>
		set((s) => ({
			previousCenterView:
				s.centerView !== "settings" ? s.centerView : s.previousCenterView,
			centerView: "settings",
			settingsSection: section ?? null,
			settingsFocus: opts?.focusKey ?? null,
			settingsRequest: s.settingsRequest + 1,
			settingsPending: true,
		})),
	closeSettings: () =>
		set((s) => {
			const prev =
				s.previousCenterView ?? (s.selectedSessionId ? "session" : "home");
			return {
				centerView: prev,
				settingsSection: null,
				settingsFocus: null,
				settingsPending: false,
			};
		}),
	setRightTab: (t) =>
		set((s) => {
			if (!t) {
				persistRight(s.rightOpen, s.openRightTabs, null);
				return { rightTab: null };
			}
			const openRightTabs = s.openRightTabs.includes(t) ? s.openRightTabs : [...s.openRightTabs, t];
			persistRight(true, openRightTabs, t);
			return { rightTab: t, openRightTabs, rightOpen: true };
		}),
	closeRightTab: (t) =>
		set((s) => {
			const idx = s.openRightTabs.indexOf(t);
			if (idx < 0) return {};
			const openRightTabs = s.openRightTabs.filter((x) => x !== t);
			const rightTab =
				s.rightTab === t ? (openRightTabs[idx] ?? openRightTabs[idx - 1] ?? null) : s.rightTab;
			// Closing the last tab collapses the whole panel instead of leaving the empty picker.
			const rightOpen = openRightTabs.length === 0 ? false : s.rightOpen;
			persistRight(rightOpen, openRightTabs, rightTab);
			return { openRightTabs, rightTab, rightOpen };
		}),
	toggleRight: () =>
		set((s) => {
			const next = !s.rightOpen;
			persistRight(next, s.openRightTabs, s.rightTab);
			// Re-opening restores the last active tab; the "打开标签页" picker
			// only shows when there is no active tab.
			return { rightOpen: next };
		}),
	setRightOpen: (open) =>
		set((s) => {
			persistRight(open, s.openRightTabs, s.rightTab);
			return { rightOpen: open };
		}),
	setRightWidth: (w) => {
		const clamped = Math.min(720, Math.max(260, w));
		writeStorage(STORAGE_KEYS.rightWidth, clamped);
		set({ rightWidth: clamped });
	},
	setGitListHeight: (h) => {
		const clamped = Math.min(2000, Math.max(80, Math.round(h)));
		writeStorage(STORAGE_KEYS.gitListHeight, clamped);
		set({ gitListHeight: clamped });
	},
	setDiffViewMode: (m) => {
		writeStorage(STORAGE_KEYS.diffViewMode, m);
		set({ diffViewMode: m });
	},
	setDiffWrap: (wrap) => {
		writeStorage(STORAGE_KEYS.diffWrap, wrap);
		set({ diffWrap: wrap });
	},
	toggleSidebar: () =>
		set((s) => {
			const next = !s.sidebarOpen;
			writeStorage(STORAGE_KEYS.sidebarOpen, next);
			const w = s.sidebarWidth < MIN_SIDEBAR_WIDTH ? 280 : s.sidebarWidth;
			if (w !== s.sidebarWidth) {
				writeStorage(STORAGE_KEYS.sidebarWidth, w);
			}
			return { sidebarOpen: next, sidebarWidth: w };
		}),
	setSidebarOpen: (open) => {
		writeStorage(STORAGE_KEYS.sidebarOpen, open);
		set((s) => {
			const w = s.sidebarWidth < MIN_SIDEBAR_WIDTH ? 280 : s.sidebarWidth;
			if (w !== s.sidebarWidth) {
				writeStorage(STORAGE_KEYS.sidebarWidth, w);
			}
			return { sidebarOpen: open, sidebarWidth: w };
		});
	},
	setSidebarWidth: (w) => {
		const clamped = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, w));
		writeStorage(STORAGE_KEYS.sidebarWidth, clamped);
		set({ sidebarWidth: clamped });
	},
	setSessionViewMode: (id, m) =>
		set((s) => ({ sessionViewMode: { ...s.sessionViewMode, [id]: m } })),

	openModal: (name, props = {}) => set({ modal: { name, props } }),
	closeModal: () => set({ modal: null }),
}));

// Switching area swaps the right panel for that area's own remembered state.
useSidebarStore.subscribe((s, prev) => {
	if (s.activeMode === prev.activeMode) return;
	const cur = useUi.getState();
	rightByMode[currentMode] = { open: cur.rightOpen, tabs: cur.openRightTabs, active: cur.rightTab };
	currentMode = s.activeMode;
	const next = rightByMode[currentMode] ?? defaultRightMemo();
	persistRightByMode();
	useUi.setState({ rightOpen: next.open, openRightTabs: next.tabs, rightTab: next.active });
});
