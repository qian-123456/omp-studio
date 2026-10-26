/**
 * Manual context compaction state machine, shared by `/compact` and the
 * context-ring button. Tracks one in-flight compaction per session, emits a
 * single coherent status flow, and refreshes `get_state` afterwards so the
 * context ring shows the post-compaction size.
 */
import { create } from "zustand";
import { useLive } from "../../../stores/live";
import { tNow } from "../../../stores/language";
import { rpcSend as defaultRpcSend } from "../../../lib/ipc";
import { toast } from "../../../lib/toast";


/** Promise plus its settlers (lib target predates Promise.withResolvers). */
export function deferred<T>(): {
	promise: Promise<T>;
	resolve: (v: T | PromiseLike<T>) => void;
	reject: (e: unknown) => void;
} {
	let resolve!: (v: T | PromiseLike<T>) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}
const compactionControllers = new Map<string, AbortController>();
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

/** Cancels an in-flight compaction (manual or auto) and resets the session state. */
export async function cancelCompaction(
	sessionId: string,
	deps?: { rpcSend?: (cmd: Record<string, unknown>) => Promise<unknown> },
): Promise<void> {
	const ctl = compactionControllers.get(sessionId);
	if (ctl) {
		ctl.abort();
		compactionControllers.delete(sessionId);
	}
	setActive(sessionId, false);
	try {
		const send = deps?.rpcSend ?? ((cmd) => defaultRpcSend(sessionId, cmd));
		await send({ type: "abort" });
	} catch {
		// Ignore abort failure (e.g. process not running)
	}
	const live = useLive.getState();
	const running = live.sessions[sessionId]?.flowNotices.find(
		(n) => n.kind === "compaction" && n.status === "running",
	);
	if (running) {
		live.finishFlowNotice(sessionId, running.id, {
			status: "error",
			detail: tNow("chat.context.compactionCancelled"),
		});
	}
}

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
	/** Max wait time before timing out (ms); default 120_000 (2 minutes). */
	timeoutMs?: number;
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
	const controller = new AbortController();
	compactionControllers.set(sessionId, controller);
	const live = useLive.getState();
	const noticeId = live.beginFlowNotice(sessionId, "compaction");
	const readTokens = deps.tokens ?? (() => liveTokens(sessionId));
	const finish = (patch: Parameters<typeof live.finishFlowNotice>[2]) =>
		useLive.getState().finishFlowNotice(sessionId, noticeId, patch);

	const timeoutMs = deps.timeoutMs ?? 120_000;
	const timeoutGate = deferred<never>();
	const timer = setTimeout(() => {
		timeoutGate.reject(new Error(tNow("chat.context.compactionTimeout")));
	}, timeoutMs);
	const abortGate = deferred<never>();
	if (controller.signal.aborted) {
		abortGate.reject(new Error(tNow("chat.context.compactionCancelled")));
	} else {
		controller.signal.addEventListener(
			"abort",
			() => abortGate.reject(new Error(tNow("chat.context.compactionCancelled"))),
			{ once: true },
		);
	}

	try {
		await deps.ensureAlive?.();
		const before = readTokens();
		const command: Record<string, unknown> = { type: "compact" };
		const extra = deps.instructions?.trim();
		if (extra) command.customInstructions = extra;
		await Promise.race([deps.rpcSend(command), timeoutGate.promise, abortGate.promise]);
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
		const isCancel =
			controller.signal.aborted ||
			(err instanceof Error && err.message === tNow("chat.context.compactionCancelled"));
		const isTimeout =
			err instanceof Error && err.message === tNow("chat.context.compactionTimeout");
		const text = isCancel
			? tNow("chat.context.compactionCancelled")
			: isTimeout
				? tNow("chat.context.compactionTimeout")
				: deps.errorText(err);
		if (text === null) {
			useLive.getState().dismissFlowNotice(sessionId, noticeId);
			return "failed";
		}
		if (isNothingToCompact(text)) {
			finish({ status: "done", detail: tNow("slash.nothingToCompact") });
			return "nothing";
		}
		finish({ status: "error", detail: text });
		if (!isCancel) {
			toast.error(tNow("chat.context.compactionFailed", { error: text }));
		}
		return "failed";
	} finally {
		clearTimeout(timer);
		compactionControllers.delete(sessionId);
		setActive(sessionId, false);
	}
}
