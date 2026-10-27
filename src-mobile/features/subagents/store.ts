/**
 * Shared per-session subagent list: one zustand store + one poller, so the
 * capsule and the full page never issue duplicate requests.
 */
import { useEffect } from "react";
import { create } from "zustand";
import { api, errorMessage } from "../../core/api";
import { events } from "../../core/sse";
import { isDraftId } from "../../core/types";
import { anyActive, isSubagentFrame, mergeSubagents } from "./model";
import type { SubagentSummary } from "./model";
import { createPoller } from "./poller";

export interface SubagentEntry {
	rows: SubagentSummary[];
	loaded: boolean;
	error: string | null;
}

const EMPTY: SubagentEntry = { rows: [], loaded: false, error: null };

interface SubagentState {
	bySession: Record<string, SubagentEntry>;
}

export const useSubagentStore = create<SubagentState>(() => ({ bySession: {} }));

function patch(id: string, next: Partial<SubagentEntry>): void {
	useSubagentStore.setState((s) => ({
		bySession: { ...s.bySession, [id]: { ...(s.bySession[id] ?? EMPTY), ...next } },
	}));
}

async function fetchList(id: string): Promise<void> {
	if (isDraftId(id)) {
		patch(id, { rows: [], loaded: true, error: null });
		return;
	}
	try {
		const list = await api<SubagentSummary[]>("GET", `/sessions/${encodeURIComponent(id)}/subagents`);
		const prev = useSubagentStore.getState().bySession[id]?.rows ?? [];
		patch(id, { rows: mergeSubagents(prev, Array.isArray(list) ? list : []), loaded: true, error: null });
	} catch (e) {
		patch(id, { loaded: true, error: errorMessage(e, "加载失败") });
	}
}

export const poller = createPoller({
	fetch: fetchList,
	isRunning: (id) => anyActive(useSubagentStore.getState().bySession[id]?.rows ?? []),
});

const SSE_DEBOUNCE_MS = 400;
let sseInstalled = false;
const pending = new Map<string, number>();

function refreshSoon(id: string): void {
	clearTimeout(pending.get(id));
	pending.set(
		id,
		window.setTimeout(() => {
			pending.delete(id);
			void poller.refresh(id);
		}, SSE_DEBOUNCE_MS),
	);
}

/** Subscribe once to the SSE events that can change a subagent list; refresh is a no-op for unwatched sessions. */
function ensureSse(): void {
	if (sseInstalled) return;
	sseInstalled = true;
	events.on("rpc", (d) => {
		if (d?.sessionId && isSubagentFrame(d.frame)) refreshSoon(d.sessionId);
	});
	events.on("touch", (d) => {
		if (d?.sessionId) refreshSoon(d.sessionId);
	});
	events.on("resync", () => poller.refreshAll());
}

/** Watch a session's subagents while mounted (fetch now, poll while any is running). */
export function useWatchSubagents(sessionId: string): SubagentEntry {
	useEffect(() => {
		ensureSse();
		return poller.watch(sessionId);
	}, [sessionId]);
	return useSubagentStore((s) => s.bySession[sessionId]) ?? EMPTY;
}

export function refreshSubagents(sessionId: string): Promise<void> {
	return poller.refresh(sessionId);
}
