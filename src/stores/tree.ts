/**
 * Per-session conversation-tree state (phase 1): the cached current leaf id
 * from `get_tree` plus the "edit & resend" draft banner state. The full entry
 * tree is not cached — siblings and parent chains are already in the
 * transcript items (`parentId`, §4), only `leafId` is missing there.
 *
 * The leaf is fetched only for live, idle sessions: tree commands are
 * upstream RPC commands and are refused while streaming, and offline sessions
 * have no process to ask (their rendering stays unfiltered — a phase-1
 * limitation, see docs/ARCHITECTURE.md §7).
 */

import { create } from "zustand";
import { treeGet } from "../lib/ipc";
import { useLive } from "./live";

export interface TreeResend {
	/** User entry the composer will restart from (already navigated past). */
	entryId: string;
	/** Leaf before the navigation; a cancelled edit navigates back to it. */
	prevLeafId: string | null;
}

interface TreeState {
	/** Session id → current leaf id (unknown sessions absent). */
	leaf: Record<string, string | null>;
	/** Session id → active edit-&-resend draft. */
	resend: Record<string, TreeResend | undefined>;
	setLeaf(sessionId: string, leafId: string | null): void;
	/** Fetch `get_tree` for a live, non-streaming session; silent on failure. */
	refreshLeaf(sessionId: string): Promise<void>;
	startResend(sessionId: string, draft: TreeResend): void;
	cancelResend(sessionId: string): void;
}

export const useTree = create<TreeState>((set, get) => ({
	leaf: {},
	resend: {},
	setLeaf: (sessionId, leafId) =>
		set((s) => ({ leaf: { ...s.leaf, [sessionId]: leafId } })),
	refreshLeaf: async (sessionId) => {
		const live = useLive.getState().sessions[sessionId];
		if (!live?.alive || live.streaming) return;
		try {
			const data = await treeGet(sessionId);
			get().setLeaf(sessionId, data.leafId ?? null);
		} catch {
			// Offline / refused: keep the previous leaf (or none) and the
			// unfiltered rendering that goes with it.
		}
	},
	startResend: (sessionId, draft) =>
		set((s) => ({ resend: { ...s.resend, [sessionId]: draft } })),
	cancelResend: (sessionId) =>
		set((s) => {
			if (!(sessionId in s.resend)) return s;
			const { [sessionId]: _gone, ...rest } = s.resend;
			return { resend: rest };
		}),
}));
