/**
 * [E] Zustand store for the global bottom-drawer terminal (Codex-style).
 * Holds UI state only (open/height/tab metas); PTY/xterm instances live in
 * drawerRegistry. open/height/tab metas persist to localStorage — tab
 * statuses are transient (restored tabs spawn their shell lazily on open).
 */
import { create } from "zustand";

const STORAGE_KEYS = {
	open: "ompws:drawer-open",
	height: "ompws:drawer-height",
	tabs: "ompws:drawer-tabs",
	maximized: "ompws:drawer-maximized",
} as const;

export const DRAWER_HEIGHT_MIN = 140;
export const DEFAULT_DRAWER_HEIGHT_VH = 0.4;
export const MAXIMIZED_DRAWER_HEIGHT_VH = 0.7;
export const MAX_DRAWER_HEIGHT_VH = 0.8;

export type DrawerTabStatus = "opening" | "ready" | "exited" | "error";

export interface DrawerTab {
	id: string;
	cwd: string;
	title: string;
	status: DrawerTabStatus;
	exitCode: number | null;
	detached?: boolean;
}

interface PersistedTab {
	id: string;
	cwd: string;
	title: string;
	detached?: boolean;
}

function readNumber(key: string, fallback: number, min: number, max: number): number {
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

/** Upper height bound in px (80vh), used by clampHeight. */
export function maxHeightPx(): number {
	if (typeof window === "undefined") return 800;
	return Math.floor(window.innerHeight * MAX_DRAWER_HEIGHT_VH);
}

/** Clamp a drawer height into [140px, 80vh]. */
export function clampHeight(h: number): number {
	return Math.min(maxHeightPx(), Math.max(DRAWER_HEIGHT_MIN, Math.round(h)));
}

function defaultHeight(): number {
	if (typeof window === "undefined") return 480;
	return clampHeight(window.innerHeight * DEFAULT_DRAWER_HEIGHT_VH);
}

function newTabId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function persistTabs(tabs: DrawerTab[]): void {
	const metas: PersistedTab[] = tabs.map(({ id, cwd, title, detached }) => ({
		id,
		cwd,
		title,
		...(detached ? { detached: true } : {}),
	}));
	try {
		if (typeof localStorage !== "undefined") {
			localStorage.setItem(STORAGE_KEYS.tabs, JSON.stringify(metas));
		}
	} catch {
		/* storage quota exceeded / unavailable */
	}
}

export interface DrawerState {
	open: boolean;
	height: number;
	maximized: boolean;
	tabs: DrawerTab[];
	activeTabId: string | null;
	toggle(): void;
	setOpen(open: boolean): void;
	setHeight(h: number): void;
	setMaximized(maximized: boolean): void;
	toggleMaximized(): void;
	/** Append a tab and activate it; returns the new tab id. */
	addTab(cwd: string, title: string): string;
	/** Drop a tab (PTY teardown is the caller's job via drawerRegistry). */
	removeTab(id: string): void;
	setActive(id: string): void;
	/** Patch a tab (status/exitCode transient; cwd/title/detached persisted). */
	updateTab(
		id: string,
		patch: Partial<Pick<DrawerTab, "status" | "exitCode" | "cwd" | "title" | "detached">>,
	): void;
	/** Detach a tab to run headless in background services. */
	detachTab(id: string): void;
	/** Reattach a detached tab and bring drawer up focused on it. */
	reattachTab(id: string): void;
	/** Restore open/height/maximized/tab metas from localStorage (call once on mount). */
	hydrate(): void;
}

export const useDrawerStore = create<DrawerState>((set, get) => ({
	open: false,
	height: defaultHeight(),
	maximized: false,
	tabs: [],
	activeTabId: null,
	toggle: () => get().setOpen(!get().open),
	setOpen: (open) => {
		writeStorage(STORAGE_KEYS.open, open);
		set({ open });
	},
	setHeight: (h) => {
		const clamped = clampHeight(h);
		writeStorage(STORAGE_KEYS.height, clamped);
		if (get().maximized) {
			writeStorage(STORAGE_KEYS.maximized, false);
			set({ height: clamped, maximized: false });
		} else {
			set({ height: clamped });
		}
	},
	setMaximized: (maximized) => {
		writeStorage(STORAGE_KEYS.maximized, maximized);
		set({ maximized });
	},
	toggleMaximized: () => {
		const next = !get().maximized;
		writeStorage(STORAGE_KEYS.maximized, next);
		set({ maximized: next });
	},
	addTab: (cwd, title) => {
		const id = newTabId();
		set((s) => {
			const tabs = [...s.tabs, { id, cwd, title, status: "opening" as const, exitCode: null, detached: false }];
			persistTabs(tabs);
			return { tabs, activeTabId: id };
		});
		return id;
	},
	removeTab: (id) =>
		set((s) => {
			const idx = s.tabs.findIndex((t) => t.id === id);
			if (idx < 0) return s;
			const tabs = s.tabs.filter((t) => t.id !== id);
			const visible = tabs.filter((t) => !t.detached);
			const activeTabId =
				s.activeTabId === id ? (visible[Math.min(idx, visible.length - 1)]?.id ?? null) : s.activeTabId;
			persistTabs(tabs);
			return { tabs, activeTabId };
		}),
	setActive: (id) => set({ activeTabId: id }),
	updateTab: (id, patch) =>
		set((s) => {
			const tabs = s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t));
			if (patch.cwd !== undefined || patch.title !== undefined || patch.detached !== undefined) {
				persistTabs(tabs);
			}
			return { tabs };
		}),
	detachTab: (id) =>
		set((s) => {
			const tabs = s.tabs.map((t) => (t.id === id ? { ...t, detached: true } : t));
			persistTabs(tabs);
			const visible = tabs.filter((t) => !t.detached);
			const activeTabId =
				s.activeTabId === id ? (visible[0]?.id ?? null) : s.activeTabId;
			const open = visible.length > 0 ? s.open : false;
			if (!open && s.open) {
				writeStorage(STORAGE_KEYS.open, false);
			}
			return { tabs, activeTabId, open };
		}),
	reattachTab: (id) => {
		writeStorage(STORAGE_KEYS.open, true);
		set((s) => {
			const tabs = s.tabs.map((t) => (t.id === id ? { ...t, detached: false } : t));
			persistTabs(tabs);
			return { tabs, activeTabId: id, open: true };
		});
	},
	hydrate: () => {
		const open = readBool(STORAGE_KEYS.open, false);
		const height = readNumber(STORAGE_KEYS.height, defaultHeight(), DRAWER_HEIGHT_MIN, maxHeightPx());
		const maximized = readBool(STORAGE_KEYS.maximized, false);
		let tabs: DrawerTab[] = [];
		try {
			const raw = localStorage.getItem(STORAGE_KEYS.tabs);
			if (raw) {
				const metas = JSON.parse(raw) as PersistedTab[];
				tabs = metas
					.filter((t) => t && typeof t.id === "string" && typeof t.cwd === "string")
					.map((t) => ({
						id: t.id,
						cwd: t.cwd,
						title: t.title,
						status: "opening" as const,
						exitCode: null,
						detached: Boolean(t.detached),
					}));
			}
		} catch {
			/* corrupted metas — start clean */
		}
		writeStorage(STORAGE_KEYS.open, open);
		writeStorage(STORAGE_KEYS.height, height);
		writeStorage(STORAGE_KEYS.maximized, maximized);
		const visible = tabs.filter((t) => !t.detached);
		set({ open, height, maximized, tabs, activeTabId: visible[0]?.id ?? null });
	},

}));
