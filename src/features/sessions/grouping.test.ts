import { describe, expect, it } from "vitest";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import {
	createSubgroups,
	filterSessions,
	groupSessions,
	inferWorktreeName,
	matchesSearch,
} from "./grouping";

function makeSession(partial: Partial<SessionMeta>): SessionMeta {
	return {
		id: partial.id || "s1",
		tool: "omp",
		file: "/tmp/s1.jsonl",
		cwd: partial.cwd || "/repo",
		title: partial.title || "Session",
		label: partial.label || "#1",
		createdAt: partial.createdAt || "2026-09-24T10:00:00Z",
		updatedAt: partial.updatedAt || "2026-09-24T10:00:00Z",
		parentId: partial.parentId ?? null,
		forkDepth: partial.forkDepth || 0,
		status: partial.status || "idle",
		unread: partial.unread || false,
		pending: partial.pending ?? null,
		live: partial.live || false,
		externalPid: partial.externalPid ?? null,
		pinned: partial.pinned || false,
		archived: partial.archived || false,
		workspaceId: partial.workspaceId ?? null,
		repoRoot: partial.repoRoot ?? null,
		git: partial.git ?? null,
		result: partial.result ?? null,
		lastAssistant: partial.lastAssistant ?? null,
		model: partial.model ?? null,
	};
}

describe("matchesSearch & filterSessions", () => {
	it("filters out archived sessions when showArchived is false", () => {
		const s1 = makeSession({ id: "s1", archived: false });
		const s2 = makeSession({ id: "s2", archived: true });

		const result = filterSessions([s1, s2], { showArchived: false });
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe("s1");
	});

	it("includes archived sessions when showArchived is true", () => {
		const s1 = makeSession({ id: "s1", archived: false });
		const s2 = makeSession({ id: "s2", archived: true });

		const result = filterSessions([s1, s2], { showArchived: true });
		expect(result).toHaveLength(2);
	});

	it("matches search query across title, label, and branch", () => {
		const s1 = makeSession({ id: "s1", title: "Refactor sidebar", label: "#10" });
		const s2 = makeSession({
			id: "s2",
			title: "Other fix",
			label: "#11",
			git: { branch: "feature/auth", dirty: 0, worktree: null },
		});

		expect(matchesSearch(s1, "refactor")).toBe(true);
		expect(matchesSearch(s1, "#10")).toBe(true);
		expect(matchesSearch(s2, "auth")).toBe(true);
		expect(matchesSearch(s2, "nonexistent")).toBe(false);

		const filtered = filterSessions([s1, s2], { searchQuery: "auth" });
		expect(filtered).toHaveLength(1);
		expect(filtered[0].id).toBe("s2");
	});
});

describe("createSubgroups", () => {
	it("detects single subgroup when all sessions share the same branch", () => {
		const s1 = makeSession({ id: "s1", git: { branch: "main", dirty: 0, worktree: null } });
		const s2 = makeSession({ id: "s2", git: { branch: "main", dirty: 1, worktree: null } });

		const { subgroups, hasMultipleSubgroups } = createSubgroups([s1, s2]);
		expect(hasMultipleSubgroups).toBe(false);
		expect(subgroups).toHaveLength(1);
		expect(subgroups[0].label).toBe("main");
	});

	it("detects multiple subgroups when sessions span different branches or worktrees", () => {
		const s1 = makeSession({ id: "s1", git: { branch: "main", dirty: 0, worktree: null } });
		const s2 = makeSession({
			id: "s2",
			git: { branch: "feat", dirty: 0, worktree: "/repo/.worktrees/feat" },
		});

		const { subgroups, hasMultipleSubgroups } = createSubgroups([s1, s2]);
		expect(hasMultipleSubgroups).toBe(true);
		expect(subgroups.length).toBeGreaterThanOrEqual(2);
	});

	it("places pinned sessions before unpinned sessions within a subgroup", () => {
		const s1 = makeSession({ id: "s1", pinned: false, updatedAt: "2026-09-24T12:00:00Z" });
		const s2 = makeSession({ id: "s2", pinned: true, updatedAt: "2026-09-24T10:00:00Z" });

		const { subgroups } = createSubgroups([s1, s2]);
		expect(subgroups[0].sessions.map((s) => s.id)).toEqual(["s2", "s1"]);
	});

	it("lists fork sessions as flat rows ordered purely by updatedAt, not nested under parents", () => {
		const parent = makeSession({
			id: "p1",
			git: { branch: "main", dirty: 0, worktree: null },
			updatedAt: "2026-09-24T12:00:00Z",
		});
		const forkNewer = makeSession({
			id: "f-new",
			parentId: "p1",
			git: { branch: "main", dirty: 0, worktree: null },
			updatedAt: "2026-09-24T13:00:00Z",
		});
		const unrelated = makeSession({
			id: "u1",
			git: { branch: "main", dirty: 0, worktree: null },
			updatedAt: "2026-09-24T12:30:00Z",
		});
		const forkOlder = makeSession({
			id: "f-old",
			parentId: "p1",
			git: { branch: "main", dirty: 0, worktree: null },
			updatedAt: "2026-09-24T11:00:00Z",
		});

		const { subgroups } = createSubgroups([parent, forkNewer, unrelated, forkOlder]);
		expect(subgroups).toHaveLength(1);
		expect(subgroups[0].sessions.map((s) => s.id)).toEqual([
			"f-new", // fork newer than its parent sorts before it
			"u1",
			"p1",
			"f-old", // fork older than an unrelated session lands after it
		]);
	});
});

