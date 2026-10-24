import { create } from "zustand";
import type { SessionMeta, WorktreeInfo } from "../../lib/contracts";
import { confirmDialog, errMsg } from "../../lib/dialogs";
import { isSessionBusy } from "../../lib/createSession";
import { deleteSession, updateSessionMeta } from "../../lib/ipc";
import { isInside } from "../../lib/paths";
import { sessionDisplayName } from "../../lib/sessionName";
import { toast } from "../../lib/toast";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { archiveSessions } from "./archiveUndo";
import { neighborAfterRemoval } from "./visibleRows";
import { tNow } from "../../stores/language";

export interface ArchiveWorktreeTarget {
	session: SessionMeta;
	repo: string;
	wt: WorktreeInfo;
}

interface SessionActionsState {
	/** Session id currently requested to enter inline rename */
	renameSessionId: string | null;
	/** Session id currently requested to open context menu */
	menuSessionId: string | null;

	/** Dialog: archive session sitting in a linked worktree */
	archiveWorktreeTarget: ArchiveWorktreeTarget | null;

	/** Dialog: assign 1..N sessions to a workspace */
	assignSessionIds: string[] | null;

	/** Dialog: move 1..N 无项目 sessions into a SessionGroup */
	moveToGroupSessionIds: string[] | null;

	/** Dialog: takeover external session */
	takeoverSessionId: string | null;

	setRenameSessionId(id: string | null): void;
	setMenuSessionId(id: string | null): void;
	setArchiveWorktreeTarget(target: ArchiveWorktreeTarget | null): void;
	setAssignSessionIds(ids: string[] | null): void;
	setMoveToGroupSessionIds(ids: string[] | null): void;
	setTakeoverSessionId(id: string | null): void;
}

export const useSessionActions = create<SessionActionsState>((set) => ({
	renameSessionId: null,
	menuSessionId: null,
	archiveWorktreeTarget: null,
	assignSessionIds: null,
	moveToGroupSessionIds: null,
	takeoverSessionId: null,

	setRenameSessionId: (id) => set({ renameSessionId: id }),
	setMenuSessionId: (id) => set({ menuSessionId: id }),
	setArchiveWorktreeTarget: (target) => set({ archiveWorktreeTarget: target }),
	setAssignSessionIds: (ids) => set({ assignSessionIds: ids }),
	setMoveToGroupSessionIds: (ids) => set({ moveToGroupSessionIds: ids }),
	setTakeoverSessionId: (id) => set({ takeoverSessionId: id }),
}));

/**
 * Resolve the real worktree: deepest WorktreeInfo in
 * `useWorktrees.getState().byWorkspace[session.workspaceId]` whose path contains
 * `session.cwd` (`isInside`), excluding the main checkout.
 */
export function findLinkedWorktree(
	session: SessionMeta,
): { repo: string; wt: WorktreeInfo } | null {
	const workspaceId = session.workspaceId;
	if (!workspaceId) return null;

	const worktrees = useWorktrees.getState().byWorkspace[workspaceId] ?? [];
	if (worktrees.length <= 1) return null;

	const workspaces = useSessions.getState().workspaces;
	const ws = workspaces.find((w) => w.id === workspaceId);
	const repo = ws?.path || session.repoRoot || session.cwd;
	const normalizedRepo = repo.replace(/\/+$/, "");

	const candidates = worktrees.filter((wt) => {
		const normalizedWtPath = wt.path.replace(/\/+$/, "");
		// Exclude main checkout
		if (normalizedWtPath === normalizedRepo) return false;
		return isInside(session.cwd, wt.path);
	});

	if (candidates.length === 0) return null;
	// Deepest worktree path
	candidates.sort((a, b) => b.path.length - a.path.length);
	return { repo, wt: candidates[0] };
}

/**
 * Single-archive flow:
 * If the session sits in a live linked worktree → opens the archive-worktree dialog
 * with 仅归档 / 归档并清理; otherwise archives immediately via `archiveSessions([id])`.
 */
