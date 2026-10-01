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
	 * refreshes per workspace queue one trailing refresh if called while in flight,
	 * returning a promise that resolves after the fresh data lands.
	 */
	refresh(workspaces?: Workspace[]): Promise<void>;
}

export class WorkspaceRefreshRunner {
	private inFlight: Promise<WorktreeInfo[]> | null = null;
	private hasTrailing = false;
	private trailingPath = "";
	private trailingResolvers: Array<(res: WorktreeInfo[]) => void> = [];

	async request(
		wsId: string,
		wsPath: string,
		onResult: (id: string, list: WorktreeInfo[]) => void,
	): Promise<WorktreeInfo[]> {
		if (this.inFlight) {
			this.hasTrailing = true;
			this.trailingPath = wsPath;
			return new Promise<WorktreeInfo[]>((resolve) => {
				this.trailingResolvers.push(resolve);
			});
		}

		const runLoop = async (): Promise<WorktreeInfo[]> => {
			const fetch = async (path: string): Promise<WorktreeInfo[]> => {
				let list: WorktreeInfo[];
				try {
					list = await gitListWorktrees(path);
				} catch {
					list = [];
				}
				onResult(wsId, list);
				return list;
			};

			const initialResult = await fetch(wsPath);

			while (this.hasTrailing) {
				this.hasTrailing = false;
				const nextPath = this.trailingPath;
				const currentResolvers = this.trailingResolvers;
				this.trailingResolvers = [];

				const nextResult = await fetch(nextPath);
				for (const r of currentResolvers) {
					try {
						r(nextResult);
					} catch {
						// ignore
					}
				}
			}

			return initialResult;
		};

		const promise = runLoop();
		this.inFlight = promise;
		try {
			return await promise;
		} finally {
			this.inFlight = null;
			if (this.trailingResolvers.length > 0) {
				const leftover = this.trailingResolvers;
				this.trailingResolvers = [];
				this.hasTrailing = false;
				for (const r of leftover) {
					try {
						r([]);
					} catch {
						// ignore
					}
				}
			}
		}
	}
}

const runners = new Map<string, WorkspaceRefreshRunner>();

function getRunner(wsId: string): WorkspaceRefreshRunner {
	let runner = runners.get(wsId);
	if (!runner) {
		runner = new WorkspaceRefreshRunner();
		runners.set(wsId, runner);
	}
	return runner;
}

export const useWorktrees = create<WorktreesState>((set) => ({
	byWorkspace: {},
	refresh: async (workspaces) => {
		const list = (workspaces ?? useSessions.getState().workspaces).filter(
			(ws) => ws.kind !== "global",
		);
		const onResult = (wsId: string, list: WorktreeInfo[]) => {
			set((s) => ({ byWorkspace: { ...s.byWorkspace, [wsId]: list } }));
		};
		await Promise.all(
			list.map((ws) => getRunner(ws.id).request(ws.id, ws.path, onResult)),
		);
	},
}));
