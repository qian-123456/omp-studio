/**
 * Start a stopped session's omp process as soon as the user edits its draft.
 *
 * omp only advertises `skill:*` and other dynamic slash commands while a process
 * runs, and stored / idle-suspended sessions have none until the first send.
 * Starting it on the first keystroke makes the full command list available by
 * the time the user reaches `/`. The on-disk skill fallback in Composer still
 * covers the 1–2 s the spawn takes and any failed start.
 *
 * The start is silent: it calls `rpcEnsureLive` directly (not `ensureLive`) so
 * no resume-missing-cwd dialog can open, and it never runs for sessions held by
 * an external terminal (the backend would kill that process to take over).
 * Side effects match any resume: `suspended` is cleared and `last_activity`
 * touched backend-side, the sidebar shows the live process. The first prompt's
 * model / plan mode are unaffected — plan mode is a client-side message prefix
 * and a model pick is sent as `set_model` after the process is alive.
 */

import { useCallback, useEffect, useRef } from "react";
import { rpcEnsureLive } from "../../lib/ipc";
import { isForkDraftId } from "../sessions/forkDraft";
import type { SessionMeta } from "../../lib/contracts";

/** Sessions with a start in flight: one spawn per session across all composers. */
const inFlight = new Set<string>();

/** A stopped session worth resuming: stored transcript, app-owned, not archived. */
export function canStartOnType(
	meta: SessionMeta | undefined,
	sessionId: string,
	readonly: boolean | undefined,
): boolean {
	if (readonly || !meta || isForkDraftId(sessionId)) return false;
	if (!meta.file || meta.archived) return false;
	if (meta.status === "external" || meta.externalPid != null) return false;
	// A brand-new draft stub has no transcript to resume ("cannot locate session file").
	return Boolean(meta.title.trim() || meta.label.trim() || meta.lastAssistant);
}

/**
 * Returns `onEdit(nextDraft)`; call it from real user edits only. Starts at most
 * one process per stopped session; a failure (SESSION_HELD, CWD_MISSING, spawn
 * error) is swallowed and not retried until the session is reopened or `alive`
 * changes, so keystrokes never retry-spam.
 */
export function useStartOnType(
	sessionId: string,
	alive: boolean,
	eligible: boolean,
): (nextDraft: string) => void {
	const failed = useRef(false);
	useEffect(() => {
		failed.current = false;
	}, [sessionId, alive]);
	const latest = useRef({ sessionId, alive, eligible });
	latest.current = { sessionId, alive, eligible };

	return useCallback((nextDraft: string) => {
		const { sessionId: id, alive: isAlive, eligible: ok } = latest.current;
		if (!nextDraft || isAlive || !ok || failed.current || inFlight.has(id)) return;
		inFlight.add(id);
		rpcEnsureLive(id)
			.catch((err) => {
				failed.current = true;
				console.warn("[composer] silent start failed", id, err);
			})
			.finally(() => inFlight.delete(id));
	}, []);
}
