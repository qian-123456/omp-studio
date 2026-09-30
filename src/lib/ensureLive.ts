/**
 * ensureLive wraps rpcEnsureLive with the "worktree was deleted" flow: when
 * the backend reports `CWD_MISSING:<dir>` the session's recorded cwd no longer
 * exists, so we open the `resume-missing-cwd` modal and wait for the user to
 * pick a resume directory (main checkout or recreated worktree). The dialog
 * performs the follow-up `rpc_ensure_live` call itself (it owns the busy state
 * and inline errors) and resolves/rejects the pending promise handed out here.
 */

import type { LiveSessionInfo, SessionMeta } from "./contracts";
import { errMsg } from "./dialogs";
import { rpcEnsureLive } from "./ipc";
import { basename, isInside } from "./paths";
import { repoRootFromWorktree } from "../features/git/helpers";
import { useSessions } from "../stores/sessions";
import { useUi } from "../stores/ui";

/** Mirrors `rpc::CWD_MISSING_PREFIX` (src-tauri/src/rpc/mod.rs). */
export const CWD_MISSING_PREFIX = "CWD_MISSING:";

export const RESUME_MISSING_CWD_MODAL = "resume-missing-cwd";

/** The user dismissed the resume-location dialog without choosing. */
export class ResumeCancelledError extends Error {
	constructor() {
		super("resume cancelled");
		this.name = "ResumeCancelledError";
	}
}

/** True for the silent "user cancelled the dialog" rejection — never toast it. */
export function isResumeCancelled(err: unknown): boolean {
	return err instanceof ResumeCancelledError;
}

/** `CWD_MISSING:<dir>` sentinel → the missing directory, else null. */
export function cwdMissingPath(err: unknown): string | null {
	const msg = errMsg(err);
	return msg.startsWith(CWD_MISSING_PREFIX)
		? msg.slice(CWD_MISSING_PREFIX.length)
		: null;
}

interface PendingResume {
	sessionId: string;
	resolve: (info: LiveSessionInfo) => void;
	reject: (err: unknown) => void;
}

let pendingResume: PendingResume | null = null;

/** Dialog reports success: resolves the `ensureLive` caller and closes. */
export function resolveResume(sessionId: string, info: LiveSessionInfo): void {
	if (pendingResume?.sessionId !== sessionId) return;
	const pending = pendingResume;
	pendingResume = null;
	pending.resolve(info);
	const ui = useUi.getState();
	if (ui.modal?.name === RESUME_MISSING_CWD_MODAL) ui.closeModal();
}

/**
 * Dialog reports dismissal (Esc / 取消 / unmount): rejects the pending caller.
 * `err` defaults to ResumeCancelledError; the modal is left alone (the caller
 * decides whether it is already closed).
 */
export function rejectResume(sessionId: string, err?: unknown): void {
	if (pendingResume?.sessionId !== sessionId) return;
	const pending = pendingResume;
	pendingResume = null;
	pending.reject(err ?? new ResumeCancelledError());
}

/** Worktree layout `<repo>/.worktrees/<name>` exactly (not a deeper subdir). */
function worktreeLayout(
	cwd: string,
): { repoRoot: string; name: string } | null {
	const m = cwd.match(/^(.+)[/\\]\.worktrees[/\\]([^/\\]+)\/?$/);
	if (!m) return null;
	return { repoRoot: repoRootFromWorktree(cwd), name: m[2] };
}

/**
 * Repo root for the "continue in main dir" choice: the `.worktrees/` parent
 * when the layout matches, else the session's stored repo root, else the
 * (longest) project workspace containing the missing cwd. Null when unknown.
 */
function resumeRepoRoot(
	session: SessionMeta | undefined,
	cwd: string,
): string | null {
	if (worktreeLayout(cwd)) return repoRootFromWorktree(cwd);
	if (session?.repoRoot) return session.repoRoot;
	const workspaces = useSessions.getState().workspaces;
	let best: string | null = null;
	for (const w of workspaces) {
		if (w.kind !== "project") continue;
		if (isInside(cwd, w.path) && (best === null || w.path.length > best.length)) {
			best = w.path;
		}
	}
	return best;
}

/**
 * Ensure the session's omp process is running. On `CWD_MISSING` this opens the
 * resume-location dialog and resolves with the eventual `LiveSessionInfo`;
 * dismissing the dialog rejects with `ResumeCancelledError`.
 */
export async function ensureLive(sessionId: string): Promise<LiveSessionInfo> {
	try {
		return await rpcEnsureLive(sessionId);
	} catch (err) {
		const cwd = cwdMissingPath(err);
		if (cwd === null) throw err;
		const session = useSessions.getState().sessions[sessionId];
		const worktree = worktreeLayout(cwd);
		const props: Record<string, unknown> = {
			sessionId,
			cwd,
			repoRoot: resumeRepoRoot(session, cwd),
		};
		if (worktree) {
			// The recreated path must equal the original dir, so option B is only
			// offered for the exact `<repo>/.worktrees/<name>` layout.
			props.worktreeName = worktree.name ?? basename(cwd);
		}
		return new Promise<LiveSessionInfo>((resolve, reject) => {
			// A second missing-cwd prompt supersedes a pending one.
			if (pendingResume) pendingResume.reject(new ResumeCancelledError());
			pendingResume = { sessionId, resolve, reject };
			useUi.getState().openModal(RESUME_MISSING_CWD_MODAL, props);
		});
	}
}
