/**
 * UI state: selected session, center view, right tab, modals (§10). [LEAD]
 */

import { create } from "zustand";

export type CenterView = "home" | "session" | "doc" | "backlog" | "settings" | "agentTerminal";
export type RightTab = "explorer" | "sidechat" | "heatmap" | "todos" | "git" | "services";

const STORAGE_KEYS = {
	sidebarWidth: "ompws:sidebar-width",
	rightWidth: "ompws:right-width",
	sidebarOpen: "ompws:sidebar-open",
	rightOpen: "ompws:right-open",
	lastSession: "ompws:last-session",
	rightTab: "ompws:right-tab",
};

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

export interface UiState {
	centerView: CenterView;
	previousCenterView: CenterView | null;
	selectedSessionId: string | null;
	selectedIds: Set<string>;
	highlightId: string | null;
	lastSessionId: string | null;
	docPath: string | null;
	rightTab: RightTab | null;
	rightOpen: boolean;
	rightWidth: number;
	sidebarOpen: boolean;
	sidebarWidth: number;
	sessionViewMode: Record<string, "chat" | "terminal">;
	/** Settings section to show when the settings view opens (e.g. from the theme menu). */
	settingsSection: string | null;
	modal: { name: string; props: Record<string, unknown> } | null;
	selectSession(id: string | null): void;
	setSelectedIds(ids: Set<string> | string[]): void;
	toggleSelectId(id: string): void;
	setHighlightId(id: string | null): void;
	returnToSession(): void;
	openDoc(path: string): void;
	setCenter(v: CenterView): void;
	openSettings(section?: string): void;
	closeSettings(): void;
	setRightTab(t: RightTab | null): void;
	toggleRight(): void;
	setRightOpen(open: boolean): void;
	setRightWidth(w: number): void;
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
	rightTab: (readString(STORAGE_KEYS.rightTab) as RightTab | null) ?? "explorer",
	rightOpen: readBool(STORAGE_KEYS.rightOpen, true),
	rightWidth: readNumber(STORAGE_KEYS.rightWidth, 360, 260, 720),
	sidebarOpen: readBool(STORAGE_KEYS.sidebarOpen, true),
	sidebarWidth: readNumber(STORAGE_KEYS.sidebarWidth, 280, 180, 600),
	sessionViewMode: {},
	settingsSection: null,
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
			return { centerView: "session" };
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
	openSettings: (section) =>
		set((s) => ({
			previousCenterView:
				s.centerView !== "settings" ? s.centerView : s.previousCenterView,
			centerView: "settings",
			settingsSection: section ?? null,
		})),
	closeSettings: () =>
		set((s) => {
			const prev =
				s.previousCenterView ?? (s.selectedSessionId ? "session" : "home");
			return { centerView: prev, settingsSection: null };
		}),
	setRightTab: (t) => {
		if (t) {
			writeStorage(STORAGE_KEYS.rightTab, t);
			writeStorage(STORAGE_KEYS.rightOpen, true);
			set({ rightTab: t, rightOpen: true });
		} else {
			set({ rightTab: null });
		}
	},
	toggleRight: () =>
		set((s) => {
			const next = !s.rightOpen;
			writeStorage(STORAGE_KEYS.rightOpen, next);
			return { rightOpen: next };
		}),
	setRightOpen: (open) => {
		writeStorage(STORAGE_KEYS.rightOpen, open);
		set({ rightOpen: open });
	},
	setRightWidth: (w) => {
		const clamped = Math.min(720, Math.max(260, w));
		writeStorage(STORAGE_KEYS.rightWidth, clamped);
		set({ rightWidth: clamped });
	},
	toggleSidebar: () =>
		set((s) => {
			const next = !s.sidebarOpen;
			writeStorage(STORAGE_KEYS.sidebarOpen, next);
			return { sidebarOpen: next };
		}),
	setSidebarOpen: (open) => {
		writeStorage(STORAGE_KEYS.sidebarOpen, open);
		set({ sidebarOpen: open });
	},
	setSidebarWidth: (w) => {
		const clamped = Math.min(600, Math.max(180, w));
		writeStorage(STORAGE_KEYS.sidebarWidth, clamped);
		set({ sidebarWidth: clamped });
	},
	setSessionViewMode: (id, m) =>
		set((s) => ({ sessionViewMode: { ...s.sessionViewMode, [id]: m } })),
	openModal: (name, props = {}) => set({ modal: { name, props } }),
	closeModal: () => set({ modal: null }),
}));
