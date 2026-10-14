/**
 * Side-chat panel view state: which child thread is open, per parent session.
 * Persisted so the open thread survives panel collapse/expand, right-tab
 * switches and app restarts. The per-parent input draft lives in
 * `useComposer.sideChatDrafts`. [LEAD]
 */

import { create } from "zustand";

const STORAGE_KEY = "omp_sidechat_open_child";

/** Load a parentId -> childId map; empty values are dropped. */
function loadMap(key: string): Record<string, string> {
	try {
		if (typeof localStorage === "undefined") return {};
		const raw = localStorage.getItem(key);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return {};
		const out: Record<string, string> = {};
		for (const [k, v] of Object.entries(parsed)) {
			if (typeof v === "string" && v) out[k] = v;
		}
		return out;
	} catch {
		return {};
	}
}

function saveMap(key: string, map: Record<string, string>): void {
	try {
		if (typeof localStorage === "undefined") return;
		const compact: Record<string, string> = {};
		for (const [k, v] of Object.entries(map)) if (v) compact[k] = v;
		localStorage.setItem(key, JSON.stringify(compact));
	} catch {
		/* storage unavailable */
	}
}

export interface SideChatViewState {
	/** Open child thread keyed by parent sessionId (persisted). */
	openChild: Record<string, string>;
	setOpenChild(parentId: string, childId: string | null): void;
}

export const useSideChatView = create<SideChatViewState>((set) => ({
	openChild: loadMap(STORAGE_KEY),
	setOpenChild: (parentId, childId) =>
		set((s) => {
			const openChild = { ...s.openChild };
			if (childId) openChild[parentId] = childId;
			else delete openChild[parentId];
			saveMap(STORAGE_KEY, openChild);
			return { openChild };
		}),
}));
