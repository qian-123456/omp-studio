/** [B] Shared prompt-send helpers for Composer and the held-queue bar. */

import { create } from "zustand";
import { confirmDialog } from "../../lib/dialogs";
import { ensureLive, ResumeCancelledError } from "../../lib/ensureLive";
import { privacyClassify, privacyMark, rpcSend, takeoverExternal } from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { toast } from "../../lib/toast";
import { dropEchoesForTexts, restoreTextsToDraft, useLive } from "../../stores/live";
import { useUi } from "../../stores/ui";
import { createSession } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import type { ImageAttachment, PrivacyMarkScope, SecretEntry } from "../../lib/contracts";
import { resolveLinkScope } from "./privacy/composerPrivacy";
import { isForkDraftId, sendFromForkDraft } from "../sessions/forkDraft";
import { isLocalDraftId } from "../sessions/pendingSession";
import { sendFromDraft } from "../sessions/draftSession";
import { emitPromptSend } from "../../stores/promptSendEvents";
import { tNow } from "../../stores/language";

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
	opts?: { steer?: boolean; images?: ImageAttachment[]; onEchoed?: (sessionId?: string) => void },
): Promise<void> {
	const trimmed = text.trim();
	if (!trimmed) return;
	// Local draft: no process exists yet. Spawn/join the prewarm, apply the
	// chosen model and thinking level, then send once on the real session
	// (its own echo releases the composer, keyed by the real id).
	if (isLocalDraftId(sessionId)) {
		return sendFromDraft(sessionId, (realId) => sendPrompt(realId, trimmed, opts));
	}
	// Fork draft: the first send creates the fork, then sends this text there.
	if (isForkDraftId(sessionId)) {
		const { onEchoed, ...rest } = opts ?? {};
		return sendFromForkDraft(
			sessionId,
			trimmed,
			{ images: opts?.images, onEchoed },
			(newId) => sendPrompt(newId, trimmed, rest),
		);
	}
	// Session running in an external terminal: take it over (the backend stops
	// the external PID and waits for it to flush its exit record) before
	// resuming an app-owned RPC process. Cancel aborts the send.
	const meta = useSessions.getState().sessions[sessionId];
	const external = meta?.status === "external";
	if (external) {
		const ok = await confirmDialog(
			tNow("chatView.send.takeoverConfirm"),
			{ danger: true, okLabel: tNow("chatView.send.takeoverAction") },
		);
		if (!ok) throw new ResumeCancelledError();
	}
	// Optimistic echo: add before network calls so the user bubble appears
	// immediately and never arrives after the assistant stream.
	const steerEcho =
		opts?.steer === true &&
		useLive.getState().sessions[sessionId]?.streaming === true;
	const echoId = useLive.getState().addUserEcho(sessionId, trimmed, opts?.images, steerEcho);
	// The message is now visible in the thread: let the caller release its input
	// instead of holding the text until slow resume/RPC calls below finish.
	emitPromptSend("echoed", sessionId, trimmed);
	opts?.onEchoed?.(sessionId);
	try {
		if (external) {
			await takeoverExternal(sessionId);
		} else if (!useLive.getState().sessions[sessionId]?.alive) {
			await ensureLive(sessionId);
		}
		const streaming = useLive.getState().sessions[sessionId]?.streaming === true;
		const command: Record<string, unknown> = { type: "prompt", message: trimmed };
		if (streaming) {
			command.streamingBehavior = opts?.steer ? "steer" : "followUp";
		}
		try {
			await rpcSend(sessionId, command);
		} catch (err) {
			// Live state said idle but omp is mid-turn (e.g. waiting on subagents,
			// or a stale `streaming` flag): resend as steer/followUp instead of failing.
			if (streaming || !/already processing/i.test(errMsg(err))) throw err;
			await rpcSend(sessionId, {
				...command,
				streamingBehavior: opts?.steer ? "steer" : "followUp",
			});
		}
		emitPromptSend("sent", sessionId, trimmed);
	} catch (err) {
		// Not sent: drop the bubble so a retry doesn't duplicate it.
		emitPromptSend("failed", sessionId, trimmed);
		if (echoId) useLive.getState().removeUserEcho(sessionId, echoId);
		const replacement = await replaceStaleDraft(sessionId, err);
		if (replacement) {
			const { onEchoed: _echoed, ...rest } = opts ?? {};
			return sendPrompt(replacement, trimmed, rest);
		}
		throw err;
	}
}

/**
 * A never-sent draft is only an RPC process: once it is gone (app restart,
 * idle reap) no transcript exists to resume, so "cannot locate session file"
 * can never succeed on retry. Start a fresh session in the same place, swap it
 * in for the stub, and let the caller send there. Returns the new id, or null
 * when `err` is something else or the session has real content.
 */
