/**
 * Live `omp --mode rpc` processes build their ModelRegistry from models.yml once at start.
 * Upstream OMP's RPC surface cannot re-read it: `set_model` (`findRpcModel`) only searches the
 * in-memory registry and awaits the startup discovery; `ModelRegistry.refresh()` /
 * `refreshIfStale()` are not reachable over RPC. So a session that was already running when a
 * provider was saved can select the new model only after its process is restarted.
 *
 * Saving a provider therefore only *marks* the currently live, app-owned sessions as stale
 * (no process is touched). The restart happens lazily, for one session, when the user actually
 * picks a model for it (`prepareSessionForModelSelection`), and only if that session is idle:
 * `rpcRestart` = stop + `--resume <file>`, transcript preserved. Busy sessions (streaming or
 * waiting on a dialog) are never interrupted; the pick then proceeds against the old registry
 * and fails visibly if the model is unknown (no silent fallback to another model).
 */

import { errMsg } from "../../lib/dialogs";
import { rpcListLive, rpcRestart, rpcSend } from "../../lib/ipc";
import { classifyLive } from "../../stores/ompUpdateSessions";
import { useLive } from "../../stores/live";

/** Live sessions whose registry predates the latest models.yml save. */
const stale = new Set<string>();
const restarting = new Map<string, Promise<PrepareResult>>();

export type PrepareResult =
	| { status: "fresh" }
	| { status: "restarted" }
	/** Stale but streaming / awaiting input: left untouched. */
	| { status: "busy" }
	| { status: "failed"; error: string };

/** Record which live app-owned sessions loaded an outdated registry. Never restarts anything. */
export async function markLiveSessionsStale(): Promise<void> {
	const live = await rpcListLive();
	for (const { sessionId } of live) stale.add(sessionId);
}

export function isSessionRegistryStale(sessionId: string): boolean {
	return stale.has(sessionId);
}

/**
 * Call right before sending `set_model` for `sessionId`. A stale idle session is restarted so the
 * registry includes the saved provider; everything else is a no-op. The caller then sends
 * `set_model` as usual and must surface its error (no fallback model).
 */
export function prepareSessionForModelSelection(sessionId: string): Promise<PrepareResult> {
	if (!stale.has(sessionId)) return Promise.resolve({ status: "fresh" });
	const inflight = restarting.get(sessionId);
	if (inflight) return inflight;
	const cls = classifyLive(useLive.getState().sessions[sessionId]);
	if (cls === "dead") {
		// Process gone: the next ensureLive resumes it against the fresh models.yml.
		stale.delete(sessionId);
		return Promise.resolve({ status: "fresh" });
	}
	if (cls === "busy") return Promise.resolve({ status: "busy" });
	const run = (async (): Promise<PrepareResult> => {
		// The restart resumes from the session file; re-apply the thinking level the user had so it is held.
		const thinking = useLive.getState().sessions[sessionId]?.state?.thinkingLevel;
		try {
			await rpcRestart(sessionId);
			stale.delete(sessionId);
			if (typeof thinking === "string" && thinking) {
				await rpcSend(sessionId, { type: "set_thinking_level", level: thinking });
			}
			return { status: "restarted" };
		} catch (e) {
			return { status: "failed", error: errMsg(e) };
		} finally {
			restarting.delete(sessionId);
		}
	})();
	restarting.set(sessionId, run);
	return run;
}

/** Test-only reset of module state. */
export function __resetModelRegistrySyncForTests(): void {
	stale.clear();
	restarting.clear();
}
