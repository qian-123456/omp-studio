/** Resume the original session, asking for an explicit location/model only when needed. */
import type { LiveSessionInfo, SessionMeta } from "./contracts";
import { errMsg } from "./dialogs";
import { rpcEnsureLive } from "./ipc";
import { basename, isInside } from "./paths";
import { repoRootFromWorktree } from "../features/git/helpers";
import { useSessions } from "../stores/sessions";
import { useUi } from "../stores/ui";

/** Mirrors the backend resume sentinels. */
export const CWD_MISSING_PREFIX = "CWD_MISSING:";
export const SESSION_MODEL_UNAVAILABLE_PREFIX = "SESSION_MODEL_UNAVAILABLE:";
export const RESUME_MISSING_CWD_MODAL = "resume-missing-cwd";
export const RESUME_MISSING_MODEL_MODAL = "resume-missing-model";

/** The user dismissed recovery without choosing. */
export class ResumeCancelledError extends Error {
	constructor() {
		super("resume cancelled");
		this.name = "ResumeCancelledError";
	}
}

/** Silent cancellation — never toast it. */
export function isResumeCancelled(err: unknown): boolean {
	return err instanceof ResumeCancelledError;
}

export function cwdMissingPath(err: unknown): string | null {
	const msg = errMsg(err);
	return msg.startsWith(CWD_MISSING_PREFIX) ? msg.slice(CWD_MISSING_PREFIX.length) : null;
}

export function unavailableModelDiagnostic(err: unknown): string | null {
	const msg = errMsg(err);
	return msg.startsWith(SESSION_MODEL_UNAVAILABLE_PREFIX)
		? msg.slice(SESSION_MODEL_UNAVAILABLE_PREFIX.length).trim()
		: null;
}

interface PendingResume {
	sessionId: string;
	promise: Promise<LiveSessionInfo>;
	resolve: (info: LiveSessionInfo) => void;
	reject: (err: unknown) => void;
	cwd?: string;
	model?: string;
	modal?: { name: string; props: Record<string, unknown> };
	attempt?: Promise<void>;
}

// Same-session callers share both the RPC and the user's recovery decision.
// Other sessions queue their prompts instead of cancelling the active caller.
const pendingResumes = new Map<string, PendingResume>();
let activeResume: PendingResume | null = null;

function showNextResume(): void {
	if (activeResume || useUi.getState().modal) return;
	for (const pending of pendingResumes.values()) {
		if (!pending.modal) continue;
		activeResume = pending;
		useUi.getState().openModal(pending.modal.name, pending.modal.props);
		return;
	}
}

useUi.subscribe((state, previous) => {
	if (previous.modal && !state.modal) queueMicrotask(showNextResume);
});

function finishResume(pending: PendingResume): void {
	pendingResumes.delete(pending.sessionId);
	if (activeResume === pending) {
		activeResume = null;
		const ui = useUi.getState();
		if (ui.modal?.props.sessionId === pending.sessionId && ui.modal.name === pending.modal?.name) {
			ui.closeModal();
		}
	}
	queueMicrotask(showNextResume);
}

/** Dialog reports success; stale results cannot settle another session's recovery. */
export function resolveResume(sessionId: string, info: LiveSessionInfo): void {
	const pending = pendingResumes.get(sessionId);
	if (!pending) return;
	finishResume(pending);
	pending.resolve(info);
}

/** The modal name guards an old dialog's cleanup during a location/model transition. */
export function rejectResume(sessionId: string, err?: unknown, modalName?: string): void {
	const pending = pendingResumes.get(sessionId);
	if (!pending || (modalName && pending.modal?.name !== modalName)) return;
	finishResume(pending);
	pending.reject(err ?? new ResumeCancelledError());
}

/** Worktree layout `<repo>/.worktrees/<name>` exactly (not a deeper subdir). */
function worktreeLayout(cwd: string): { repoRoot: string; name: string } | null {
	const m = cwd.match(/^(.+)[/\\]\.worktrees[/\\]([^/\\]+)\/?$/);
	if (!m) return null;
	return { repoRoot: repoRootFromWorktree(cwd), name: m[2] };
}