async function replaceStaleDraft(sessionId: string, err: unknown): Promise<string | null> {
	if (!errMsg(err).startsWith("cannot locate session file")) return null;
	const s = useSessions.getState().sessions[sessionId];
	if (!s || s.title?.trim() || s.label?.trim() || s.lastAssistant) return null;
	const { sessionId: newId, stub } = await createSession({
		cwd: s.cwd,
		model: s.model,
		workspaceId: s.workspaceId,
		mode: s.mode,
		groupId: s.groupId,
	});
	const ui = useUi.getState();
	const wasSelected = ui.selectedSessionId === sessionId;
	useSessions.getState().upsert([stub]);
	useSessions.getState().remove([sessionId]);
	if (wasSelected) ui.selectSession(newId);
	return newId;
}

/**
 * [P] After a masked send, link library entries that were auto-replaced to
 * the session (re-marking an existing value only links it). Best effort.
 */
export async function linkSentSecrets(
	sessionId: string,
	entries: SecretEntry[],
	sessionEntryIds: ReadonlySet<string>,
	scopes: Readonly<Record<string, PrivacyMarkScope>> = {},
): Promise<void> {
	const missing = entries.filter((e) => !sessionEntryIds.has(e.id));
	await Promise.all(
		missing.map(async (e) => {
			try {
				// A value already in the transcript was sent upstream: protect only later content.
				const remembered = scopes[e.id];
				const occurrences = remembered
					? 0
					: (await privacyClassify(sessionId, e.value)).sessionOccurrences;
				await privacyMark(sessionId, e.value, null, e.track, resolveLinkScope(remembered, occurrences));
			} catch (err) {
				console.warn("[privacy] link entry failed", err);
			}
		}),
	);
}

/** Texts of omp's `abort_and_restore_queue` result `{steering, followUp}`
 * (entries `{text}`), steering first; accepts the bare response frame too. */
export function restoredQueueTexts(resp: unknown): string[] {
	const frame = (resp ?? {}) as { data?: unknown };
	const data = (frame.data ?? frame) as { steering?: unknown; followUp?: unknown };
	const pick = (v: unknown): string[] =>
		Array.isArray(v)
			? v
					.map((x) => (typeof x === "string" ? x : (x as { text?: unknown } | null)?.text))
					.filter((t): t is string => typeof t === "string" && t.trim() !== "")
			: [];
	return [...pick(data.steering), ...pick(data.followUp)];
}

/** Abort the running turn with stopping transition state. */
export async function abortTurn(sessionId: string): Promise<void> {
	clearAbortTimer(sessionId);
	useAbortState.getState().setAborting(sessionId, true);

	const timer = window.setTimeout(() => {
		abortTimers.delete(sessionId);
		if (useAbortState.getState().aborting[sessionId]) {
			useAbortState.getState().setAborting(sessionId, false);
			toast.error(tNow("chatView.send.stopTimeout"));
		}
	}, 10_000);
	abortTimers.set(sessionId, timer);

	try {
		// Stop like Esc in omp's TUI: queued steer/follow-up inputs are
		// withdrawn and handed back instead of running after the abort.
		const resp = (await rpcSend(sessionId, { type: "abort_and_restore_queue" })) as unknown;
		const texts = restoredQueueTexts(resp);
		if (texts.length) {
			dropEchoesForTexts(sessionId, texts);
			restoreTextsToDraft(sessionId, texts);
		}
		// Backend acknowledged: no Composer may be mounted to clear the flag, so do it here.
		clearAbortTimer(sessionId);
		useAbortState.getState().setAborting(sessionId, false);
	} catch (err) {
		clearAbortTimer(sessionId);
		useAbortState.getState().setAborting(sessionId, false);
		throw err;
	}
}

/**
 * Abort the running turn, then wait until the live session stops streaming.
 * Resolves `true` once idle (immediately if nothing was streaming) and `false`
 * if the turn is still running after `timeoutMs`. Throws if the abort RPC fails.
 */
export async function interruptAndWait(sessionId: string, timeoutMs: number): Promise<boolean> {
	if (useLive.getState().sessions[sessionId]?.streaming !== true) return true;
	await abortTurn(sessionId);
	return new Promise<boolean>((resolve) => {
		let timer: number | undefined;
		const finish = (idle: boolean) => {
			if (timer !== undefined) window.clearTimeout(timer);
			unsubscribe();
			resolve(idle);
		};
		const unsubscribe = useLive.subscribe((state) => {
			if (state.sessions[sessionId]?.streaming !== true) finish(true);
		});
		timer = window.setTimeout(() => {
			finish(useLive.getState().sessions[sessionId]?.streaming !== true);
		}, timeoutMs);
		// The turn may have ended between the abort RPC and subscribing.
		if (useLive.getState().sessions[sessionId]?.streaming !== true) finish(true);
	});
}
