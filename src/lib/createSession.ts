/** Shared session creation: start an omp RPC session, seed + select it. */

import type { SessionMeta } from "./contracts";
import { rpcSend, rpcStart } from "./ipc";
import { useLive } from "../stores/live";

export interface CreateSessionOpts {
	cwd: string;
	model?: string | null;
	approvalMode?: string | null;
	workspaceId?: string | null;
	/** Optional first prompt, sent right after start. */
	prompt?: string;
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
	});
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
		repoRoot: null,
		git: null,
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
