/** Shared session creation: start an omp RPC session, seed + select it. */

import type { SessionMeta, SpaceMode } from "./contracts";
import { gitBadge, gitRepoRoot, rpcSend, rpcStart } from "./ipc";
import { hasLiveUserActivity, useLive } from "../stores/live";
import { useSessions } from "../stores/sessions";
import { resolveWorkspaceIdForMode } from "../features/sessions/modes";
export interface CreateSessionOpts {
	cwd: string;
	model?: string | null;
	approvalMode?: string | null;
	workspaceId?: string | null;
	/**
	 * Space mode the session belongs to (default "code"). When omitted the
	 * explicit `workspaceId`'s own mode wins, so callers only pass a
	 * workspace id never land in the wrong space.
	 */
	mode?: SpaceMode;
	/** SessionGroup to file the new session under (mode's 无项目 area only). */
	groupId?: string | null;
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
	const workspaces = useSessions.getState().workspaces;
	const explicitWs = opts.workspaceId
		? workspaces.find((w) => w.id === opts.workspaceId)
		: undefined;
	const mode = opts.mode ?? explicitWs?.mode ?? "code";
	const groupId = opts.groupId ?? null;

	const live = await rpcStart({
		cwd: opts.cwd,
		model: opts.model?.trim() || null,
		approvalMode: opts.approvalMode || null,
		planYolo: opts.planYolo ?? null,
		mode,
		groupId,
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
			resolveWorkspaceIdForMode(workspaces, repoRoot, live.cwd, mode),
		repoRoot,
		git,
		result: null,
		lastAssistant: null,
		model: opts.model?.trim() || null,
		attention: opts.prompt?.trim() ? "running" : null,
		mode,
		groupId,
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

/** Unnamed, idle session with no transcript activity (composer text not considered). */
export function isBlankDraft(
	s: SessionMeta,
	live: Parameters<typeof hasLiveUserActivity>[0],
): boolean {
	return (
		s.status === "idle" &&
		!s.title.trim() &&
		!s.label.trim() &&
		!s.lastAssistant &&
		!hasLiveUserActivity(live)
	);
}

/**
 * Find a reusable "empty draft" session already running in `cwd`: live,
 * unarchived, idle, unnamed, same space mode, and with no user/assistant
 * activity seen by the live store. Lets "new session" select the existing
 * draft instead of stacking another empty 未命名会话 on the same directory.
 */
export function findEmptyDraft(
	cwd: string,
	mode?: SpaceMode,
): SessionMeta | null {
	const sessions = useSessions.getState().sessions;
	const lives = useLive.getState().sessions;
	for (const s of Object.values(sessions)) {
		if (s.cwd !== cwd) continue;
		if (mode !== undefined && s.mode !== mode) continue;
		if (!s.live || s.archived) continue;
		if (!isBlankDraft(s, lives[s.id])) continue;
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
