/**
 * [B] Persistent hint for a stop request the backend never answered. The
 * turn-level stop RPC (`abort_and_restore_queue`) times out after 10s; instead
 * of a transient toast the UI then keeps a banner ("停止请求未响应") until the
 * turn really ends, with two actions: retry the stop, or restart the session
 * (history preserved). No process-level kill is attempted automatically — a
 * turn may still be finishing its final writes.
 */

import { useLive } from "../../stores/live";
import { create } from "zustand";

export interface StopHintState {
	/** Session ids whose stop request timed out (banner shown). */
	timedOut: Record<string, boolean>;
	show(sessionId: string): void;
	clear(sessionId: string): void;
}

export const useStopHint = create<StopHintState>((set) => ({
	timedOut: {},
	show: (sessionId) =>
		set((s) =>
			s.timedOut[sessionId] ? s : { timedOut: { ...s.timedOut, [sessionId]: true } },
		),
	clear: (sessionId) =>
		set((s) => {
			if (!s.timedOut[sessionId]) return s;
			const timedOut = { ...s.timedOut };
			delete timedOut[sessionId];
			return { timedOut };
		}),
}));

// The hint is only honest while the turn is still running: `agent_end`,
// `get_state` idle and process exit all flip `streaming` off, and a fresh
// turn means the backend answered again — either way retire the banner
// without user action. Guarded: tests mock the live store partially.
if (typeof useLive.subscribe === "function") {
	useLive.subscribe((s, prev) => {
		const { clear } = useStopHint.getState();
		for (const [sid, live] of Object.entries(s.sessions)) {
			const wasStreaming = prev.sessions[sid]?.streaming === true;
			if (live.streaming) {
				if (wasStreaming) continue;
				// A new turn started: the backend is alive again.
				clear(sid);
			} else if (wasStreaming) {
				// The turn really ended.
				clear(sid);
			}
		}
	});
}
