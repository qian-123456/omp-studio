import { describe, expect, it } from "vitest";
import type { Workspace, SessionMeta } from "../../lib/contracts";
import { groupSessions } from "./grouping";

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
		mode: partial.mode ?? "code",
		groupId: partial.groupId ?? null,
		...partial,
	};
}

const projWs: Workspace = {
	id: "proj1",
	name: "Project 1",
	path: "/repo/my-proj",
	kind: "project",
	sort: 0,
	mode: "code",
};

const emptyWs: Workspace = {
	id: "proj2",
	name: "Empty Project",
	path: "/repo/empty-proj",
	kind: "project",
	sort: 1,
	mode: "code",
};

const globalWs: Workspace = {
	id: "global",
	name: "Global",
	path: "/global",
	kind: "global",
	sort: 99,
	mode: "code",
};

const workProjWs: Workspace = {
	id: "wproj",
	name: "Work Project",
	path: "/work/proj",
	kind: "project",
	sort: 0,
	mode: "work",
};

const workGlobalWs: Workspace = {
	id: "global:work",
	name: "Global",
	path: "/work/global",
	kind: "global",
	sort: 99,
	mode: "work",
};

describe("Sidebar Navigation & Filtering logic", () => {
	it("renders every project group of the mode, empty ones included", () => {
		const session = makeSession({ id: "s1", workspaceId: "proj1" });
		const grouped = groupSessions([session], [projWs, emptyWs, globalWs], {
			mode: "code",
		});

		expect(grouped.workspaceGroups.map((w) => w.workspace.id)).toEqual([
			"proj1",
			"proj2",
		]);
		expect(grouped.workspaceGroups[1].totalCount).toBe(0);
	});

	it("shows the mode's global group only when it has sessions", () => {
		const sGlobal = makeSession({ id: "g1", workspaceId: "global" });
		const grouped = groupSessions([sGlobal], [projWs, globalWs], {
			mode: "code",
		});

		expect(grouped.globalGroup?.totalCount).toBe(1);
		expect(grouped.globalGroup?.workspace.id).toBe("global");

		const emptyMode = groupSessions([], [projWs, globalWs], { mode: "code" });
		expect(emptyMode.globalGroup).not.toBeNull();
		expect(emptyMode.globalGroup?.totalCount).toBe(0);
	});

	it("keeps each mode's sidebar isolated from the other modes", () => {
		const codeSession = makeSession({ id: "c1", workspaceId: "proj1" });
		const workSession = makeSession({
			id: "w1",
			workspaceId: "wproj",
			mode: "work",
		});

		const codeView = groupSessions(
			[codeSession, workSession],
			[projWs, globalWs, workProjWs, workGlobalWs],
			{ mode: "code" },
		);
		expect(codeView.workspaceGroups.map((w) => w.workspace.id)).toEqual(["proj1"]);
		expect(codeView.globalGroup?.workspace.id).toBe("global");
		expect(codeView.totalVisible).toBe(1);

		const workView = groupSessions(
			[codeSession, workSession],
			[projWs, globalWs, workProjWs, workGlobalWs],
			{ mode: "work" },
		);
		expect(workView.workspaceGroups.map((w) => w.workspace.id)).toEqual(["wproj"]);
		expect(workView.globalGroup?.workspace.id).toBe("global:work");
		expect(workView.totalVisible).toBe(1);
	});

	it("includes empty worktree subgroups when worktrees are provided (C2)", () => {
		const session = makeSession({ id: "s1", workspaceId: "proj1", cwd: "/repo/my-proj" });
		const worktrees = [
			{ path: "/repo/my-proj", branch: "main", head: "aaa", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
			{ path: "/repo/my-proj/.worktrees/feat-x", branch: "feat-x", head: "bbb", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		];
		const grouped = groupSessions([session], [projWs], {
			mode: "code",
			worktrees: { proj1: worktrees },
		});

		const wg = grouped.workspaceGroups[0];
		expect(wg.subgroups).toHaveLength(2);
		expect(wg.subgroups[0].label).toBe("main");
		expect(wg.subgroups[0].isMain).toBe(true);
		expect(wg.subgroups[1].label).toBe("feat-x");
		expect(wg.subgroups[1].sessions).toHaveLength(0);
	});

	it("groups Universal sessions into time chunks without project workspace grouping", () => {
		const chatGlobalWs: Workspace = {
			id: "global",
			name: "Universal",
			path: "/global",
			kind: "global",
			sort: 99,
			mode: "chat",
		};
		const sToday = makeSession({
			id: "u1",
			workspaceId: "global",
			mode: "chat",
			updatedAt: new Date(2026, 9, 21, 10, 0, 0).toISOString(),
		});
		const sYesterday = makeSession({
			id: "u2",
			workspaceId: "global",
			mode: "chat",
			updatedAt: new Date(2026, 9, 20, 15, 0, 0).toISOString(),
		});

		const chatView = groupSessions([sToday, sYesterday], [chatGlobalWs], {
			mode: "chat",
		});

		expect(chatView.workspaceGroups).toHaveLength(0);
		expect(chatView.globalGroup?.subgroups[0].sessions).toHaveLength(2);
	});
});