describe("createSubgroups", () => {
	it("detects single subgroup when all sessions share the same branch", () => {
		const s1 = makeSession({ id: "s1", git: { branch: "main", dirty: 0, worktree: null } });
		const s2 = makeSession({ id: "s2", git: { branch: "main", dirty: 1, worktree: null } });

		const { subgroups, hasMultipleSubgroups } = createSubgroups([s1, s2]);
		expect(hasMultipleSubgroups).toBe(false);
		expect(subgroups).toHaveLength(1);
		expect(subgroups[0].label).toBe("main");
	});

	it("detects multiple subgroups when sessions span different branches or worktrees", () => {
		const s1 = makeSession({ id: "s1", git: { branch: "main", dirty: 0, worktree: null } });
		const s2 = makeSession({
			id: "s2",
			git: { branch: "feat", dirty: 0, worktree: "/repo/.worktrees/feat" },
		});

		const { subgroups, hasMultipleSubgroups } = createSubgroups([s1, s2]);
		expect(hasMultipleSubgroups).toBe(true);
		expect(subgroups.length).toBeGreaterThanOrEqual(2);
	});
});

describe("groupSessions", () => {
	const globalWs: Workspace = {
		id: "global",
		name: "全局",
		path: "/home/.omp/global",
		kind: "global",
		sort: 0,
	};
	const projectWs: Workspace = {
		id: "proj1",
		name: "My Project",
		path: "/repo/my-proj",
		kind: "project",
		sort: 1,
	};

	it("pins the global workspace group on top and splits unassigned sessions", () => {
		const sGlobal = makeSession({
			id: "sg",
			workspaceId: "global",
			updatedAt: "2026-09-25T09:00:00Z",
		});
		const sProj = makeSession({
			id: "sp",
			workspaceId: "proj1",
			updatedAt: "2026-09-25T08:00:00Z",
		});
		const sUnassigned = makeSession({
			id: "su",
			workspaceId: null,
			cwd: "/random/dir",
			updatedAt: "2026-09-24T10:00:00Z",
		});

		const result = groupSessions([sGlobal, sProj, sUnassigned], [projectWs, globalWs]);

		// Global workspace sessions land in the pinned global group (PLAN §67).
		expect(result.globalGroup?.workspace.id).toBe("global");
		expect(result.globalGroup?.totalCount).toBe(1);
		expect(result.globalGroup?.subgroups[0]?.sessions[0].id).toBe("sg");

		// Unassigned bucket = sessions with no workspace at all.
		expect(result.unassigned.map((s) => s.id)).toEqual(["su"]);

		expect(result.workspaceGroups).toHaveLength(1);
		expect(result.workspaceGroups[0].workspace.id).toBe("proj1");
		expect(result.workspaceGroups[0].totalCount).toBe(1);
		expect(result.totalVisible).toBe(3);
	});

	it("routes unassigned deleted-worktree sessions into the deleted bucket", () => {
		const dead = makeSession({
			id: "dead",
			workspaceId: null,
			cwd: "/repo/.cache/wt-dead",
			git: null,
		});
		const alive = makeSession({
			id: "alive",
			workspaceId: null,
			cwd: "/repo",
			git: { branch: "main", dirty: 0, worktree: null },
		});

		// Deleted-worktree sessions are always included now.
		const result = groupSessions([dead, alive], []);
		expect(result.unassigned.map((s) => s.id)).toEqual(["alive"]);
		expect(result.deletedSessions.map((s) => s.id)).toEqual(["dead"]);
	});

	it("orders unassigned newest-first regardless of count", () => {
		const many = Array.from({ length: 15 }, (_, i) =>
			makeSession({
				id: `s${i}`,
				workspaceId: null,
				updatedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
			}),
		);
		const result = groupSessions(many, []);
		expect(result.unassigned).toHaveLength(15);
		expect(result.unassigned[0].id).toBe("s14"); // newest first
		expect(result.unassigned[14].id).toBe("s0");
	});
	it("extracts all pinned sessions into pinnedSessions at top-level", () => {
		const p1 = makeSession({ id: "p1", pinned: true, updatedAt: "2026-09-25T10:00:00Z" });
		const u1 = makeSession({ id: "u1", pinned: false, updatedAt: "2026-09-25T09:00:00Z" });
		const p2 = makeSession({ id: "p2", pinned: true, updatedAt: "2026-09-25T11:00:00Z" });
		const result = groupSessions([p1, u1, p2], []);
		expect(result.pinnedSessions.map((s) => s.id)).toEqual(["p2", "p1"]);
		expect(result.unassigned.map((s) => s.id)).toEqual(["u1"]);
		expect(result.totalVisible).toBe(3);
	});

	it("renders pinned sessions only once across workspace groups", () => {
		const pinnedProject = makeSession({ id: "project", pinned: true, workspaceId: "proj1" });
		const pinnedGlobal = makeSession({ id: "global", pinned: true, workspaceId: "global" });
		const unpinned = makeSession({ id: "normal", workspaceId: "proj1" });
		const result = groupSessions([pinnedProject, pinnedGlobal, unpinned], [projectWs, globalWs]);
		expect(result.pinnedSessions.map((s) => s.id)).toEqual(["project", "global"]);
		expect(result.workspaceGroups[0].subgroups.flatMap((s) => s.sessions.map((x) => x.id))).toEqual(["normal"]);
		expect(result.workspaceGroups[0].totalCount).toBe(1);
		expect(result.globalGroup?.totalCount).toBe(0);
	});

	it("filters by activeWorkspaceId to isolate a single project", () => {
		const p1 = makeSession({ id: "p1", workspaceId: "proj1", pinned: true });
		const s1 = makeSession({ id: "s1", workspaceId: "proj1" });
		const p2 = makeSession({ id: "p2", workspaceId: "global", pinned: true });
		const s2 = makeSession({ id: "s2", workspaceId: "global" });
		const s3 = makeSession({ id: "s3", workspaceId: null });

		const result = groupSessions([p1, s1, p2, s2, s3], [projectWs, globalWs], {
			activeWorkspaceId: "proj1",
		});
		expect(result.workspaceGroups).toHaveLength(1);
		expect(result.workspaceGroups[0].workspace.id).toBe("proj1");
		expect(result.workspaceGroups[0].totalCount).toBe(1);
		expect(result.pinnedSessions.map((s) => s.id)).toEqual(["p1"]);
		expect(result.globalGroup).toBeNull();
		expect(result.unassigned).toHaveLength(0);
		expect(result.totalVisible).toBe(2); // p1 + s1
	});

	it("filters by activeWorkspaceId '__global' to isolate global sessions", () => {
		const p1 = makeSession({ id: "p1", workspaceId: "proj1", pinned: true });
		const s1 = makeSession({ id: "s1", workspaceId: "proj1" });
		const s2 = makeSession({ id: "s2", workspaceId: "global" });

		const result = groupSessions([p1, s1, s2], [projectWs, globalWs], {
			activeWorkspaceId: "__global",
		});
		expect(result.workspaceGroups).toHaveLength(0);
		expect(result.globalGroup?.totalCount).toBe(1);
		expect(result.pinnedSessions).toHaveLength(0);
		expect(result.totalVisible).toBe(1);
	});

	it("keeps all workspaces when activeWorkspaceId is 'all'", () => {
		const s1 = makeSession({ id: "s1", workspaceId: "proj1" });
		const s2 = makeSession({ id: "s2", workspaceId: "global" });

		const result = groupSessions([s1, s2], [projectWs, globalWs], {
			activeWorkspaceId: "all",
		});
		expect(result.workspaceGroups).toHaveLength(1);
		expect(result.globalGroup?.totalCount).toBe(1);
		expect(result.totalVisible).toBe(2);
	});
});


