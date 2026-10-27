import { create } from "zustand";
import { api, errorMessage } from "../../core/api";
import { events } from "../../core/sse";
import { useSessions } from "../../core/stores/sessions";
import type { SpaceMode } from "../../core/types";
import {
	loadPersistedTree,
	patchTreeSession,
	reuseSessions,
	savePersistedTree,
	type SessionTree,
	type TreeSession,
} from "./tree";

const storage = (): Storage | null => {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
};

const RELOAD_DEBOUNCE_MS = 400;

interface TreeState {
	mode: SpaceMode;
	data: SessionTree | null;
	error: string | null;
	loading: boolean;
	/** Persisted group open/closed overrides. Absent key = the group's default. */
	open: Record<string, boolean>;
	/** `moreKey` → how many sessions/subgroups the user expanded to (not persisted: matches the old behaviour). */
	expanded: Record<string, number>;
	setMode: (mode: SpaceMode) => void;
	load: () => Promise<void>;
	scheduleReload: () => void;
	toggle: (key: string, isOpenNow: boolean) => void;
	expand: (moreKey: string, to: number) => void;
	collapseMore: (moreKey: string) => void;
	patchSession: (id: string, patch: Partial<TreeSession>) => void;
	/** Latest session lists behind batch actions (set by the renderer after each flatten). */
	scopes: Record<string, TreeSession[]>;
	setScopes: (scopes: Record<string, TreeSession[]>) => void;
}

const persisted = loadPersistedTree(storage());
let timer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

export const useTree = create<TreeState>((set, get) => ({
	mode: persisted.mode,
	data: null,
	error: null,
	loading: false,
	open: persisted.open,
	expanded: {},
	scopes: {},
	setScopes: (scopes) => set({ scopes }),
	setMode: (mode) => {
		if (mode === get().mode) return;
		set({ mode, data: null, error: null, expanded: {} });
		savePersistedTree(storage(), { mode, open: get().open });
		void get().load();
	},
	load: async () => {
		const mine = get().mode;
		const my = ++seq;
		set({ loading: true });
		try {
			const tree = await api<SessionTree>("GET", `/left/sessions?mode=${mine}`);
			if (my !== seq || mine !== get().mode) return;
			set({ data: reuseSessions(get().data, tree), error: null, loading: false });
		} catch (e) {
			if (my !== seq) return;
			set({ error: errorMessage(e, "加载失败"), loading: false });
		}
	},
	scheduleReload: () => {
		clearTimeout(timer ?? undefined);
		timer = setTimeout(() => {
			timer = null;
			void get().load();
		}, RELOAD_DEBOUNCE_MS);
	},
	toggle: (key, isOpenNow) => {
		const open = { ...get().open, [key]: !isOpenNow };
		set({ open });
		savePersistedTree(storage(), { mode: get().mode, open });
	},
	expand: (moreKey, to) => set((s) => ({ expanded: { ...s.expanded, [moreKey]: to } })),
	collapseMore: (moreKey) =>
		set((s) => {
			const { [moreKey]: _drop, ...rest } = s.expanded;
			return { expanded: rest };
		}),
	patchSession: (id, patch) => {
		const d = get().data;
		if (d) set({ data: patchTreeSession(d, id, patch) });
	},
}));

/** Reload the tree and the flat store after a mutation (pin/archive/rename/…). */
export async function refreshAll(): Promise<void> {
	await Promise.allSettled([useTree.getState().load(), useSessions.getState().refresh()]);
}

let syncRefs = 0;
let syncOff: (() => void) | null = null;

/**
 * Keep the tree fresh from SSE while a page that shows it is mounted (ref-counted, shared by home and search).
 * A `session` event flips the status of just that row immediately; the structural refetch is debounced so a
 * burst of events costs one request and, thanks to structural sharing, re-renders only changed rows.
 */
export function startTreeSync(): () => void {
	if (syncRefs++ === 0) {
		const schedule = () => useTree.getState().scheduleReload();
		const offs = [
			events.on("hello", () => void useTree.getState().load()),
			events.on("resync", schedule),
			events.on("touch", schedule),
			events.on("session", (e) => {
				if (e.new) useTree.getState().patchSession(e.sessionId, { status: e.new as TreeSession["status"] });
				schedule();
			}),
		];
		syncOff = () => offs.forEach((off) => off());
	}
	let done = false;
	return () => {
		if (done) return;
		done = true;
		if (--syncRefs === 0) {
			syncOff?.();
			syncOff = null;
			clearTimeout(timer ?? undefined);
			timer = null;
		}
	};
}
