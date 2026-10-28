/** [B] Plan review actions: drive the plan extension's `/plan-action`
 * command and, for "fresh context" execution, start the session that runs
 * the approved plan. */

import { createSession } from "../../../lib/createSession";
import { rpcSend } from "../../../lib/ipc";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import type { PlanExecMode, PlanStatus } from "./planStatus";

/** Run `/plan-action <args>` in the session without a user echo: it is a host
 * control command, not something the user typed. */
export async function runPlanAction(sessionId: string, args: string): Promise<void> {
	await rpcSend(sessionId, { type: "prompt", message: `/plan-action ${args}` });
}

/**
 * Approve the reviewed plan. "compact"/"keep" continue in this session (the
 * extension leaves plan mode, switches to `role`'s model and sends the
 * approved-plan prompt). "execute" leaves plan mode here, then opens a new
 * session in the same place that runs the plan file with `role`'s model.
 * Resolves with the session that executes the plan.
 */
export async function approvePlan(
	sessionId: string,
	plan: Pick<PlanStatus, "planFile">,
	mode: PlanExecMode,
	role: string | null,
): Promise<string> {
	const roleArg = role ? ` ${role}` : "";
	if (mode !== "execute") {
		await runPlanAction(sessionId, `approve ${mode}${roleArg}`);
		return sessionId;
	}
	const file = plan.planFile;
	const meta = useSessions.getState().sessions[sessionId];
	if (!file || !meta?.cwd) throw new Error("plan file or session directory unknown");
	await runPlanAction(sessionId, "approve execute");
	const runArgs = `run ${role ? `@${role} ` : ""}${file}`;
	const { sessionId: next, stub } = await createSession({
		cwd: meta.cwd,
		workspaceId: meta.workspaceId,
		mode: meta.mode,
		groupId: meta.groupId,
		// Marks the stub as working: the run command starts a turn right away.
		prompt: `/plan-action ${runArgs}`,
	});
	useSessions.getState().upsert([stub]);
	useUi.getState().selectSession(next);
	await runPlanAction(next, runArgs);
	return next;
}
