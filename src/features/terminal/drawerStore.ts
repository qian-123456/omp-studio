/**
 * [E] Zustand store for the right-panel command terminal (RightTab "terminal").
 * Holds tab metas only; PTY/xterm instances live in drawerRegistry so they
 * survive the panel body unmounting. Tab metas persist to localStorage and are
 * loaded when the store is created — statuses are transient (restored tabs
 * spawn their shell lazily when the panel shows them).
 */
import { create } from "zustand";

const TABS_STORAGE_KEY = "ompws:drawer-tabs";

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

/** Command tabs shown in the panel (not detached) whose shell is running. */
export function countLiveCommandTabs(tabs: DrawerTab[]): number {
	return tabs.filter((t) => !t.detached && t.status === "ready").length;
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
			localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(metas));
		}
	} catch {
		/* storage quota exceeded / unavailable */
	}
}

function loadTabs(): DrawerTab[] {
	try {
		if (typeof localStorage === "undefined") return [];
		const raw = localStorage.getItem(TABS_STORAGE_KEY);
		if (!raw) return [];
		const metas = JSON.parse(raw) as PersistedTab[];
		return metas
			.filter((t) => t && typeof t.id === "string" && typeof t.cwd === "string")
			.map((t) => ({
				id: t.id,
				cwd: t.cwd,
				title: t.title,
				status: "opening" as const,
				exitCode: null,
				detached: Boolean(t.detached),
			}));
	} catch {
		/* corrupted metas — start clean */
		return [];
	}
}

function firstVisibleId(tabs: DrawerTab[]): string | null {
	return tabs.find((t) => !t.detached)?.id ?? null;
}

export interface DrawerState {
	tabs: DrawerTab[];
	activeTabId: string | null;
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
	/** Reattach a detached tab and make it active (caller shows the panel). */
	reattachTab(id: string): void;
	/** Re-read tab metas from localStorage (already done at store creation). */
	hydrate(): void;
}

const initialTabs = loadTabs();

export const useDrawerStore = create<DrawerState>((set) => ({
	tabs: initialTabs,
	activeTabId: firstVisibleId(initialTabs),
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
			const activeTabId = s.activeTabId === id ? firstVisibleId(tabs) : s.activeTabId;
			return { tabs, activeTabId };
		}),
	reattachTab: (id) =>
		set((s) => {
			const tabs = s.tabs.map((t) => (t.id === id ? { ...t, detached: false } : t));
			persistTabs(tabs);
			return { tabs, activeTabId: id };
		}),
	hydrate: () => {
		const tabs = loadTabs();
		set({ tabs, activeTabId: firstVisibleId(tabs) });
	},
}));