describe("inferWorktreeName & deleted-worktree grouping", () => {
	it("recovers names from .worktrees and .cache/wt- paths", () => {
		expect(inferWorktreeName("/repo/.worktrees/wt-layout")).toBe("wt-layout");
		expect(
			inferWorktreeName("/repo/.cache/wt-export/sub/dir"),
		).toBe("wt-export");
		expect(inferWorktreeName("/repo/src")).toBeNull();
	});

	it("groups sessions without git badge by inferred worktree", () => {
		const wt = makeSession({
			id: "wt",
			cwd: "/repo/.cache/wt-layout",
			git: null,
		});
		const main = makeSession({ id: "main", cwd: "/repo", git: null });

		const { subgroups, hasMultipleSubgroups } = createSubgroups([wt, main]);
		// Deleted groups render in a separate folder and don't count for
		// hasMultipleSubgroups.
		expect(hasMultipleSubgroups).toBe(false);
		const labels = subgroups.map((s) => s.label).sort();
		expect(labels).toEqual(["wt-layout", "其他"]);
		expect(subgroups.find((s) => s.label === "wt-layout")?.deleted).toBe(true);
	});
});

describe("worktree list grouping", () => {
	const ws: Workspace = {
		id: "proj1",
		name: "My Project",
		path: "/repo/my-proj",
		kind: "project",
		sort: 1,
	};
	const worktrees = [
		{ path: "/repo/my-proj", branch: "main", head: "aaa", dirty: 0, sessionIds: [] },
		{ path: "/repo/my-proj/.worktrees/feat-a", branch: "feat-a", head: "bbb", dirty: 0, sessionIds: [] },
		{ path: "/repo/my-proj/.worktrees/feat-b", branch: "feat-b", head: "ccc", dirty: 0, sessionIds: [] },
		{ path: "/repo/my-proj/.worktrees/x", branch: null, head: "ddd", dirty: 0, sessionIds: [] },
	];

	it("yields a subgroup per live worktree, main first, empties included", () => {
		const s = makeSession({
			id: "s1",
			workspaceId: "proj1",
			cwd: "/repo/my-proj",
		});
		const result = groupSessions([s], [ws], { worktrees: { proj1: worktrees } });
		const wg = result.workspaceGroups[0];
		expect(wg.subgroups.map((g) => g.label)).toEqual([
			"main",
			"feat-a",
			"feat-b",
			"x",
		]);
		expect(wg.subgroups[0].isMain).toBe(true);
		expect(wg.subgroups[0].createCwd).toBe("/repo/my-proj");
		// Branch-less worktree falls back to its dir basename.
		expect(wg.subgroups[3].path).toBe("/repo/my-proj/.worktrees/x");
		expect(wg.subgroups[3].sessions).toHaveLength(0);
		expect(wg.subgroups[3].totalCount).toBe(0);
	});

	it("assigns sessions by deepest cwd containment", () => {
		const s = makeSession({
			id: "s1",
			workspaceId: "proj1",
			cwd: "/repo/my-proj/.worktrees/x/sub",
		});
		const result = groupSessions([s], [ws], { worktrees: { proj1: worktrees } });
		const wg = result.workspaceGroups[0];
		const x = wg.subgroups.find((g) => g.path === "/repo/my-proj/.worktrees/x");
		expect(x?.sessions.map((v) => v.id)).toEqual(["s1"]);
		expect(wg.subgroups[0].sessions).toHaveLength(0); // main does not claim it
	});

	it("keeps deleted-worktree sessions out of the main checkout group", () => {
		const dead = makeSession({
			id: "dead",
			workspaceId: "proj1",
			cwd: "/repo/my-proj/.worktrees/gone",
			git: null,
		});
		const result = groupSessions([dead], [ws], { worktrees: { proj1: worktrees } });
		const wg = result.workspaceGroups[0];
		expect(wg.subgroups[0].sessions).toHaveLength(0);
		expect(wg.deletedSubgroups.map((g) => g.label)).toEqual(["gone"]);
		expect(wg.deletedSubgroups[0].deleted).toBe(true);
		expect(wg.totalCount).toBe(1); // counts include deleted subgroups
	});

	it("separates deleted subgroups from live subgroups", () => {
		const live = makeSession({
			id: "live",
			workspaceId: "proj1",
			cwd: "/repo/my-proj",
		});
		const dead = makeSession({
			id: "dead",
			workspaceId: "proj1",
			cwd: "/repo/my-proj/.worktrees/gone",
			git: null,
		});
		const result = groupSessions([live, dead], [ws], {
			worktrees: { proj1: worktrees },
		});
		const wg = result.workspaceGroups[0];
		expect(wg.subgroups.every((g) => !g.deleted)).toBe(true);
		expect(wg.deletedSubgroups).toHaveLength(1);
		expect(wg.hasMultipleSubgroups).toBe(true); // 4 live worktrees listed
	});

	it("drops empty subgroups while searching", () => {
		const s = makeSession({
			id: "s1",
			workspaceId: "proj1",
			cwd: "/repo/my-proj",
			title: "needle",
		});
		const result = groupSessions([s], [ws], {
			worktrees: { proj1: worktrees },
			searchQuery: "needle",
		});
		const wg = result.workspaceGroups[0];
		expect(wg.subgroups.map((g) => g.label)).toEqual(["main"]);
		expect(wg.hasMultipleSubgroups).toBe(false);
	});
});

