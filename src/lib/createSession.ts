/** Shared session creation: start an omp RPC session, seed + select it. */

import type { SessionMeta, Workspace } from "./contracts";
import { gitBadge, gitRepoRoot, rpcSend, rpcStart } from "./ipc";
import { useLive } from "../stores/live";
import { useSessions } from "../stores/sessions";

function pathWithin(path: string, root: string): boolean {
	const r = root.replace(/\/+$/, "");
	return path === r || path.startsWith(`${r}/`);
}

/**
 * Mirror of the backend's `catalog::scan::resolve_workspace` fallback: the
 * project workspace containing `repoRoot ?? cwd` (longest path wins), else
 * Global when `cwd` is under its dir. Keeps a stub started in a worktree dir
 * (`<repo>/.worktrees/x`) or a custom path in its group instead of the
 * collapsed unassigned bucket until the catalog resolves it.
 */
export function resolveWorkspaceId(
	workspaces: Workspace[],
	repoRoot: string | null,
	cwd: string,
): string | null {
	for (const target of [repoRoot, cwd]) {
		if (!target) continue;
		const best = workspaces
			.filter((w) => w.kind === "project" && pathWithin(target, w.path))
			.sort((a, b) => b.path.length - a.path.length)[0];
		if (best) return best.id;
	}
	const global = workspaces.find((w) => w.kind === "global");
	return global && pathWithin(cwd, global.path) ? global.id : null;
}

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
		workspaceId:
			opts.workspaceId ??
			resolveWorkspaceId(useSessions.getState().workspaces, repoRoot, live.cwd),
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
