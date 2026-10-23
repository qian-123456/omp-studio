/**
 * Manual context compaction state machine, shared by `/compact` and the
 * context-ring button. Tracks one in-flight compaction per session, emits a
 * single coherent status flow, and refreshes `get_state` afterwards so the
 * context ring shows the post-compaction size.
 */
import { create } from "zustand";
import { useLive } from "../../../stores/live";

/** Sessions with a compaction currently running. */
export const useCompaction = create<{ active: Record<string, true> }>(() => ({ active: {} }));

export const isCompacting = (sessionId: string): boolean =>
	useCompaction.getState().active[sessionId] === true;

const setActive = (sessionId: string, on: boolean) =>
	useCompaction.setState((s) => {
		const next = { ...s.active };
		if (on) next[sessionId] = true;
		else delete next[sessionId];
		return { active: next };
	});

/** omp refuses to compact when there is nothing (left) to summarise. */
export function isNothingToCompact(message: string): boolean {
	return /already compacted|nothing to compact|no (messages|content) to compact|too few messages/i.test(
		message,
	);
}

export type CompactOutcome = "done" | "busy" | "nothing" | "failed";

export interface CompactDeps {
	sessionId: string;
	/** Optional custom compaction instructions. */
	instructions?: string;
	rpcSend(command: Record<string, unknown>): Promise<unknown>;
	/** Bring the session process up if it is not alive yet. */
	ensureAlive?(): Promise<void>;
	/** Resolve an error to display text; cancelled resumes return null (silent). */
	errorText(err: unknown): string | null;
	/** Context tokens currently in use (default: live `contextUsage.tokens`). */
	tokens?(): number | null;
}

const liveTokens = (sessionId: string): number | null => {
	const u = useLive.getState().sessions[sessionId]?.state?.contextUsage;
	const t = u && typeof u === "object" ? (u as Record<string, unknown>).tokens : null;
	return typeof t === "number" ? t : null;
};

/**
 * Runs a compaction and reports it as ONE divider in the message flow that
 * goes running → done/error in place. A second call while one runs shows
 * nothing new (the running divider is already in the transcript).
 */
export async function runCompaction(deps: CompactDeps): Promise<CompactOutcome> {
	const { sessionId } = deps;
	if (isCompacting(sessionId)) return "busy";
	setActive(sessionId, true);
	const live = useLive.getState();
	const noticeId = live.beginFlowNotice(sessionId, "compaction");
	const readTokens = deps.tokens ?? (() => liveTokens(sessionId));
	const finish = (patch: Parameters<typeof live.finishFlowNotice>[2]) =>
		useLive.getState().finishFlowNotice(sessionId, noticeId, patch);
	try {
		await deps.ensureAlive?.();
		const before = readTokens();
		const command: Record<string, unknown> = { type: "compact" };
		const extra = deps.instructions?.trim();
		if (extra) command.customInstructions = extra;
		await deps.rpcSend(command);
		await deps.rpcSend({ type: "get_state" }).catch(() => {});
		const after = readTokens();
		finish({
			status: "done",
			...(before !== null && after !== null && before !== after
				? { tokensBefore: before, tokensAfter: after }
				: {}),
		});
		return "done";
	} catch (err) {
		// The process may have finished compacting despite the error; resync so
		// the ring never keeps showing the pre-compaction size.
		await deps.rpcSend({ type: "get_state" }).catch(() => {});
		const text = deps.errorText(err);
		if (text === null) {
			useLive.getState().dismissFlowNotice(sessionId, noticeId);
			return "failed";
		}
		if (isNothingToCompact(text)) {
			finish({ status: "done", detail: "当前上下文无需再压缩" });
			return "nothing";
		}
		finish({ status: "error", detail: text });
		return "failed";
	} finally {
		setActive(sessionId, false);
	}
}
