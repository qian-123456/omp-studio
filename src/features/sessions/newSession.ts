/**
 * Unified session creation helpers for the sidebar, header "+", and Cmd+N shortcut.
 * Reads stores via getState() to remain operable when the sidebar is unmounted.
 */

import type { Workspace } from "../../lib/contracts";
import { createSession, findEmptyDraft } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { gitCreateWorktree, gitSummary } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { useSidebarStore } from "./sidebarStore";

let creationInFlight = false;

/**
 * Creates a session under `ws`, either in its main path or in an isolated git worktree.
 * S16: sets creatingKey to `${ws.id}|${ws.path}` so only the relevant spinner runs.
 * S17: rejects isolated worktrees on non-git workspaces with an informative toast.
 */
export async function startSessionInDir(
	ws: Workspace,
	isolatedWorktree: boolean,
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
			const draft = findEmptyDraft(cwd);
			if (draft) {
				useUi.getState().selectSession(draft.id);
				useComposer.getState().focusComposer(draft.id);
				return;
			}
		}

		const { sessionId, stub } = await createSession({
			cwd,
			workspaceId: ws.id,
		});
		useSessions.getState().upsert([stub]);
		useUi.getState().selectSession(sessionId);
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
		const draft = findEmptyDraft(cwd);
		if (draft) {
			useUi.getState().selectSession(draft.id);
			useComposer.getState().focusComposer(draft.id);
			return;
		}

		const { sessionId, stub } = await createSession({
			cwd,
			workspaceId: ws.id,
		});
		useSessions.getState().upsert([stub]);
		useUi.getState().selectSession(sessionId);
	} catch (err) {
		toast.error(`创建会话失败: ${errMsg(err)}`);
	} finally {
		creationInFlight = false;
		useSidebarStore.getState().setCreatingKey(null);
	}
}

/**
 * Context-aware session creation decision used by header "+" and Cmd+N.
 * If in global mode -> starts directly in global workspace.
 * If active workspace exists or single project workspace -> starts in that workspace (or invokes menu callback if provided).
 * Otherwise opens the "new-session" modal.
 */
export async function startNewSessionFromContext(
	openPlusMenuForWs?: (ws: Workspace) => void,
): Promise<void> {
	const activeWorkspaceId = useSidebarStore.getState().activeWorkspaceId;
	const workspaces = useSessions.getState().workspaces;
	const globalWs = workspaces.find((w) => w.kind === "global") ?? null;
	const projectWorkspaces = workspaces
		.filter((w) => w.kind !== "global")
		.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));

	if (activeWorkspaceId === "__global") {
		if (globalWs) {
			await startSessionInDir(globalWs, false);
		}
		return;
	}

	const activeWs =
		activeWorkspaceId === "all"
			? null
			: workspaces.find((w) => w.id === activeWorkspaceId) ?? null;

	if (activeWs) {
		if (openPlusMenuForWs) {
			openPlusMenuForWs(activeWs);
		} else {
			await startSessionInDir(activeWs, false);
		}
		return;
	}

	if (projectWorkspaces.length === 1 && projectWorkspaces[0]) {
		const targetWs = projectWorkspaces[0];
		if (openPlusMenuForWs) {
			openPlusMenuForWs(targetWs);
		} else {
			await startSessionInDir(targetWs, false);
		}
		return;
	}

	useUi.getState().openModal("new-session");
}
