/**
 * Cross-feature "locate this tool call in the chat" target. The Token usage
 * panel sets it (one group of same-name calls, `index` = the current one); the
 * chat MessageList scrolls to / highlights `callIds[index]` and renders the
 * 「已定位」 pill with previous/next stepping. Ids are tool call ids
 * (`TranscriptItem.toolCalls[].id`), the same ids the transcript steps carry.
 */
import { create } from "zustand";

export interface LocateTarget {
	sessionId: string;
	/** Group name shown in the pill, e.g. "web_search". */
	name: string;
	/** Tool call ids of the group, in call order. */
	callIds: string[];
	/** Current position in `callIds`. */
	index: number;
	/** Re-fires the chat jump even when the same call is located twice. */
	nonce: number;
}

/** Pill text for the current call, e.g. 「已定位：web_search #3」. */
export function locateLabel(name: string, index: number): string {
	return `已定位：${name} #${index + 1}`;
}

/** Id of the call the target points at, or null when out of range. */
export function currentLocateId(t: Pick<LocateTarget, "callIds" | "index"> | null): string | null {
	if (!t) return null;
	return t.callIds[t.index] ?? null;
}

/** Next index in direction `dir`, clamped to [0, count-1]. */
export function stepLocateIndex(index: number, count: number, dir: 1 | -1): number {
	if (count <= 0) return 0;
	return Math.min(count - 1, Math.max(0, index + dir));
}

let seq = 0;

export const useLocate = create<{
	target: LocateTarget | null;
	/** Locate `callIds[index]` (default: the first) of a group in a session. */
	locate(sessionId: string, name: string, callIds: string[], index?: number): void;
	step(dir: 1 | -1): void;
	clear(): void;
}>((set, get) => ({
	target: null,
	locate: (sessionId, name, callIds, index = 0) => {
		if (callIds.length === 0) return;
		set({
			target: {
				sessionId,
				name,
				callIds,
				index: Math.min(callIds.length - 1, Math.max(0, index)),
				nonce: ++seq,
			},
		});
	},
	step: (dir) => {
		const t = get().target;
		if (!t) return;
		const next = stepLocateIndex(t.index, t.callIds.length, dir);
		if (next === t.index) return;
		set({ target: { ...t, index: next, nonce: ++seq } });
	},
	clear: () => set({ target: null }),
}));
