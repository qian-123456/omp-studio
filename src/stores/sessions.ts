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
	/** True once the first `load()` settled — used to render skeleton rows
	 * instead of flashing the empty state on cold start. */
	hasLoaded: boolean;
	load(): Promise<void>;
	/** Re-fetch just the workspace list (workspace adds/removes emit no event,
	 *  so `sessions:updated` with an unknown workspaceId triggers this). */
	refreshWorkspaces(): Promise<void>;
	upsert(list: SessionMeta[]): void;
	remove(ids: string[]): void;
}
interface InFlightLoad {
	id: number;
	updatedIds: Set<string>;
	removedIds: Set<string>;
}

export function isSessionMetaEqual(a: SessionMeta, b: SessionMeta): boolean {
	if (a === b) return true;
	const gitSame =
		a.git === b.git ||
		(a.git !== null &&
			b.git !== null &&
			a.git.branch === b.git.branch &&
			a.git.dirty === b.git.dirty &&
			a.git.worktree === b.git.worktree);
	const resultSame =
		a.result === b.result ||
		(a.result !== null &&
			b.result !== null &&
			a.result.kind === b.result.kind &&
			a.result.ok === b.result.ok &&
			a.result.at === b.result.at &&
			a.result.summary === b.result.summary);
	return (
		a.id === b.id &&
		a.tool === b.tool &&
		a.file === b.file &&
		a.cwd === b.cwd &&
		a.title === b.title &&
		a.label === b.label &&
		a.createdAt === b.createdAt &&
		a.updatedAt === b.updatedAt &&
		a.parentId === b.parentId &&
		a.forkDepth === b.forkDepth &&
		a.status === b.status &&
		a.unread === b.unread &&
		a.pending === b.pending &&
		a.live === b.live &&
		a.externalPid === b.externalPid &&
		a.pinned === b.pinned &&
		a.archived === b.archived &&
		a.workspaceId === b.workspaceId &&
		a.repoRoot === b.repoRoot &&
		a.lastAssistant === b.lastAssistant &&
		a.model === b.model &&
		gitSame &&
		resultSame
	);
}

const COALESCE_WINDOW_MS = 250; // ≤ ~4 flushes/sec
const pendingMetaUpdates = new Map<string, SessionMeta>();
let coalesceTimer: ReturnType<typeof setTimeout> | null = null;
let lastFlushTime = 0;

export function flushCoalescedSessionUpdates(): void {
	if (coalesceTimer !== null) {
		clearTimeout(coalesceTimer);
		coalesceTimer = null;
	}
	if (pendingMetaUpdates.size === 0) return;
	lastFlushTime = Date.now();
	const batch = Array.from(pendingMetaUpdates.values());
	pendingMetaUpdates.clear();
	useSessions.getState().upsert(batch);

	const known = new Set(
		useSessions.getState().workspaces.map((w) => w.id),
	);
	if (batch.some((s) => s.workspaceId && !known.has(s.workspaceId))) {
		void useSessions.getState().refreshWorkspaces();
	}
}

function queueSessionUpdates(sessions: SessionMeta[]): void {
	const now = Date.now();
	const elapsed = now - lastFlushTime;

	// In-flight active load tracking is always immediate
	for (const load of activeLoads) {
		for (const meta of sessions) {
			load.updatedIds.add(meta.id);
			load.removedIds.delete(meta.id);
		}
	}

	// Leading edge: if outside the throttle window and no pending queue, apply immediately
	if (elapsed >= COALESCE_WINDOW_MS && pendingMetaUpdates.size === 0 && coalesceTimer === null) {
		lastFlushTime = now;
		useSessions.getState().upsert(sessions);
		const known = new Set(
			useSessions.getState().workspaces.map((w) => w.id),
		);
		if (sessions.some((s) => s.workspaceId && !known.has(s.workspaceId))) {
			void useSessions.getState().refreshWorkspaces();
		}
		return;
	}

	// Trailing edge: buffer high-frequency events and flush at end of window
	for (const s of sessions) {
		pendingMetaUpdates.set(s.id, s);
	}
	if (coalesceTimer === null) {
		const remaining = Math.max(0, COALESCE_WINDOW_MS - elapsed);
		coalesceTimer = setTimeout(flushCoalescedSessionUpdates, remaining);
	}
}

let workspacesRefreshInFlight: Promise<void> | null = null;
let nextLoadId = 0;
let latestAppliedLoadId = 0;
const activeLoads = new Set<InFlightLoad>();

export const useSessions = create<SessionsState>((set) => ({
	sessions: {},
	workspaces: [],
	usages: {},
	hasLoaded: false,
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

			flushCoalescedSessionUpdates();
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
					const existing = currentSessions[session.id];
					if (existing && isSessionMetaEqual(existing, session)) {
						nextSessions[session.id] = existing;
					} else {
						nextSessions[session.id] = session;
					}
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
			set({ hasLoaded: true });
		}
	},
	refreshWorkspaces: async () => {
		if (workspacesRefreshInFlight) return workspacesRefreshInFlight;
		workspacesRefreshInFlight = (async () => {
			try {
				const workspaces = await listWorkspaces();
				set({ workspaces });
			} catch {
				// non-fatal: sidebar keeps last-known groups
			} finally {
				workspacesRefreshInFlight = null;
			}
		})();
		return workspacesRefreshInFlight;
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
			let changed = false;
			for (const meta of list) {
				const cur = s.sessions[meta.id];
				if (!cur || !isSessionMetaEqual(cur, meta)) {
					changed = true;
					break;
				}
			}
			if (!changed) {
				return s;
			}
			const sessions = { ...s.sessions };
			for (const meta of list) {
				const cur = s.sessions[meta.id];
				if (!cur || !isSessionMetaEqual(cur, meta)) {
					sessions[meta.id] = meta;
				}
			}
			return { sessions };
		});
	},
	remove: (ids) => {
		if (ids.length === 0) return;
		for (const id of ids) {
			pendingMetaUpdates.delete(id);
		}
		for (const load of activeLoads) {
			for (const id of ids) {
				load.removedIds.add(id);
				load.updatedIds.delete(id);
			}
		}
		set((s) => {
			let changed = false;
			for (const id of ids) {
				if (id in s.sessions) {
					changed = true;
					break;
				}
			}
			if (!changed) return s;
			const sessions = { ...s.sessions };
			for (const id of ids) {
				delete sessions[id];
			}
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
				queueSessionUpdates(sessions);
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
	flushCoalescedSessionUpdates();
	if (coalesceTimer !== null) {
		clearTimeout(coalesceTimer);
		coalesceTimer = null;
	}
	pendingMetaUpdates.clear();
	lastFlushTime = 0;
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
