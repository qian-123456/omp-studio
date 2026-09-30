/**
 * Live git worktrees per project workspace (§10). Filled by
 * `git_list_worktrees` on demand: the sidebar refreshes it when the workspace
 * list changes, on window focus, and when a session lands in an unknown
 * worktree dir; git-panel create/cleanup flows call `refresh()` too.
 */

import { create } from "zustand";
import type { WorktreeInfo, Workspace } from "../lib/contracts";
import { gitListWorktrees } from "../lib/ipc";
import { useSessions } from "./sessions";

export interface WorktreesState {
	/** WorktreeInfo[] keyed by workspace id; absent while never fetched. */
	byWorkspace: Record<string, WorktreeInfo[]>;
	/**
	 * Refresh `byWorkspace` for the given project workspaces (defaults to the
	 * sessions store list). Non-repos and failures store `[]`. In-flight
	 * refreshes per workspace are deduped.
	 */
	refresh(workspaces?: Workspace[]): Promise<void>;
}

const inFlight = new Set<string>();

export const useWorktrees = create<WorktreesState>((set) => ({
	byWorkspace: {},
	refresh: async (workspaces) => {
		const list = (workspaces ?? useSessions.getState().workspaces).filter(
			(ws) => ws.kind !== "global",
		);
		const results = await Promise.all(
			list.map(async (ws) => {
				if (inFlight.has(ws.id)) return null;
				inFlight.add(ws.id);
				try {
					const worktrees = await gitListWorktrees(ws.path);
					return [ws.id, worktrees] as const;
				} catch {
					return [ws.id, [] as WorktreeInfo[]] as const;
				} finally {
					inFlight.delete(ws.id);
				}
			}),
		);
		const patch: Record<string, WorktreeInfo[]> = {};
		for (const r of results) {
			if (r) patch[r[0]] = r[1];
		}
		if (Object.keys(patch).length > 0) {
			set((s) => ({ byWorkspace: { ...s.byWorkspace, ...patch } }));
		}
	},
}));