describe("filterSessions deleted worktrees", () => {
	it("always includes deleted-worktree sessions", () => {
		const dead = makeSession({
			id: "dead",
			cwd: "/repo/.cache/wt-layout",
			git: null,
		});
		const alive = makeSession({ id: "alive", cwd: "/repo", git: null });

		const shown = filterSessions([dead, alive]);
		expect(shown.map((s) => s.id)).toEqual(["dead", "alive"]);
	});
});


describe("archive cascading & pinning", () => {
	it("cascades archive status to children when showArchived is false", () => {
		const parent = makeSession({ id: "p1", archived: true });
		const child = makeSession({ id: "c1", parentId: "p1", archived: false });
		const normal = makeSession({ id: "n1", archived: false });

		const hidden = filterSessions([parent, child, normal], { showArchived: false });
		expect(hidden.map((s) => s.id)).toEqual(["n1"]);

		const shown = filterSessions([parent, child, normal], { showArchived: true });
		expect(shown.map((s) => s.id)).toEqual(["p1", "c1", "n1"]);
	});

	it("pins only the parent itself, leaving its child in the workspace subgroup", () => {
		const parent = makeSession({ id: "p1", pinned: true, workspaceId: "proj1" });
		const child = makeSession({
			id: "c1",
			parentId: "p1",
			pinned: false,
			workspaceId: "proj1",
			updatedAt: "2026-09-24T11:00:00Z",
		});
		const normal = makeSession({
			id: "n1",
			pinned: false,
			workspaceId: "proj1",
			updatedAt: "2026-09-24T10:00:00Z",
		});

		const ws: Workspace = { id: "proj1", name: "P1", path: "/p1", kind: "project", sort: 0 };
		const result = groupSessions([parent, child, normal], [ws]);

		expect(result.pinnedSessions.map((s) => s.id)).toEqual(["p1"]);
		expect(
			result.workspaceGroups[0].subgroups.flatMap((s) => s.sessions.map((x) => x.id)),
		).toEqual(["c1", "n1"]);
	});

	it("pins only the child itself, leaving its parent in the workspace subgroup", () => {
		const parent = makeSession({
			id: "p1",
			pinned: false,
			workspaceId: "proj1",
			updatedAt: "2026-09-24T11:00:00Z",
		});
		const child = makeSession({ id: "c1", parentId: "p1", pinned: true, workspaceId: "proj1" });
		const normal = makeSession({
			id: "n1",
			pinned: false,
			workspaceId: "proj1",
			updatedAt: "2026-09-24T10:00:00Z",
		});

		const ws: Workspace = { id: "proj1", name: "P1", path: "/p1", kind: "project", sort: 0 };
		const result = groupSessions([parent, child, normal], [ws]);

		expect(result.pinnedSessions.map((s) => s.id)).toEqual(["c1"]);
		expect(
			result.workspaceGroups[0].subgroups.flatMap((s) => s.sessions.map((x) => x.id)),
		).toEqual(["p1", "n1"]);
	});
});
