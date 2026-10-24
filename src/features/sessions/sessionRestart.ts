import { isSessionBusy } from "../../lib/createSession";
import type { SessionMeta } from "../../lib/contracts";
import { tNow } from "../../stores/language";

export type RestartState =
	| { kind: "live" }
	| { kind: "wake" }
	| { kind: "disabled"; reason: string };

/**
 * 重启会话 menu state. `live`: our own RPC process runs → rpc_restart (stop +
 * `--resume`). `wake`: no process (idle-suspended / stopped) → bring it up via
 * ensureLive without sending any prompt. `disabled` carries a user-visible
 * reason. A missing working directory is not detectable from SessionMeta; it
 * surfaces through ensureLive's resume-location dialog / the backend error.
 */
export function restartState(
	s: Pick<SessionMeta, "live" | "archived" | "status" | "file">,
): RestartState {
	if (s.archived) return { kind: "disabled", reason: tNow("sessions.restartDisabledArchived") };
	if (s.status === "external") {
		return { kind: "disabled", reason: tNow("sessions.restartDisabledExternal") };
	}
	if (!s.file) return { kind: "disabled", reason: tNow("sessions.restartDisabledNoFile") };
	if (s.live && s.status !== "suspended") return { kind: "live" };
	return { kind: "wake" };
}

/** Restarting mid-turn aborts the running turn, so the user must confirm. */
export function restartNeedsConfirm(s: Pick<SessionMeta, "status">): boolean {
	return isSessionBusy(s);
}
