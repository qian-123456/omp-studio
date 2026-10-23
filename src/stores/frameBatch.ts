import type { RpcFramePayload } from "../lib/events";

/**
 * Coalesces superseded streaming frames before they reach the live store.
 *
 * omp emits one `message_update` per token and each carries the whole message
 * so far; `tool_execution_update` likewise carries the cumulative partial
 * result. Reducing each one costs a store update plus re-render and keeps the
 * stale snapshot alive until GC, so a burst of N frames costs O(N * size).
 * Only the newest snapshot of such a burst matters, so a newer frame replaces
 * an older pending one of the same kind. Frames of any other type are never
 * dropped or reordered, and a pending frame is never moved past a frame that
 * does not commute with it.
 */

type Frame = { type?: unknown; toolCallId?: unknown };

const asFrame = (f: unknown): Frame =>
	f && typeof f === "object" ? (f as Frame) : {};

/** Frames that only touch `streamingMessage` / `tools[id]`, so they commute. */
function coalesceKey(frame: Frame): string | null {
	if (frame.type === "message_update") return "mu";
	if (frame.type === "tool_execution_update" && typeof frame.toolCallId === "string")
		return `tu:${frame.toolCallId}`;
	return null;
}

export function createFrameBatcher(
	deliver: (payload: RpcFramePayload) => void,
	schedule: (flush: () => void) => void,
): { push(payload: RpcFramePayload): void; flush(): void } {
	let queue: RpcFramePayload[] = [];
	let scheduled = false;

	const flush = () => {
		scheduled = false;
		const batch = queue;
		queue = [];
		for (const payload of batch) deliver(payload);
	};

	return {
		flush,
		push(payload) {
			const frame = asFrame(payload.frame);
			const key = coalesceKey(frame);
			let replaced = false;
			if (key) {
				for (let i = queue.length - 1; i >= 0; i--) {
					const prev = queue[i];
					if (prev.sessionId !== payload.sessionId) continue;
					const prevFrame = asFrame(prev.frame);
					const prevKey = coalesceKey(prevFrame);
					if (prevKey === key) {
						queue[i] = payload;
						replaced = true;
						break;
					}
					// Anything that is not a streaming snapshot may depend on order.
					if (!prevKey) break;
				}
			}
			if (!replaced) queue.push(payload);
			if (!scheduled) {
				scheduled = true;
				schedule(flush);
			}
		},
	};
}

/** Next animation frame, with a timer fallback for hidden windows (rAF pauses). */
export function scheduleFlush(flush: () => void): void {
	let done = false;
	const run = () => {
		if (done) return;
		done = true;
		flush();
	};
	if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
	setTimeout(run, 100);
}
