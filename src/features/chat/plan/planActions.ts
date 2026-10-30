/** [B] Plan review actions: drive the plan extension's `/plan-action`
 * command and, for "fresh context" execution, start the session that runs
 * the approved plan. */

import { createSession, type CreateSessionResult } from "../../../lib/createSession";
import { ensureLive } from "../../../lib/ensureLive";
import { rpcSend } from "../../../lib/ipc";
import { useLive } from "../../../stores/live";
import { useSessions } from "../../../stores/sessions";
import { useUi } from "../../../stores/ui";
import type { PlanExecMode, PlanStatus } from "./planStatus";

interface ExecutionAttempt {
	destination?: CreateSessionResult;
	sent: boolean;
	inFlight?: Promise<string>;
}

// Keep the destination across a failed handoff, including a failed source exit:
// once run was accepted, retry must only finish approval, never execute twice.
const executions = new Map<string, ExecutionAttempt>();

const sendPlanAction = (sessionId: string, args: string) =>
	rpcSend(sessionId, { type: "prompt", message: `/plan-action ${args}` });

/** Run `/plan-action <args>` in the session without a user echo: it is a host
 * control command, not something the user typed. An idle-suspended session is
 * resumed first; a failed resume rejects and nothing is sent. */
export async function runPlanAction(sessionId: string, args: string): Promise<void> {
	if (!useLive.getState().sessions[sessionId]?.alive) await ensureLive(sessionId);
	await sendPlanAction(sessionId, args);
}

/**
 * Approve the reviewed plan. "compact"/"keep" continue in this session (the
 * extension leaves plan mode, switches to `role`'s model and sends the
 * approved-plan prompt). "execute" starts the new session and sends its run
 * command before leaving plan mode here or navigating away from the review.
 * Failed handoffs reuse their destination; accepted runs are never resent.
 * Resolves with the session that executes the plan.
 */
export async function approvePlan(
	sessionId: string,
	plan: Pick<PlanStatus, "planFile">,
	mode: PlanExecMode,
	role: string | null,
): Promise<string> {
	const pending = executions.get(sessionId);
	if (pending?.inFlight) return pending.inFlight;
	const roleArg = role ? ` ${role}` : "";
	if (mode !== "execute" && !pending?.sent) {
		await runPlanAction(sessionId, `approve ${mode}${roleArg}`);
		executions.delete(sessionId);
		return sessionId;
	}
	const attempt: ExecutionAttempt = pending ?? { sent: false };
	executions.set(sessionId, attempt);
	const handoff = async () => {
		if (!attempt.sent) {
			const file = plan.planFile;
			const meta = useSessions.getState().sessions[sessionId];
			if (!file || !meta?.cwd) throw new Error("plan file or session directory unknown");
			const runArgs = `run ${role ? `@${role} ` : ""}${file}`;
			attempt.destination ??= await createSession({
				cwd: meta.cwd,
				workspaceId: meta.workspaceId,
				mode: meta.mode,
				groupId: meta.groupId,
				// Publish the working stub only after the first prompt is accepted.
				prompt: `/plan-action ${runArgs}`,
			});
			// The destination was just started by createSession; no resume needed.
			await sendPlanAction(attempt.destination.sessionId, runArgs);
			attempt.sent = true;
			useSessions.getState().upsert([attempt.destination.stub]);
		}
		const next = attempt.destination!.sessionId;
		await runPlanAction(sessionId, "approve execute");
		useUi.getState().selectSession(next);
		// The new session publishes the approved plan (status "executing"); keep it visible.
		useUi.getState().setRightTab("plan");
		executions.delete(sessionId);
		return next;
	};
	attempt.inFlight = handoff();
	try {
		return await attempt.inFlight;
	} finally {
		attempt.inFlight = undefined;
		if (!attempt.destination) executions.delete(sessionId);
	}
}