/** Prefer the worktree parent, then stored root, then the containing workspace. */
function resumeRepoRoot(session: SessionMeta | undefined, cwd: string): string | null {
	if (worktreeLayout(cwd)) return repoRootFromWorktree(cwd);
	if (session?.repoRoot) return session.repoRoot;
	let best: string | null = null;
	for (const w of useSessions.getState().workspaces) {
		if (w.kind === "project" && isInside(cwd, w.path) && (best === null || w.path.length > best.length)) {
			best = w.path;
		}
	}
	return best;
}

function offerRecovery(pending: PendingResume, err: unknown): boolean {
	const cwd = cwdMissingPath(err);
	const diagnostic = unavailableModelDiagnostic(err);
	let modal: PendingResume["modal"];
	if (cwd !== null) {
		const session = useSessions.getState().sessions[pending.sessionId];
		const worktree = worktreeLayout(cwd);
		modal = {
			name: RESUME_MISSING_CWD_MODAL,
			props: {
				sessionId: pending.sessionId,
				cwd,
				repoRoot: resumeRepoRoot(session, cwd),
				...(worktree ? { worktreeName: worktree.name ?? basename(cwd) } : {}),
			},
		};
	} else if (diagnostic !== null) {
		modal = { name: RESUME_MISSING_MODEL_MODAL, props: { sessionId: pending.sessionId, diagnostic } };
	} else {
		return false;
	}
	// A failed retry of the same choice stays in its dialog with an inline error.
	if (pending.modal?.name === modal.name) return false;
	pending.modal = modal;
	if (activeResume === pending) useUi.getState().openModal(modal.name, modal.props);
	else showNextResume();
	return true;
}

/** Dialog retry: keep user choices across model/location recovery, with inline errors. */
export async function resumeSession(sessionId: string, cwd?: string, model?: string): Promise<void> {
	const pending = pendingResumes.get(sessionId);
	if (!pending) throw new ResumeCancelledError();
	if (cwd !== undefined) pending.cwd = cwd;
	if (model !== undefined) pending.model = model;
	if (pending.attempt) return pending.attempt;
	pending.attempt = (async () => {
		while (pendingResumes.get(sessionId) === pending) {
			const attemptedModel = pending.model;
			try {
				const info = attemptedModel !== undefined
					? await rpcEnsureLive(sessionId, pending.cwd, attemptedModel)
					: pending.cwd !== undefined
						? await rpcEnsureLive(sessionId, pending.cwd)
						: await rpcEnsureLive(sessionId);
				if (pendingResumes.get(sessionId) === pending) resolveResume(sessionId, info);
				return;
			} catch (err) {
				if (pendingResumes.get(sessionId) !== pending) return;
				// An explicit picker choice made while the first RPC was starting wins.
				if (pending.model !== attemptedModel) continue;
				if (!offerRecovery(pending, err)) throw err;
				return;
			}
		}
	})();
	try {
		await pending.attempt;
	} finally {
		pending.attempt = undefined;
	}
}

/** Only a user-selected model may override the model recorded in the transcript. */
export function ensureLive(sessionId: string, selectedModel?: string): Promise<LiveSessionInfo> {
	const existing = pendingResumes.get(sessionId);
	if (existing) {
		if (selectedModel !== undefined) {
			existing.model = selectedModel;
			if (!existing.attempt) void resumeSession(sessionId).catch((err) => rejectResume(sessionId, err));
		}
		return existing.promise;
	}
	// The supported webview/TS target predates Promise.withResolvers.
	let resolve!: PendingResume["resolve"];
	let reject!: PendingResume["reject"];
	const promise = new Promise<LiveSessionInfo>((res, rej) => { resolve = res; reject = rej; });
	const pending: PendingResume = { sessionId, promise, resolve, reject, model: selectedModel };
	pendingResumes.set(sessionId, pending);
	void resumeSession(sessionId).catch((err) => rejectResume(sessionId, err));
	return promise;
}
