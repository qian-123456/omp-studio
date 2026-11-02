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
	scope: string;
	sessionId: string | null;
	workspaceId: string | null;
	title: string;
	status: DrawerTabStatus;
	exitCode: number | null;
	detached?: boolean;
}

interface PersistedTab {
	id: string;
	cwd: string;
	scope?: string;
	sessionId?: string | null;
	workspaceId?: string | null;
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
	const metas: PersistedTab[] = tabs.map(({ id, cwd, scope, sessionId, workspaceId, title, detached }) => ({
		id,
		cwd,
		scope,
		sessionId,
		workspaceId,
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
				scope: t.scope ?? t.cwd,
				sessionId: t.sessionId ?? null,
				workspaceId: t.workspaceId ?? null,
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
	scope: string;
	activeByScope: Record<string, string>;
	setScope(scope: string): void;
	reconcileScopes(scopes: Record<string, string>): void;
	/** Append a tab and activate it; returns the new tab id. */
	addTab(cwd: string, title: string, sessionId?: string | null, scope?: string, workspaceId?: string | null): string;
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
	scope: "",
	activeByScope: {},
	setScope: (scope) => set((s) => {
		const visible = s.tabs.filter((t) => !t.detached && t.scope === scope);
		const saved = s.activeByScope[scope];
		return { scope, activeTabId: visible.some((t) => t.id === saved) ? saved : (visible[0]?.id ?? null) };
	}),
	reconcileScopes: (scopes) => set((s) => {
		if (!s.tabs.some((tab) => scopes[tab.id] !== undefined && scopes[tab.id] !== tab.scope)) return s;
		const activeByScope: Record<string, string> = {};
		const tabs = s.tabs.map((tab) => {
			const scope = scopes[tab.id] ?? tab.scope;
			if (s.activeByScope[tab.scope] === tab.id) activeByScope[scope] = tab.id;
			return scope === tab.scope ? tab : { ...tab, scope };
		});
		const active = tabs.find((tab) => tab.id === s.activeTabId && !tab.detached);
		if (active) activeByScope[active.scope] = active.id;
		persistTabs(tabs);
		return { tabs, activeByScope };
	}),
	addTab: (cwd, title, sessionId = null, scope = cwd, workspaceId = null) => {
		const id = newTabId();
		set((s) => {
			const tabs = [...s.tabs, { id, cwd, scope, sessionId, workspaceId, title, status: "opening" as const, exitCode: null, detached: false }];
			persistTabs(tabs);
			return { tabs, activeTabId: id, activeByScope: { ...s.activeByScope, [scope]: id } };
		});
		return id;
	},
	removeTab: (id) =>
		set((s) => {
			const idx = s.tabs.findIndex((t) => t.id === id);
			if (idx < 0) return s;
			const tabs = s.tabs.filter((t) => t.id !== id);
			const visible = tabs.filter((t) => !t.detached && t.scope === s.scope);
			const activeTabId = s.activeTabId === id ? (visible[0]?.id ?? null) : s.activeTabId;
			persistTabs(tabs);
			return { tabs, activeTabId };
		}),
	setActive: (id) => set((s) => {
		const tab = s.tabs.find((t) => t.id === id && !t.detached);
		return tab ? { activeTabId: id, activeByScope: { ...s.activeByScope, [tab.scope]: id } } : s;
	}),
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
			const activeTabId = s.activeTabId === id ? firstVisibleId(tabs.filter((t) => t.scope === s.scope)) : s.activeTabId;
			return { tabs, activeTabId };
		}),
	reattachTab: (id) =>
		set((s) => {
			const tabs = s.tabs.map((t) => (t.id === id ? { ...t, detached: false } : t));
			persistTabs(tabs);
			const tab = tabs.find((t) => t.id === id);
			return tab ? { tabs, activeTabId: id, activeByScope: { ...s.activeByScope, [tab.scope]: id } } : { tabs };
		}),
	hydrate: () => {
		const tabs = loadTabs();
		set({ tabs, activeTabId: firstVisibleId(tabs) });
	},
}));
