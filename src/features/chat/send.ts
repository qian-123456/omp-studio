/** [B] Shared prompt-send helpers for Composer and the held-queue bar. */

import { rpcEnsureLive, rpcSend } from "../../lib/ipc";
import { useLive } from "../../stores/live";

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
}

/** Abort the running turn. */
export async function abortTurn(sessionId: string): Promise<void> {
	await rpcSend(sessionId, { type: "abort" });
}
