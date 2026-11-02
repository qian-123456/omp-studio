import { useEffect, useLayoutEffect } from "react";
import { create } from "zustand";
import type { Workspace } from "../../lib/contracts";
import { resolveActiveSessionTarget } from "../../lib/activeSessionTarget";
import { gitListWorktrees, gitRepoRoot } from "../../lib/ipc";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useDrawerStore } from "./drawerStore";
import { selectSessionOrDraft, usePendingSession } from "../sessions/pendingSession";
import { startSessionInWorktree } from "../sessions/newSession";
import { useSidebarStore } from "../sessions/sidebarStore";

type ScopeResult = { status: "loading" } | { status: "ready"; roots: string[] | null } | { status: "error"; error: string };
interface ScopeCache {
	entries: Record<string, ScopeResult>;
	load(cwd: string): Promise<void>;
	retry(): void;
}
const scopeLoads = new Map<string, Promise<void>>();
const useScopeCache = create<ScopeCache>((set, get) => ({
	entries: {},
	load: (cwd) => {
		if (!cwd) return Promise.resolve();
		const existing = scopeLoads.get(cwd);
		if (existing) return existing;
		if (get().entries[cwd]) return Promise.resolve();
		set((s) => ({ entries: { ...s.entries, [cwd]: { status: "loading" } } }));
		const promise = (async () => {
			try {
				const root = await gitRepoRoot(cwd);
				const roots = root === null ? null : (await gitListWorktrees(root)).map((item) => item.path);
				set((s) => ({ entries: { ...s.entries, [cwd]: { status: "ready", roots } } }));
			} catch (error) {
				set((s) => ({ entries: { ...s.entries, [cwd]: { status: "error", error: error instanceof Error ? error.message : String(error) } } }));
			}
		})().finally(() => scopeLoads.delete(cwd));
		scopeLoads.set(cwd, promise);
		return promise;
	},
	retry: () => set((s) => ({ entries: Object.fromEntries(Object.entries(s.entries).filter(([, value]) => value.status !== "error")) })),
}));

export function currentTerminalTarget() {
	const ui = useUi.getState();
	const pending = usePendingSession.getState();
	return resolveActiveSessionTarget({
		selectedSessionId: ui.selectedSessionId,
		selectedDraftId: ui.centerView === "session" && !ui.selectedSessionId ? pending.selectedId : null,
		drafts: pending.drafts,
		sessions: useSessions.getState().sessions,
	});
}

export function useTerminalTarget() {
	const selectedSessionId = useUi((s) => s.selectedSessionId);
	const centerView = useUi((s) => s.centerView);
	const selectedDraftId = usePendingSession((s) => s.selectedId);
	const drafts = usePendingSession((s) => s.drafts);
	const sessions = useSessions((s) => s.sessions);
	return resolveActiveSessionTarget({ selectedSessionId, selectedDraftId: centerView === "session" && !selectedSessionId ? selectedDraftId : null, drafts, sessions });
}

/** A verified git worktree root or, for non-repos, the containing project root. */
export function terminalScopeForCwd(cwd: string, workspaces: Workspace[], roots: string[] | null): string {
	if (!cwd) return "";
	const candidates = roots ?? workspaces.filter((w) => w.kind === "project").map((w) => w.path);
	let result = "";
	for (const candidate of candidates) {
		const path = candidate.replace(/\/+$/, "") || "/";
		if ((cwd === path || cwd.startsWith(path === "/" ? "/" : `${path}/`)) && path.length > result.length) result = path;
	}
	return result || cwd;
}

function cachedScope(cwd: string, workspaces: Workspace[], entries: Record<string, ScopeResult>): string {
	const result = entries[cwd];
	return result?.status === "ready" ? terminalScopeForCwd(cwd, workspaces, result.roots) : cwd;
}

export function currentTerminalScope(): string {
	return cachedScope(currentTerminalTarget().cwd ?? "", useSessions.getState().workspaces, useScopeCache.getState().entries);
}

