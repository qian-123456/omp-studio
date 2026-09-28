/** Shared session creation: start an omp RPC session, seed + select it. */

import type { SessionMeta } from "./contracts";
import { gitBadge, gitRepoRoot, rpcSend, rpcStart } from "./ipc";
import { useLive } from "../stores/live";

export interface CreateSessionOpts {
	cwd: string;
	model?: string | null;
	approvalMode?: string | null;
	workspaceId?: string | null;
	/** Optional first prompt, sent right after start. */
	prompt?: string;
	planYolo?: boolean | null;
}

export interface CreateSessionResult {
	sessionId: string;
	stub: SessionMeta;
}

/**
 * Start a session in `cwd` and build the stub SessionMeta for the store.
 * The caller upserts the stub, selects the session, and sends `prompt`.
 */
export async function createSession(
	opts: CreateSessionOpts,
): Promise<CreateSessionResult> {
	const live = await rpcStart({
		cwd: opts.cwd,
		model: opts.model?.trim() || null,
		approvalMode: opts.approvalMode || null,
		planYolo: opts.planYolo ?? null,
	});
	// Probe git in parallel with nothing else to wait on — cached backend-side,
	// so cheap — and fill the stub before the caller upserts it, so the row
	// lands in the right subgroup instead of "其他".
	const [git, repoRoot] = await Promise.all([
		gitBadge(live.cwd).catch(() => null),
		gitRepoRoot(live.cwd).catch(() => null),
	]);
	const now = new Date().toISOString();
	// Seed the store so the session is selectable before the catalog's own
	// sessions:updated event overwrites this stub.
	const stub: SessionMeta = {
		id: live.sessionId,
		tool: "omp",
		file: live.sessionFile,
		cwd: live.cwd,
		title: "",
		label: "",
		createdAt: now,
		updatedAt: now,
		parentId: null,
		forkDepth: 0,
		status: "working",
		unread: false,
		pending: null,
		live: true,
		externalPid: null,
		pinned: false,
		archived: false,
		workspaceId: opts.workspaceId ?? null,
		repoRoot,
		git,
		result: null,
		lastAssistant: null,
		model: opts.model?.trim() || null,
	};
	return { sessionId: live.sessionId, stub };
}

/** Send the first prompt to a freshly started session, if provided. */
export async function sendFirstPrompt(
	sessionId: string,
	prompt?: string,
): Promise<void> {
	const first = prompt?.trim();
	if (first) {
		await rpcSend(sessionId, { type: "prompt", message: first });
		useLive.getState().addUserEcho(sessionId, first);
	}
}
