/**
 * UI state: selected session, center view, right tab, modals (§10). [LEAD]
 */

import { create } from "zustand";

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
	rightBySession: "ompws:right-by-session",
	lastSession: "ompws:last-session",
	gitListHeight: "ompws:git-list-height",
	diffViewMode: "ompws:diff-view-mode",
	diffWrap: "ompws:diff-wrap",
};

/** Pre-per-session keys (global / per-area panel memory); dropped on load. */
const LEGACY_RIGHT_KEYS = ["ompws:right-open", "ompws:right-tabs", "ompws:right-by-mode"];

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

/** Right-panel state of one session. */
interface RightPanelState {
	open: boolean;
	tabs: RightTab[];
	active: RightTab | null;
}

/** Remembered state plus when it was last touched (ms); entries expire after 14 days. */
interface RightPanelMemo extends RightPanelState {
	at: number;
}

/**
 * Groups whose strip tabs come from per-instance state that is not restored
 * at launch (file previews, per-session side chats): restoring the group
 * would leave a ghost tab with nothing behind it.
 */
const INSTANCE_TABS: Partial<Record<RightTab, true>> = { files: true, sidechat: true };

/** A never-visited session: panel closed, nothing open (the tab picker shows once opened). */
function defaultRightMemo(): RightPanelState {
	return { open: false, tabs: [], active: null };
}

function sanitizeTabs(raw: unknown): RightTab[] {
	if (!Array.isArray(raw)) return [];
	return RIGHT_TABS.filter((t) => raw.includes(t) && !INSTANCE_TABS[t]).sort(
		(a, b) => raw.indexOf(a) - raw.indexOf(b),
	);
}

/**
 * Right-panel memory is per session: each session keeps its own open state and
 * tab strip, and a session never opened before starts closed with no tabs.
 * `NO_SESSION_KEY` covers the home view and the new-session placeholder.
 * No tab is active at launch: the panel opens on the tab picker.
 */
const NO_SESSION_KEY = "";
const REMEMBER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const rightKey = (sessionId: string | null): string => sessionId ?? NO_SESSION_KEY;

function readRightBySession(): Map<string, RightPanelMemo> {
	const now = Date.now();
	const out = new Map<string, RightPanelMemo>();
	try {
		if (typeof localStorage !== "undefined") {
			for (const k of LEGACY_RIGHT_KEYS) localStorage.removeItem(k);
		}
	} catch {
		/* storage unavailable */
	}
	try {
		const raw: unknown = JSON.parse(readString(STORAGE_KEYS.rightBySession) ?? "null");
		if (raw && typeof raw === "object" && !Array.isArray(raw)) {
			for (const [key, v] of Object.entries(raw)) {
				if (!v || typeof v !== "object") continue;
				const m = v as { open?: unknown; tabs?: unknown; at?: unknown };
				// Expired (or undated) entries are dropped on load.
				if (typeof m.at !== "number" || now - m.at > REMEMBER_TTL_MS) continue;
				out.set(key, { open: m.open === true, tabs: sanitizeTabs(m.tabs), active: null, at: m.at });
			}
		}
	} catch {
		/* corrupt value: every session starts closed */
	}
	return out;
}

const rightBySession = readRightBySession();

/** Drop expired entries from memory, then write the survivors. */
function persistRightBySession(now: number): void {
	const persisted: Record<string, { open: boolean; tabs: RightTab[]; at: number }> = {};
	for (const [key, m] of rightBySession) {
		if (now - m.at > REMEMBER_TTL_MS) {
			rightBySession.delete(key);
			continue;
		}
		const tabs = m.tabs.filter((t) => !INSTANCE_TABS[t]);
		// Identical to a never-visited session: nothing worth storing.
		if (!m.open && tabs.length === 0) continue;
		persisted[key] = { open: m.open, tabs, at: m.at };
	}
	writeStorage(STORAGE_KEYS.rightBySession, JSON.stringify(persisted));
}

function rememberRight(key: string, state: RightPanelState): void {
	const now = Date.now();
	rightBySession.set(key, { ...state, at: now });
	persistRightBySession(now);
}

/** Record the live panel state as the selected session's memory and persist. */
function persistRight(open: boolean, tabs: RightTab[], active: RightTab | null): void {
	rememberRight(rightKey(useUi.getState().selectedSessionId), { open, tabs, active });
}

const initialRight = rightBySession.get(NO_SESSION_KEY) ?? defaultRightMemo();

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

// Switching session swaps the right panel for that session's own remembered state.
useUi.subscribe((s, prev) => {
	if (s.selectedSessionId === prev.selectedSessionId) return;
	const current: RightPanelState = { open: s.rightOpen, tabs: s.openRightTabs, active: s.rightTab };
	rememberRight(rightKey(prev.selectedSessionId), current);
	const nextKey = rightKey(s.selectedSessionId);
	// The new-session placeholder (session pane, nothing selected) hands its panel
	// over to the session it turns into, instead of resetting under the user.
	const fromPlaceholder =
		prev.selectedSessionId === null && prev.centerView === "session" && s.selectedSessionId !== null;
	if (fromPlaceholder && !rightBySession.has(nextKey)) {
		rememberRight(nextKey, current);
		rememberRight(NO_SESSION_KEY, defaultRightMemo());
		return;
	}
	const next = rightBySession.get(nextKey) ?? defaultRightMemo();
	useUi.setState({ rightOpen: next.open, openRightTabs: next.tabs, rightTab: next.active });
});