export async function prepareTerminalScope(cwd: string): Promise<string> {
	await useScopeCache.getState().load(cwd);
	const result = useScopeCache.getState().entries[cwd];
	if (result?.status === "error") throw new Error(result.error);
	return cachedScope(cwd, useSessions.getState().workspaces, useScopeCache.getState().entries);
}

export function retryTerminalScopes(): void {
	useScopeCache.getState().retry();
}

/** Observe only navigation identity and target context, not unrelated session updates. */
export function watchTerminalNavigation() {
	const snapshot = () => {
		const ui = useUi.getState();
		const pending = usePendingSession.getState();
		const target = currentTerminalTarget();
		return JSON.stringify([ui.centerView, ui.selectedSessionId, ui.centerView === "session" && !ui.selectedSessionId ? pending.selectedId : null, target.source, target.sessionId, target.cwd, target.workspaceId]);
	};
	const initial = snapshot();
	let cancelled = false;
	const changed = () => { if (snapshot() !== initial) cancelled = true; };
	const unsubscribers = [useUi.subscribe(changed), usePendingSession.subscribe(changed), useSessions.subscribe(changed)];
	return { cancelled: () => cancelled, stop: () => { for (const unsubscribe of unsubscribers) unsubscribe(); } };
}

export function terminalScopesReady(): boolean {
	const entries = useScopeCache.getState().entries;
	const cwds = [currentTerminalTarget().cwd ?? "", ...useDrawerStore.getState().tabs.map((tab) => tab.scope === "" ? "" : tab.cwd)];
	return cwds.every((cwd) => !cwd || entries[cwd]?.status === "ready");
}

export function useTerminalScope(): { scope: string; ready: boolean; error: string | null } {
	const target = useTerminalTarget();
	const workspaces = useSessions((s) => s.workspaces);
	const tabs = useDrawerStore((s) => s.tabs);
	const entries = useScopeCache((s) => s.entries);
	const cwds = [...new Set([target.cwd ?? "", ...tabs.map((tab) => tab.scope === "" ? "" : tab.cwd)].filter(Boolean))];
	const error = cwds.map((cwd) => entries[cwd]).find((entry) => entry?.status === "error");
	const ready = cwds.every((cwd) => entries[cwd]?.status === "ready");
	useEffect(() => {
		for (const cwd of cwds) useScopeCache.getState().load(cwd);
	}, [target.cwd, tabs, entries]);
	useLayoutEffect(() => {
		if (!ready) return;
		const scopes: Record<string, string> = {};
		for (const tab of tabs) scopes[tab.id] = tab.scope === "" ? "" : cachedScope(tab.cwd, workspaces, entries);
		useDrawerStore.getState().reconcileScopes(scopes);
	}, [ready, workspaces, entries, tabs]);
	return { scope: cachedScope(target.cwd ?? "", workspaces, entries), ready, error: error?.status === "error" ? error.error : null };
}

/** Navigate before showing a terminal belonging to a different worktree. */
export async function revealTerminalScope(cwd: string, isCancelled: () => boolean = () => false, beforeNavigate: () => void = () => {}): Promise<void> {
	if (!cwd || currentTerminalScope() === cwd || isCancelled()) return;
	const mode = useSidebarStore.getState().activeMode;
	const sessions = Object.values(useSessions.getState().sessions).filter((s) => s.mode === mode && !s.archived);
	const drafts = Object.values(usePendingSession.getState().drafts).filter((d) => d.mode === mode);
	const candidates = [...sessions.map((session) => session.cwd), ...drafts.map((draft) => draft.cwd)];
	const paths = [...new Set(candidates.filter((path) => path === cwd || path.startsWith(`${cwd}/`)))];
	const resolved = new Map<string, string>();
	for (const path of paths) {
		resolved.set(path, await prepareTerminalScope(path));
		if (isCancelled()) return;
	}
	const session = sessions.find((item) => resolved.get(item.cwd) === cwd);
	if (session) { beforeNavigate(); selectSessionOrDraft(session.id); return; }
	const draft = drafts.find((item) => resolved.get(item.cwd) === cwd);
	if (draft) { beforeNavigate(); selectSessionOrDraft(draft.id); return; }
	if (!isCancelled()) { beforeNavigate(); await startSessionInWorktree(cwd); }
}