export function requestArchive(sessionId: string): void {
	const session = useSessions.getState().sessions[sessionId];
	if (!session) return;

	if (session.archived) {
		// If already archived, unarchive
		updateSessionMeta(session.id, { archived: false })
			.then((updated) => {
				useSessions.getState().upsert([updated]);
				toast.success(tNow("sessionActions.unarchived"));
			})
			.catch((err) => toast.error(tNow("sessions.unarchiveFailed", { error: errMsg(err) })));
		return;
	}

	const linked = findLinkedWorktree(session);
	if (linked) {
		useSessionActions.getState().setArchiveWorktreeTarget({
			session,
			repo: linked.repo,
			wt: linked.wt,
		});
	} else {
		void archiveSessions([sessionId]);
	}
}

/**
 * Delete 1..N sessions:
 * Skip busy via `isSessionBusy`, confirmDialog, delete in parallel,
 * remove from store, move selection with `neighborAfterRemoval` if the selected
 * one was deleted, toast with skipped count.
 */
export async function requestDelete(sessionIds: string[]): Promise<void> {
	if (sessionIds.length === 0) return;
	const sessions = useSessions.getState().sessions;

	const deletable: string[] = [];
	let skippedCount = 0;

	for (const id of sessionIds) {
		const s = sessions[id];
		if (s && isSessionBusy(s)) {
			skippedCount++;
		} else if (s) {
			deletable.push(id);
		}
	}

	if (deletable.length === 0) {
		if (skippedCount > 0) {
			toast.info(tNow("sessions.allSelectedBusyStopFirst"));
		}
		return;
	}

	const confirmMessage =
		deletable.length === 1
			? tNow("sessions.confirmDeleteSingle", { title: sessionDisplayName(sessions[deletable[0]]) })
			: tNow("sessions.confirmDeleteCount", { count: deletable.length });

	const ok = await confirmDialog(confirmMessage, {
		danger: true,
		okLabel: tNow("sessions.permanentDeleteAction"),
		title: tNow("sessions.deleteSessionsTitle"),
	});
	if (!ok) return;

	const selectedSessionId = useUi.getState().selectedSessionId;
	const isSelectedDeleted =
		selectedSessionId !== null && deletable.includes(selectedSessionId);
	const nextSelectionId = isSelectedDeleted
		? neighborAfterRemoval(deletable)
		: null;

	const results = await Promise.allSettled(
		deletable.map((id) => deleteSession(id)),
	);

	const deletedIds: string[] = [];
	let failedCount = 0;
	results.forEach((res, idx) => {
		if (res.status === "fulfilled") {
			deletedIds.push(deletable[idx]);
		} else {
			failedCount++;
		}
	});

	if (deletedIds.length > 0) {
		useSessions.getState().remove(deletedIds);
		if (isSelectedDeleted) {
			useUi.getState().selectSession(nextSelectionId);
		}
		// Clear deleted ids from multi-selection
		const currentSelectedIds = new Set(useUi.getState().selectedIds);
		for (const id of deletedIds) {
			currentSelectedIds.delete(id);
		}
		useUi.getState().setSelectedIds(currentSelectedIds);
	}

	if (failedCount > 0) {
		toast.error(tNow("sessions.deleteFailedCount", { count: failedCount }));
	} else {
		const msg =
			deletedIds.length === 1
				? tNow("sessions.sessionDeleted")
				: tNow("sessions.deletedCount", { count: deletedIds.length });
		toast.success(
			skippedCount > 0
				? tNow("sessions.deletedWithSkipped", { message: msg, count: skippedCount })
				: msg,
		);
	}
}

/** Opens the 归入工作区 dialog; works for 1..N ids. */
export function requestAssign(sessionIds: string[]): void {
	if (sessionIds.length === 0) return;
	useSessionActions.getState().setAssignSessionIds(sessionIds);
}

/** Opens the 移到分组 dialog for 1..N 无项目 sessions. */
export function requestMoveToGroup(sessionIds: string[]): void {
	if (sessionIds.length === 0) return;
	useSessionActions.getState().setMoveToGroupSessionIds(sessionIds);
}

/** Requests row to enter inline rename. */
export function requestRename(sessionId: string): void {
	useSessionActions.getState().setRenameSessionId(sessionId);
}

/** Requests row to open its context menu anchored at the row. */
export function requestRowMenu(sessionId: string): void {
	useSessionActions.getState().setMenuSessionId(sessionId);
}

/** Requests takeover external session dialog. */
export function requestTakeover(sessionId: string): void {
	useSessionActions.getState().setTakeoverSessionId(sessionId);
}
