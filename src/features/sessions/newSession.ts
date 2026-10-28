/** Desktop new-session helpers: create local drafts, never eager omp processes. */

import type { SessionMeta, SpaceMode, Workspace } from "../../lib/contracts";
import { isBlankDraft, type CreateSessionOpts } from "../../lib/createSession";
import { errMsg } from "../../lib/dialogs";
import { deleteSession, gitCreateWorktree, gitSummary, setSessionGroup } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { useComposer } from "../../stores/composer";
import { hasLiveUserActivity, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useWorktrees } from "../../stores/worktrees";
import { useSidebarStore } from "./sidebarStore";
import { useSessionGroups } from "./sessionGroups";
import { useSettings } from "../settings/store";
import { resolveNewSessionTargetWorkspace } from "./modes";
import { findBlankDraft, usePendingSession } from "./pendingSession";
import { releaseBlankDraft } from "./draftSession";
import { closeForkDraft } from "./forkDraft";
import { tNow } from "../../stores/language";

let creationInFlight = false;

/** A live, unnamed, idle session in the same place that no local draft owns. */
function findReusableStub(cwd: string, mode: SpaceMode): SessionMeta | null {
	const owned = new Set(Object.values(usePendingSession.getState().drafts).map((d) => d.sessionId));
	const lives = useLive.getState().sessions;
	for (const s of Object.values(useSessions.getState().sessions)) {
		if (s.cwd !== cwd || s.mode !== mode || !s.live || s.archived || owned.has(s.id)) continue;
		if (isBlankDraft(s, lives[s.id])) return s;
	}
	return null;
}

/** Select an existing empty session, filing it where the user asked. */
function adoptStub(stub: SessionMeta, regroup: string | null | undefined): void {
	usePendingSession.getState().select(null);
	if (regroup !== undefined && stub.groupId !== regroup) {
		const sessions = useSessions.getState();
		sessions.upsert([{ ...stub, groupId: regroup ?? null }]);
		setSessionGroup(stub.id, regroup ?? null).catch((err) => {
			useSessions.getState().upsert([stub]);
			toast.error(tNow("sessions.createSessionFailed", { error: errMsg(err) }));
		});
	}
	useUi.getState().selectSession(stub.id);
	useComposer.getState().focusComposer(stub.id);
}

/**
 * Show a draft for `opts` without starting any process: reuse a blank local
 * draft in the same cwd + mode + group, else an empty real session there,
 * else create a new local draft. `regroup` re-files an adopted empty session.
 */
function openDraft(opts: CreateSessionOpts, regroup?: string | null): void {
	closeForkDraft();
	if (!findBlankDraft(opts)) {
		const stub = findReusableStub(opts.cwd, opts.mode ?? "code");
		if (stub) {
			adoptStub(stub, regroup);
			return;
		}
	}
	const id = usePendingSession.getState().open(opts);
	useUi.setState({ selectedSessionId: null, centerView: "session" });
	useComposer.getState().focusComposer(id);
}

function groupToast(groupId: string | null | undefined): void {
	if (!groupId) return;
	useSidebarStore.getState().setGroupOpen((prev) => ({ ...prev, [`grp:${groupId}`]: true }));
	const name = useSessionGroups.getState().groups.find((g) => g.id === groupId)?.name;
	if (name) toast.success(tNow("sessions.createdInGroup", { group: name }));
}

export async function startSessionInDir(ws: Workspace, isolatedWorktree: boolean, groupId?: string | null): Promise<void> {
	if (creationInFlight) return;
	creationInFlight = true;
	const key = groupId ? `${ws.id}|${ws.path}|${groupId}` : `${ws.id}|${ws.path}`;
	useSidebarStore.getState().setCreatingKey(key);
	try {
		let cwd = ws.path;
		if (isolatedWorktree && ws.kind !== "global") {
			const summary = await gitSummary(ws.path).catch(() => null);
			if (!summary?.isRepo) {
				toast.error(tNow("sessions.notGitRepoCannotCreateWorktree"));
				return;
			}
			const wt = await gitCreateWorktree(ws.path, `task-${Math.floor(Date.now() / 1000)}`);
			cwd = wt.path;
			await useWorktrees.getState().refresh().catch(() => {});
		}
		const actualGroup = ws.kind === "global" ? (groupId ?? null) : null;
		openDraft({ cwd, workspaceId: ws.id, mode: ws.mode, groupId: actualGroup }, groupId === undefined ? undefined : actualGroup);
		groupToast(actualGroup);
	} catch (err) {
		toast.error(tNow("sessions.createSessionFailed", { error: errMsg(err) }));
	} finally {
		creationInFlight = false;
		useSidebarStore.getState().setCreatingKey(null);
	}
}

export async function startSessionAt(ws: Workspace, cwd: string): Promise<void> {
	if (creationInFlight) return;
	creationInFlight = true;
	useSidebarStore.getState().setCreatingKey(`${ws.id}|${cwd}`);
	try {
		openDraft({ cwd, workspaceId: ws.id, mode: ws.mode });
	} catch (err) {
		toast.error(tNow("sessions.createSessionFailed", { error: errMsg(err) }));
	} finally {
		creationInFlight = false;
		useSidebarStore.getState().setCreatingKey(null);
	}
}

export async function startSessionInWorktree(cwd: string): Promise<void> {
	if (creationInFlight) return;
	creationInFlight = true;
	const mode = useSidebarStore.getState().activeMode;
	try {
		openDraft({ cwd, model: useSettings.getState().settings?.newSessionModel || null, mode });
	} catch (err) {
		toast.error(tNow("sessions.createSessionFailed", { error: errMsg(err) }));
	} finally {
		creationInFlight = false;
	}
}

export async function startNewSession(): Promise<void> {
	const { workspaces, sessions } = useSessions.getState();
	const ws = resolveNewSessionTargetWorkspace(
		useSidebarStore.getState().activeMode,
		useUi.getState().selectedSessionId,
		sessions,
		workspaces,
	);
	if (!ws) {
		closeForkDraft();
		usePendingSession.getState().select(null);
		useUi.getState().leaveSession();
		return;
	}
	await startSessionInDir(ws, false);
}

let draftCleanupInstalled = false;

/**
 * Navigation cleanup. A local draft shown in the center pane stays in the
 * store (and the sidebar, once it has input) when the user leaves; only a
 * blank one gives its prewarmed process back. Completely empty real stubs are
 * dropped and deleted when selection leaves them; drafts with typed text or
 * images survive. Idempotent; call at app start.
 */
export function installDraftAutoCleanup(): () => void {
	if (draftCleanupInstalled) return () => {};
	draftCleanupInstalled = true;
	const unsub = useUi.subscribe((state, prev) => {
		const pending = usePendingSession.getState();
		const shown = pending.selectedId;
		if (shown && (state.selectedSessionId !== null ||
			(state.centerView !== "session" && state.centerView !== "settings"))) {
			pending.select(null);
			void releaseBlankDraft(shown);
		}
		const id = prev.selectedSessionId;
		if (!id || id === state.selectedSessionId) return;
		const s = useSessions.getState().sessions[id];
		if (!s || s.title?.trim() || s.label?.trim() || s.lastAssistant) return;
		if (s.status !== "idle") return;
		if (Object.values(pending.drafts).some((d) => d.sessionId === id)) return;
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
