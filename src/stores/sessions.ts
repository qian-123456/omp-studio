/**
 * SessionMeta map, loaded via list_sessions + events (§10). [LEAD]
 * Subscribes to `sessions:updated` / `sessions:removed` once at app start.
 */

import type { UnlistenFn } from "@tauri-apps/api/event";
import { create } from "zustand";
import type { SessionMeta, Workspace } from "../lib/contracts";
import { onSessionsRemoved, onSessionsUpdated } from "../lib/events";
import { listSessions, listWorkspaces } from "../lib/ipc";

export interface SessionsState {
	sessions: Record<string, SessionMeta>;
	workspaces: Workspace[];
	load(): Promise<void>;
	upsert(list: SessionMeta[]): void;
	remove(ids: string[]): void;
}

export const useSessions = create<SessionsState>((set) => ({
	sessions: {},
	workspaces: [],
	load: async () => {
		const [sessions, workspaces] = await Promise.all([
			listSessions(),
			listWorkspaces(),
		]);
		set({
			sessions: Object.fromEntries(sessions.map((s) => [s.id, s])),
			workspaces,
		});
	},
	upsert: (list) =>
		set((s) => {
			const sessions = { ...s.sessions };
			for (const meta of list) sessions[meta.id] = meta;
			return { sessions };
		}),
	remove: (ids) =>
		set((s) => {
			const sessions = { ...s.sessions };
			for (const id of ids) delete sessions[id];
			return { sessions };
		}),
}));

let unlisteners: Promise<UnlistenFn>[] | null = null;

/** Wire `sessions:updated`/`sessions:removed` once; call at app start. */
export function startSessionEvents(): void {
	if (unlisteners) return;
	const { upsert, remove } = useSessions.getState();
	unlisteners = [onSessionsUpdated(upsert), onSessionsRemoved(remove)];
}
