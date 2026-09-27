/** [B] Shared prompt-send helpers for Composer and the held-queue bar. */

import { create } from "zustand";
import { rpcEnsureLive, rpcSend } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useLive } from "../../stores/live";

export interface AbortState {
	aborting: Record<string, boolean>;
	setAborting(sessionId: string, aborting: boolean): void;
}

const abortTimers = new Map<string, number>();

function clearAbortTimer(sessionId: string) {
	const timer = abortTimers.get(sessionId);
	if (timer) {
		clearTimeout(timer);
		abortTimers.delete(sessionId);
	}
}

export const useAbortState = create<AbortState>((set) => ({
	aborting: {},
	setAborting: (sessionId, aborting) => {
		if (!aborting) {
			clearAbortTimer(sessionId);
		}
		set((s) => ({ aborting: { ...s.aborting, [sessionId]: aborting } }));
	},
}));
/**
 * Send a user prompt. Ensures the session is live first; while a turn is
 * streaming, `steer` sends it immediately (interrupt path) and otherwise the
 * caller is expected to have decided held-queue vs follow-up already — here a
 * non-steer send during streaming uses `followUp` (post-turn queue in omp).
 */
export async function sendPrompt(
	sessionId: string,
	text: string,
	opts?: { steer?: boolean },
): Promise<void> {
	const trimmed = text.trim();
	if (!trimmed) return;
	if (!useLive.getState().sessions[sessionId]?.alive) {
		await rpcEnsureLive(sessionId);
	}
	const streaming = useLive.getState().sessions[sessionId]?.streaming === true;
	const command: Record<string, unknown> = { type: "prompt", message: trimmed };
	if (streaming) {
		command.streamingBehavior = opts?.steer ? "steer" : "followUp";
	}
	await rpcSend(sessionId, command);
	// Optimistic echo: the prompt only lands in items via a transcript
	// fetch (mount / turn end), so without this the sent message is
	// invisible for the whole turn.
	useLive.getState().addUserEcho(sessionId, trimmed);
}

/** Abort the running turn with stopping transition state. */
export async function abortTurn(sessionId: string): Promise<void> {
	clearAbortTimer(sessionId);
	useAbortState.getState().setAborting(sessionId, true);

	const timer = window.setTimeout(() => {
		abortTimers.delete(sessionId);
		if (useAbortState.getState().aborting[sessionId]) {
			useAbortState.getState().setAborting(sessionId, false);
			toast.error("停止请求超时，未收到后端响应，请重试或检查进程状态");
		}
	}, 10_000);
	abortTimers.set(sessionId, timer);

	try {
		await rpcSend(sessionId, { type: "abort" });
	} catch (err) {
		clearAbortTimer(sessionId);
		useAbortState.getState().setAborting(sessionId, false);
		throw err;
	}
}
