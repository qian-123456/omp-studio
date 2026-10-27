/** Live streaming reducer: wraps core `applyLiveFrame` with the working flag and persisted-row pruning. */
import { applyLiveFrame } from "../../../core/normalize";
import type { Item, RpcFrame } from "../../../core/types";

export interface StreamState {
	live: Item | null;
	working: boolean;
}

export interface StreamStep {
	state: StreamState;
	/** Re-fetch the transcript (debounced by the caller). */
	refetch: boolean;
	/** Re-read composer-state shortly after (agent start / end). */
	reloadState: boolean;
	/** A turn just ended (terminal agent_end): drives attention fallback. */
	turnEnded: boolean;
	/** The terminal end dropped a live row that still holds text: caller keeps it until the next fetch lands. */
	dropped: Item | null;
	handled: boolean;
}

export function reduceFrame(prev: StreamState, frame: RpcFrame, now?: string): StreamStep {
	const u = applyLiveFrame(prev.live, frame, now);
	const working = u.streaming === null ? prev.working : u.streaming;
	const ended = frame.type === "agent_end" && u.streaming === false;
	return {
		state: { live: u.live, working },
		refetch: u.refetch,
		reloadState: frame.type === "agent_start" || frame.type === "agent_end",
		turnEnded: ended && prev.working,
		dropped: u.live === null && prev.live && (prev.live.text || prev.live.thinking) ? prev.live : null,
		handled: u.handled,
	};
}

/**
 * True once the persisted tail already contains the streamed message, so the live copy must stop rendering
 * (text equal / suffix, or a thinking-only message whose thinking is persisted).
 */
export function livePersisted(items: readonly Item[], live: Item | null): boolean {
	if (!live) return false;
	const tail = items[items.length - 1];
	if (!tail || tail.role !== "assistant") return false;
	const lt = live.text.trim();
	const tt = tail.text.trim();
	if (lt) return !!tt && (tt === lt || tt.endsWith(lt));
	const lk = live.thinking.trim();
	return !!lk && tail.thinking.trim() === lk;
}

/** After persistence the live row keeps only still-unresolved tools; its text/thinking are cleared. */
export function pruneLive(items: readonly Item[], live: Item | null): Item | null {
	if (!live) return live;
	const resolved = new Set<string>();
	for (let i = items.length - 1; i >= 0 && resolved.size < 64; i--) {
		for (const t of items[i].tools) if (t.status !== "running") resolved.add(t.id);
		if (items[i].role === "user") break;
	}
	let next = live;
	if (livePersisted(items, live)) next = { ...next, text: "", thinking: "" };
	const tools = next.tools.filter((t) => !resolved.has(t.id));
	if (tools.length !== next.tools.length) next = { ...next, tools };
	return next === live ? live : next;
}
