import { describe, expect, it } from "vitest";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import {
	buildSessionTree,
	createSubgroups,
	filterSessions,
	flattenSessionTree,
	groupSessions,
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

describe("buildSessionTree & pinned sorting", () => {
	it("places pinned sessions before unpinned sessions at the root level", () => {
		const s1 = makeSession({ id: "s1", pinned: false, updatedAt: "2026-09-24T12:00:00Z" });
		const s2 = makeSession({ id: "s2", pinned: true, updatedAt: "2026-09-24T10:00:00Z" });

		const tree = buildSessionTree([s1, s2]);
		expect(tree[0].session.id).toBe("s2");
		expect(tree[1].session.id).toBe("s1");
	});

	it("nests side chats under parent and clamps depth to max 3", () => {
		const root = makeSession({ id: "s0", label: "#0" });
		const c1 = makeSession({ id: "s1", parentId: "s0", label: "#0.1" });
		const c2 = makeSession({ id: "s2", parentId: "s1", label: "#0.1.1" });
		const c3 = makeSession({ id: "s3", parentId: "s2", label: "#0.1.1.1" });
		const c4 = makeSession({ id: "s4", parentId: "s3", label: "#0.1.1.1.1" }); // deep fork

		const tree = buildSessionTree([root, c1, c2, c3, c4]);
		expect(tree).toHaveLength(1);
		expect(tree[0].session.id).toBe("s0");
		expect(tree[0].depth).toBe(0);

		const nodeC1 = tree[0].children[0];
		expect(nodeC1.session.id).toBe("s1");
		expect(nodeC1.depth).toBe(1);

		const nodeC2 = nodeC1.children[0];
		expect(nodeC2.session.id).toBe("s2");
		expect(nodeC2.depth).toBe(2);

		const nodeC3 = nodeC2.children[0];
		expect(nodeC3.session.id).toBe("s3");
		expect(nodeC3.depth).toBe(3);

		const nodeC4 = nodeC3.children[0];
		expect(nodeC4.session.id).toBe("s4");
		// Clamped to 3
		expect(nodeC4.depth).toBe(3);
	});

	it("flattens tree preserving parent-child order", () => {
		const parent = makeSession({ id: "p1" });
		const child = makeSession({ id: "c1", parentId: "p1" });

		const tree = buildSessionTree([parent, child]);
		const flat = flattenSessionTree(tree);
		expect(flat.map((n) => n.session.id)).toEqual(["p1", "c1"]);
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

	it("keeps global workspace fixed on top", () => {
		const sGlobal = makeSession({ id: "sg", workspaceId: "global" });
		const sProj = makeSession({ id: "sp", workspaceId: "proj1" });
		const sUnassigned = makeSession({ id: "su", workspaceId: null, cwd: "/random/dir" });

		const result = groupSessions([sGlobal, sProj, sUnassigned], [projectWs, globalWs]);

		expect(result.globalGroup).not.toBeNull();
		expect(result.globalGroup?.isGlobal).toBe(true);
		expect(result.globalGroup?.totalCount).toBe(1);

		expect(result.workspaceGroups).toHaveLength(1);
		expect(result.workspaceGroups[0].workspace.id).toBe("proj1");
		expect(result.workspaceGroups[0].totalCount).toBe(1);

		expect(result.unassignedGroup.totalCount).toBe(1);
		expect(result.unassignedGroup.cwdGroups[0].cwd).toBe("/random/dir");
	});

	it("creates a fallback global group if none exists in workspaces list", () => {
		const result = groupSessions([], [projectWs]);
		expect(result.globalGroup).not.toBeNull();
		expect(result.globalGroup?.isGlobal).toBe(true);
		expect(result.globalGroup?.workspace.id).toBe("global");
	});
});
