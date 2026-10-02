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
	/** Optional first prompt. `createSession` only reads it to mark the stub
	 * `working` (vs `idle`); callers still send it via `sendFirstPrompt`. */
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
		// Prompted sessions start a turn immediately; a bare stub stays idle so
		// it doesn't spin "运行中" forever while the lazy transcript is absent.
		status: opts.prompt?.trim() ? "working" : "idle",
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
		attention: opts.prompt?.trim() ? "running" : null,
	};
	return { sessionId: live.sessionId, stub };
}

/** A session counts as "busy" — untouchable by delete — only while a turn or
 * an interactive dialog is in flight. `live` alone (an idle RPC process or a
 * fresh stub whose transcript was never written) must not block it. */
export function isSessionBusy(s: Pick<SessionMeta, "status">): boolean {
	return (
		s.status === "working" ||
		s.status === "awaiting_approval" ||
		s.status === "awaiting_answer"
	);
}

/**
 * Find a reusable "empty draft" session already running in `cwd`: live,
 * unarchived, idle, unnamed, and with no user/assistant activity seen by the
 * live store. Lets "new session" select the existing draft instead of
 * stacking another empty 未命名会话 on the same directory.
 */
export function findEmptyDraft(cwd: string): SessionMeta | null {
	const sessions = useSessions.getState().sessions;
	const lives = useLive.getState().sessions;
	for (const s of Object.values(sessions)) {
		if (s.cwd !== cwd) continue;
		if (!s.live || s.archived || s.status !== "idle") continue;
		if (s.title.trim() || s.label.trim() || s.lastAssistant) continue;
		const live = lives[s.id];
		if (
			live &&
			(live.items.length > 0 ||
				live.pendingUserEchoes.length > 0 ||
				live.streaming ||
				live.streamingMessage !== null)
		) {
			continue;
		}
		return s;
	}
	return null;
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
