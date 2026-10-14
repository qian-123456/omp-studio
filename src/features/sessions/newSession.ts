/**
 * Session creation helpers for the sidebar's per-workspace/per-worktree "+" buttons,
 * plus resolveNewSessionTargetWorkspace used by "新建会话" (Cmd+N).
 * Reads stores via getState() to remain operable when the sidebar is unmounted.
 */

import type { Workspace } from "../../lib/contracts";
import { createSession, findEmptyDraft } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import {
	deleteSession,
	gitCreateWorktree,
	gitSummary,
	setSessionGroup,
} from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { hasLiveUserActivity, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { useSidebarStore } from "./sidebarStore";
import { useSettings } from "../settings/store";
import { resolveNewSessionTargetWorkspace } from "./modes";

let creationInFlight = false;

/**
 * Creates a session under `ws`, either in its main path or in an isolated git worktree.
 * `groupId` files a 无项目 session under a SessionGroup (global workspace only).
 * S16: sets creatingKey to `${ws.id}|${ws.path}` so only the relevant spinner runs.
 * S17: rejects isolated worktrees on non-git workspaces with an informative toast.
 */
export async function startSessionInDir(
	ws: Workspace,
	isolatedWorktree: boolean,
	groupId?: string | null,
): Promise<void> {
	if (creationInFlight) return;
	creationInFlight = true;
	const store = useSidebarStore.getState();
	store.setCreatingKey(`${ws.id}|${ws.path}`);

	try {
		let cwd = ws.path;
		if (isolatedWorktree && ws.kind !== "global") {
			const summary = await gitSummary(ws.path).catch(() => null);
			if (!summary?.isRepo) {
				toast.error("该目录不是 Git 仓库，无法创建独立工作树");
				return;
			}
			const wt = await gitCreateWorktree(
				ws.path,
				`task-${Math.floor(Date.now() / 1000)}`,
			);
			cwd = wt.path;
			// Await so the sidebar groups the new session under its worktree
			// immediately instead of flashing it as orphaned / bouncing to idle.
			await useWorktrees.getState().refresh().catch(() => {});
		} else {
			const draft = findEmptyDraft(cwd, ws.mode);
			if (draft) {
				if (groupId !== undefined && draft.groupId !== groupId) {
					// Reuse the draft but file it where the user asked.
					void setSessionGroup(draft.id, groupId ?? null)
						.then(() => {
							const cur = useSessions.getState().sessions[draft.id];
							if (cur) {
								useSessions
									.getState()
									.upsert([{ ...cur, groupId: groupId ?? null }]);
							}
						})
						.catch(() => {});
				}
				useUi.getState().selectSession(draft.id);
				useComposer.getState().focusComposer(draft.id);
				return;
			}
		}

		const { sessionId, stub } = await createSession({
			cwd,
			workspaceId: ws.id,
			mode: ws.mode,
			groupId: ws.kind === "global" ? (groupId ?? null) : null,
		});
		useSessions.getState().upsert([stub]);
		useUi.getState().selectSession(sessionId);
		useComposer.getState().focusComposer(sessionId);
	} catch (err) {
		toast.error(`创建会话失败: ${errMsg(err)}`);
	} finally {
		creationInFlight = false;
		useSidebarStore.getState().setCreatingKey(null);
	}
}

/**
 * Quick-creates a session inside an existing worktree/branch checkout (subgroup header "+").
 * S16: sets creatingKey to `${ws.id}|${cwd}` so only the clicked subgroup "+” spins.
 */
export async function startSessionAt(
	ws: Workspace,
	cwd: string,
): Promise<void> {
	if (creationInFlight) return;
	creationInFlight = true;
	useSidebarStore.getState().setCreatingKey(`${ws.id}|${cwd}`);

	try {
		const draft = findEmptyDraft(cwd, ws.mode);
		if (draft) {
			useUi.getState().selectSession(draft.id);
			useComposer.getState().focusComposer(draft.id);
			return;
		}

		const { sessionId, stub } = await createSession({
			cwd,
			workspaceId: ws.id,
			mode: ws.mode,
		});
		useSessions.getState().upsert([stub]);
		useUi.getState().selectSession(sessionId);
		useComposer.getState().focusComposer(sessionId);
	} catch (err) {
		toast.error(`创建会话失败: ${errMsg(err)}`);
	} finally {
		creationInFlight = false;
		useSidebarStore.getState().setCreatingKey(null);
	}
}

/**
 * Opens a session directly in an existing worktree checkout `cwd` (git panel
 * "+" buttons). Reuses an empty draft there; the model follows the Settings
 * default; the workspace is resolved from `cwd` within the current space by
 * `createSession`.
 */
export async function startSessionInWorktree(cwd: string): Promise<void> {
	if (creationInFlight) return;
	creationInFlight = true;
	const mode = useSidebarStore.getState().activeMode;
	try {
		const draft = findEmptyDraft(cwd, mode);
		if (draft) {
			useUi.getState().selectSession(draft.id);
			useComposer.getState().focusComposer(draft.id);
			return;
		}
		const { sessionId, stub } = await createSession({
			cwd,
			model: useSettings.getState().settings?.newSessionModel || null,
			mode,
		});
		useSessions.getState().upsert([stub]);
		useUi.getState().selectSession(sessionId);
		useComposer.getState().focusComposer(sessionId);
	} catch (err) {
		toast.error(`创建会话失败: ${errMsg(err)}`);
	} finally {
		creationInFlight = false;
	}
}

/**
 * "新建会话" / ⌘N: open (or reuse) an empty draft in the active space —
 * 通用对话 → the global workspace; project modes → the project of the
 * selected session, else the space's most recently used project. With no
 * project it just clears the selection and the launcher view asks for a
 * project directory.
 */
export async function startNewSession(): Promise<void> {
	const { workspaces, sessions } = useSessions.getState();
	const ws = resolveNewSessionTargetWorkspace(
		useSidebarStore.getState().activeMode,
		useUi.getState().selectedSessionId,
		sessions,
		workspaces,
	);
	if (!ws) {
		useUi.getState().selectSession(null);
		return;
	}
	await startSessionInDir(ws, false);
}

let draftCleanupInstalled = false;

/**
 * Codex-style draft auto-cleanup: when selection leaves a completely empty
 * draft (unnamed, no transcript, no typed text or images), drop it from the
 * store and delete it on the backend — whichever mode the draft lives in.
 * Drafts with typed text or images survive as "新建的草稿". Idempotent; call
 * at app start.
 */
export function installDraftAutoCleanup(): () => void {
	if (draftCleanupInstalled) return () => {};
	draftCleanupInstalled = true;
	const unsub = useUi.subscribe((state, prev) => {
		const id = prev.selectedSessionId;
		if (!id || id === state.selectedSessionId) return;
		const s = useSessions.getState().sessions[id];
		if (!s || s.title?.trim() || s.label?.trim() || s.lastAssistant) return;
		if (s.status !== "idle") return;
		const live = useLive.getState().sessions[id];
		if (hasLiveUserActivity(live)) return;
		const composer = useComposer.getState();
		const text = composer.drafts[id] ?? "";
		const images = composer.images[id] ?? [];
		if (text.trim() !== "" || images.length > 0) return;
		useSessions.getState().remove([id]);
		deleteSession(id).catch(() => {});
	});
	return () => {
		unsub();
		draftCleanupInstalled = false;
	};
}
