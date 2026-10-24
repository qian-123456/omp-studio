/**
 * Uniform lifecycle for async local slash commands: one transcript status
 * row that goes running → result (or error text) in place. The caller returns
 * right away so the composer clears on Enter; the work runs in the background.
 */
import { errMsg } from "../../../lib/dialogs";
import { isResumeCancelled } from "../../../lib/ensureLive";
import { tNow } from "../../../stores/language";
import { useLive } from "../../../stores/live";

const inflight = new Set<string>();

export const isCommandRunning = (sessionId: string, command: string): boolean =>
	inflight.has(`${sessionId}:${command}`);

/**
 * Start `work` for `/command` in `sessionId`. `work` resolves to the result
 * text shown in place of the running row. A repeat call while the same command
 * is running adds nothing (the running row is already visible).
 */
export function trackCommand(
	sessionId: string,
	command: string,
	runningText: string,
	work: () => Promise<string>,
): Promise<void> {
	const key = `${sessionId}:${command}`;
	if (inflight.has(key)) return Promise.resolve();
	inflight.add(key);
	const live = useLive.getState();
	const id = live.beginCommandRun(sessionId, command, runningText);
	return work().then(
		(text) => {
			inflight.delete(key);
			useLive.getState().finishCommandRun(sessionId, id, "done", text);
		},
		(err) => {
			inflight.delete(key);
			if (isResumeCancelled(err)) {
				useLive.getState().dismissCommandOutput(sessionId, id);
				return;
			}
			useLive.getState().finishCommandRun(sessionId, id, "error", tNow("slash.trackFailed", { command, error: errMsg(err) }));
		},
	);
}
