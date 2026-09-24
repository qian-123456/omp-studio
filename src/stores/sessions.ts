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

interface InFlightLoad {
	id: number;
	updatedIds: Set<string>;
	removedIds: Set<string>;
}

let nextLoadId = 0;
let latestAppliedLoadId = 0;
const activeLoads = new Set<InFlightLoad>();

export const useSessions = create<SessionsState>((set) => ({
	sessions: {},
	workspaces: [],
	load: async () => {
		const loadCtx: InFlightLoad = {
			id: ++nextLoadId,
			updatedIds: new Set(),
			removedIds: new Set(),
		};
		activeLoads.add(loadCtx);

		try {
			await startSessionEvents();

			const [sessions, workspaces] = await Promise.all([
				listSessions(),
				listWorkspaces(),
			]);

			// If a newer load already applied, discard this older snapshot
			if (loadCtx.id < latestAppliedLoadId) {
				return;
			}
			latestAppliedLoadId = loadCtx.id;

			set((state) => {
				const currentSessions = state.sessions;
				const nextSessions: Record<string, SessionMeta> = {};

				// Reconcile snapshot with events that occurred in-flight
				for (const session of sessions) {
					if (loadCtx.removedIds.has(session.id)) {
						// Removed during fetch; do not resurrect
						continue;
					}
					if (loadCtx.updatedIds.has(session.id)) {
						// Updated during fetch; prefer current store version
						nextSessions[session.id] =
							currentSessions[session.id] ?? session;
						continue;
					}
					nextSessions[session.id] = session;
				}

				// Preserve sessions updated/added in flight but missing from snapshot
				for (const id of loadCtx.updatedIds) {
					if (!loadCtx.removedIds.has(id) && currentSessions[id]) {
						nextSessions[id] = currentSessions[id];
					}
				}

				return {
					sessions: nextSessions,
					workspaces,
				};
			});
		} finally {
			activeLoads.delete(loadCtx);
		}
	},
	upsert: (list) => {
		if (list.length === 0) return;
		for (const load of activeLoads) {
			for (const meta of list) {
				load.updatedIds.add(meta.id);
				load.removedIds.delete(meta.id);
			}
		}
		set((s) => {
			const sessions = { ...s.sessions };
			for (const meta of list) sessions[meta.id] = meta;
			return { sessions };
		});
	},
	remove: (ids) => {
		if (ids.length === 0) return;
		for (const load of activeLoads) {
			for (const id of ids) {
				load.removedIds.add(id);
				load.updatedIds.delete(id);
			}
		}
		set((s) => {
			const sessions = { ...s.sessions };
			for (const id of ids) delete sessions[id];
			return { sessions };
		});
	},
}));

let activeUnlisteners: UnlistenFn[] | null = null;
let startEventsPromise: Promise<void> | null = null;

/** Wire `sessions:updated`/`sessions:removed` once; call at app start. */
export async function startSessionEvents(): Promise<void> {
	if (activeUnlisteners) {
		return;
	}
	if (startEventsPromise) {
		return startEventsPromise;
	}

	startEventsPromise = (async () => {
		const results = await Promise.allSettled([
			onSessionsUpdated((sessions) => {
				useSessions.getState().upsert(sessions);
			}),
			onSessionsRemoved((ids) => {
				useSessions.getState().remove(ids);
			}),
		]);

		const [r1, r2] = results;
		if (r1.status === "rejected" || r2.status === "rejected") {
			if (r1.status === "fulfilled") {
				try {
					r1.value();
				} catch (cleanupErr) {
					console.error(
						"Failed to unlisten sessions:updated during cleanup",
						cleanupErr,
					);
				}
			}
			if (r2.status === "fulfilled") {
				try {
					r2.value();
				} catch (cleanupErr) {
					console.error(
						"Failed to unlisten sessions:removed during cleanup",
						cleanupErr,
					);
				}
			}
			activeUnlisteners = null;
			const err =
				r1.status === "rejected"
					? r1.reason
					: (r2 as PromiseRejectedResult).reason;
			throw err;
		}

		activeUnlisteners = [r1.value, r2.value];
	})().finally(() => {
		startEventsPromise = null;
	});

	return startEventsPromise;
}

/** Stop active listeners and clean up; useful for tests and teardown. */
export async function stopSessionEvents(): Promise<void> {
	if (startEventsPromise) {
		try {
			await startEventsPromise;
		} catch {
			// ignore failure of in-flight start
		}
	}
	if (activeUnlisteners) {
		const fns = activeUnlisteners;
		activeUnlisteners = null;
		for (const unlisten of fns) {
			try {
				unlisten();
			} catch (err) {
				console.error("Failed to unlisten session event", err);
			}
		}
	}
	activeLoads.clear();
	nextLoadId = 0;
	latestAppliedLoadId = 0;
}
