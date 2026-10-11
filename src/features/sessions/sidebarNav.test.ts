import { describe, expect, it } from "vitest";
import type { Workspace, SessionMeta } from "../../lib/contracts";
import { groupSessions } from "./grouping";
import {
	isGlobalGroupVisibleInAll,
	isWorkspaceGroupVisibleInAll,
} from "./sidebarVisibility";

function makeSession(partial: Partial<SessionMeta>): SessionMeta {
	return {
		id: partial.id || "test-id",
		tool: "omp",
		file: "/tmp/s1.jsonl",
		cwd: partial.cwd || "/repo/my-proj",
		title: partial.title || "Test Session",
		label: partial.label || "#1",
		createdAt: partial.createdAt || "2026-09-28T12:00:00Z",
		updatedAt: partial.updatedAt || "2026-09-28T12:00:00Z",
		archived: partial.archived || false,
		pinned: partial.pinned || false,
		workspaceId: partial.workspaceId ?? null,
		parentId: partial.parentId || null,
		forkDepth: partial.forkDepth || 0,
		status: partial.status || "idle",
		unread: partial.unread || false,
		pending: partial.pending ?? null,
		live: partial.live || false,
		externalPid: partial.externalPid ?? null,
		repoRoot: partial.repoRoot ?? null,
		git: partial.git ?? null,
		result: partial.result ?? null,
		lastAssistant: partial.lastAssistant ?? null,
		model: partial.model ?? null,
		attention: null,
		...partial,
	};
}

const projWs: Workspace = {
	id: "proj1",
	name: "Project 1",
	path: "/repo/my-proj",
	kind: "project",
	sort: 0,
};

const emptyWs: Workspace = {
	id: "proj2",
	name: "Empty Project",
	path: "/repo/empty-proj",
	kind: "project",
	sort: 1,
};

const globalWs: Workspace = {
	id: "global",
	name: "Global",
	path: "/global",
	kind: "global",
	sort: 99,
};

describe("Sidebar Navigation & Filtering logic", () => {
	it("hides empty workspace groups in 'all' mode while preserving active workspace when filtered", () => {
		const session = makeSession({ id: "s1", workspaceId: "proj1" });
		const grouped = groupSessions([session], [projWs, emptyWs, globalWs], {
			activeWorkspaceId: "all",
		});

		// 1. globalGroup has 0 sessions -> should be hidden from UI
		expect(isGlobalGroupVisibleInAll(grouped.globalGroup)).toBe(false);

		// 2. emptyWs has 0 sessions -> filtered out by real visibility helper
		const visibleInAll = grouped.workspaceGroups.filter(isWorkspaceGroupVisibleInAll);
		expect(visibleInAll.map((w) => w.workspace.id)).toEqual(["proj1"]);

		// 3. When emptyWs is explicitly selected as active filter:
		const groupedFiltered = groupSessions([session], [projWs, emptyWs, globalWs], {
			activeWorkspaceId: "proj2",
		});
		expect(groupedFiltered.workspaceGroups).toHaveLength(1);
		expect(groupedFiltered.workspaceGroups[0].workspace.id).toBe("proj2");
		expect(groupedFiltered.workspaceGroups[0].totalCount).toBe(0);
	});

	it("shows global group in 'all' mode only when it has sessions", () => {
		const sGlobal = makeSession({ id: "g1", workspaceId: "global" });
		const grouped = groupSessions([sGlobal], [projWs, emptyWs, globalWs], {
			activeWorkspaceId: "all",
		});

		expect(grouped.globalGroup?.totalCount).toBe(1);
		expect(isGlobalGroupVisibleInAll(grouped.globalGroup)).toBe(true);
	});

	it("includes empty worktree subgroups when worktrees are provided (C2)", () => {
		const session = makeSession({ id: "s1", workspaceId: "proj1", cwd: "/repo/my-proj" });
		const worktrees = [
			{ path: "/repo/my-proj", branch: "main", head: "aaa", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
			{ path: "/repo/my-proj/.worktrees/feat-x", branch: "feat-x", head: "bbb", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		];
		const grouped = groupSessions([session], [projWs], {
			worktrees: { proj1: worktrees },
		});

		const wg = grouped.workspaceGroups[0];
		expect(wg.subgroups).toHaveLength(2);
		expect(wg.subgroups[0].label).toBe("main");
		expect(wg.subgroups[0].isMain).toBe(true);
		expect(wg.subgroups[1].label).toBe("feat-x");
		expect(wg.subgroups[1].sessions).toHaveLength(0);
	});
});
