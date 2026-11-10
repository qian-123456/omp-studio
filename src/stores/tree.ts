/**
 * Per-session conversation-tree state (phase 1): the cached current leaf id
 * from `get_entries` plus the "edit & resend" draft banner state. The full entry
 * tree is not cached — siblings and parent chains are already in the
 * transcript items (`parentId`, §4), only `leafId` is missing there.
 * Entry identities from the confirmed tree guard against filtering newer
 * disk history with an older RPC snapshot.
 *
 * The leaf is fetched only for live, idle sessions: tree commands are
 * upstream RPC commands and are refused while streaming, and offline sessions
 * have no process to ask (their rendering stays unfiltered — a phase-1
 * limitation, see docs/ARCHITECTURE.md §7).
 */

import { create } from "zustand";
import { rpcSend } from "../lib/ipc";
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
	/** Fetch a flat entry/leaf snapshot for a live, idle session; silent on failure. */
	refreshLeaf(sessionId: string): Promise<void>;
	startResend(sessionId: string, draft: TreeResend): void;
	cancelResend(sessionId: string): void;
}

const leafRequests = new Map<string, number>();
const leafEntries = new Map<string, Set<string>>();

interface EntrySnapshot {
	entries: { id: string }[];
	leafId: string | null;
}

/** Canonical current branch, read directly after resume and before a leaf move. */
export async function readEntrySnapshot(sessionId: string): Promise<EntrySnapshot> {
	// The recursive `get_tree` exceeds the RPC JSON depth limit on long histories.
	const response = await rpcSend(sessionId, { type: "get_entries" }) as { data: EntrySnapshot };
	return response.data;
}

export const useTree = create<TreeState>((set, get) => ({
	leaf: {},
	resend: {},
	setLeaf: (sessionId, leafId) => {
		leafEntries.delete(sessionId);
		set((s) => s.leaf[sessionId] === leafId ? s : { leaf: { ...s.leaf, [sessionId]: leafId } });
	},
	refreshLeaf: async (sessionId) => {
		// Streaming/offline transitions also invalidate an older idle read.
		const request = (leafRequests.get(sessionId) ?? 0) + 1;
		leafRequests.set(sessionId, request);
		const live = useLive.getState().sessions[sessionId];
		if (!live?.alive) {
			get().setLeaf(sessionId, null);
			return;
		}
		if (live.streaming) return;
		const known = leafEntries.get(sessionId);
		if (!known || live.items.some((item) => !known.has(item.id))) {
			// An unconfirmed filter must not hide newly committed messages,
			// even if the next RPC read is refused or never completes.
			get().setLeaf(sessionId, null);
		}
		try {
			const data = await readEntrySnapshot(sessionId);
			if (leafRequests.get(sessionId) !== request) return;
			const ids = new Set(data.entries.map((entry) => entry.id));
			const items = useLive.getState().sessions[sessionId]?.items ?? [];
			if (items.some((item) => !ids.has(item.id))) {
				get().setLeaf(sessionId, null);
				return;
			}
			get().setLeaf(sessionId, data.leafId ?? null);
			leafEntries.set(sessionId, ids);
		} catch {
			// Keep only a branch confirmed against the current transcript.
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
