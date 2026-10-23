import { describe, expect, it } from "vitest";
import type { SessionMeta, Workspace } from "../../lib/contracts";
import {
	DELETED_LABEL,
	UNASSIGNED_LABEL,
	createSubgroups,
	filterSessions,
	groupSessions,
	inferWorktreeName,
	matchesSearch,
	needsAttention,
	nestSideChats,
	snapshotOrder,
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
		attention: null,
		mode: partial.mode ?? "code",
		groupId: partial.groupId ?? null,
		kind: partial.kind ?? null,
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
	});
});

describe("side-chat visibility (first user message)", () => {
	const parent = () => makeSession({ id: "p1", updatedAt: "2026-09-24T10:00:00Z" });

	it("lists a fork once it carries content: flat row sorted by updatedAt", () => {
		const sent = makeSession({
			id: "f1",
			parentId: "p1",
			title: "什么是闭包",
			label: "#1.1",
			forkDepth: 1,
			updatedAt: "2026-09-24T12:00:00Z",
		});
		expect(filterSessions([parent(), sent]).map((s) => s.id)).toEqual(["p1", "f1"]);
		const res = groupSessions([parent(), sent], []);
		expect(res.unassigned.map((s) => s.id)).toEqual(["f1", "p1"]);
	});

	it("keeps an unsent fork stub (no title/label/activity) out of every list", () => {
		// makeSession coalesces "" to defaults; blank fields need a spread override.
		const stub = {
			...makeSession({ id: "f-empty", parentId: "p1", forkDepth: 1, live: true }),
			title: "",
			label: "",
		};
		expect(filterSessions([parent(), stub]).map((s) => s.id)).toEqual(["p1"]);
		const res = groupSessions([parent(), stub], []);
		expect(res.unassigned.map((s) => s.id)).toEqual(["p1"]);
		expect(res.totalVisible).toBe(1);
	});

	it("keeps a fork the moment a turn is in flight even before titles resolve", () => {
		const working = {
			...makeSession({
				id: "f-working",
				parentId: "p1",
				status: "working",
				live: true,
			}),
			title: "",
			label: "",
		};
		expect(filterSessions([parent(), working]).map((s) => s.id)).toEqual([
			"p1",
			"f-working",
		]);
	});

	it("does not hide blank non-fork drafts (main composer governs those)", () => {
		const draft = { ...makeSession({ id: "draft" }), title: "", label: "" };
		expect(filterSessions([parent(), draft]).map((s) => s.id)).toEqual([
			"p1",
			"draft",
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


describe("groupSessions", () => {
	const globalWs: Workspace = {
		id: "global",
		name: "全局",
		path: "/home/.omp/global",
		kind: "global",
		sort: 0,
		mode: "code",
	};
	const projectWs: Workspace = {
		id: "proj1",
		name: "My Project",
		path: "/repo/my-proj",
		kind: "project",
		sort: 1,
		mode: "code",
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

	it("groups only the active mode's sessions and workspaces", () => {
		const p1 = makeSession({ id: "p1", workspaceId: "proj1", pinned: true });
		const s1 = makeSession({ id: "s1", workspaceId: "proj1" });
		const p2 = makeSession({ id: "p2", workspaceId: "global", pinned: true });
		const s2 = makeSession({ id: "s2", workspaceId: "global" });
		const s3 = makeSession({ id: "s3", workspaceId: null });

		const result = groupSessions([p1, s1, p2, s2, s3], [projectWs, globalWs], {
			mode: "code",
		});
		expect(result.workspaceGroups).toHaveLength(1);
		expect(result.workspaceGroups[0].workspace.id).toBe("proj1");
		expect(result.workspaceGroups[0].totalCount).toBe(1);
		expect(result.pinnedSessions.map((s) => s.id)).toEqual(["p1", "p2"]);
		expect(result.globalGroup?.totalCount).toBe(1);
		expect(result.unassigned).toHaveLength(1);
		expect(result.totalVisible).toBe(5);
	});

	it("hides other modes' sessions and workspaces entirely", () => {
		const workGlobal: Workspace = {
			id: "global:work",
			name: "全局",
			path: "/spaces/work/global",
			kind: "global",
			sort: 0,
			mode: "work",
		};
		const workProj: Workspace = {
			id: "wproj",
			name: "Work Proj",
			path: "/work/proj",
			kind: "project",
			sort: 1,
			mode: "work",
		};
		const codeSession = makeSession({ id: "c1", workspaceId: "proj1" });
		const workSession = makeSession({
			id: "w1",
			workspaceId: "wproj",
			mode: "work",
		});
		const workGlobalSession = makeSession({
			id: "wg1",
			workspaceId: "global:work",
			mode: "work",
		});

		// The work space sees only its own sessions; the code project never claims them.
		const workView = groupSessions(
			[codeSession, workSession, workGlobalSession],
			[projectWs, globalWs, workProj, workGlobal],
			{ mode: "work" },
		);
		expect(workView.workspaceGroups.map((g) => g.workspace.id)).toEqual(["wproj"]);
		expect(workView.globalGroup?.workspace.id).toBe("global:work");
		expect(workView.globalGroup?.totalCount).toBe(1);
		expect(workView.unassigned).toHaveLength(0);
		expect(workView.totalVisible).toBe(2);

		// The code space sees only its own session; the work project never claims it.
		const codeView = groupSessions(
			[codeSession, workSession, workGlobalSession],
			[projectWs, globalWs, workProj, workGlobal],
			{ mode: "code" },
		);
		expect(codeView.workspaceGroups.map((g) => g.workspace.id)).toEqual(["proj1"]);
		expect(codeView.globalGroup?.totalCount).toBe(0);
		expect(codeView.totalVisible).toBe(1);
	});

	it("defaults to the code space when no mode is given", () => {
		const codeSession = makeSession({ id: "c1", workspaceId: "proj1" });
		const workSession = makeSession({
			id: "w1",
			workspaceId: "proj1",
			mode: "work",
		});
		const result = groupSessions([codeSession, workSession], [projectWs, globalWs]);
		expect(result.workspaceGroups[0].totalCount).toBe(1);
		expect(result.workspaceGroups[0].subgroups[0].sessions.map((s) => s.id)).toEqual([
			"c1",
		]);
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
		mode: "code",
	};
	const worktrees = [
		{ path: "/repo/my-proj", branch: "main", head: "aaa", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		{ path: "/repo/my-proj/.worktrees/feat-a", branch: "feat-a", head: "bbb", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		{ path: "/repo/my-proj/.worktrees/feat-b", branch: "feat-b", head: "ccc", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		{ path: "/repo/my-proj/.worktrees/x", branch: null, head: "ddd", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
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
});

describe("groupByWorktree option", () => {
	const ws: Workspace = { id: "proj1", name: "My Project", path: "/repo/my-proj", kind: "project", sort: 1, mode: "code" };
	const wts = [
		{ path: "/repo/my-proj", branch: "main", head: "a", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		{ path: "/repo/my-proj/.worktrees/feat-a", branch: "feat-a", head: "b", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
	];
	const sessions = [
		makeSession({ id: "m", workspaceId: "proj1", cwd: "/repo/my-proj" }),
		makeSession({ id: "a", workspaceId: "proj1", cwd: "/repo/my-proj/.worktrees/feat-a" }),
		makeSession({ id: "dead", workspaceId: "proj1", cwd: "/repo/my-proj/.worktrees/gone", git: null }),
	];

	it("false: one flat main subgroup, no deleted subgroups", () => {
		const res = groupSessions(sessions, [ws], { worktrees: { proj1: wts }, groupByWorktree: false });
		const wg = res.workspaceGroups[0];
		expect(wg.subgroups).toHaveLength(1);
		expect(wg.subgroups[0].kind).toBe("default");
		expect(wg.subgroups[0].isMain).toBe(true);
		expect(wg.subgroups[0].sessions.map((s) => s.id).sort()).toEqual(["a", "dead", "m"]);
		expect(wg.hasMultipleSubgroups).toBe(false);
		expect(wg.deletedSubgroups).toHaveLength(0);
		expect(wg.totalCount).toBe(3);
	});

	it("false: deleted-worktree unassigned sessions join the normal list", () => {
		const dead = makeSession({ id: "d", workspaceId: null, cwd: "/repo/.cache/wt-dead", git: null });
		const res = groupSessions([dead], [ws], { groupByWorktree: false });
		expect(res.deletedSessions).toHaveLength(0);
		expect(res.unassigned.map((s) => s.id)).toEqual(["d"]);
		expect(res.totalVisible).toBe(1);
	});

	it("default and true keep worktree grouping", () => {
		const a = groupSessions(sessions, [ws], { worktrees: { proj1: wts } });
		const b = groupSessions(sessions, [ws], { worktrees: { proj1: wts }, groupByWorktree: true });
		expect(a).toEqual(b);
		expect(a.workspaceGroups[0].subgroups.map((g) => g.label)).toEqual(["main", "feat-a"]);
		expect(a.workspaceGroups[0].deletedSubgroups).toHaveLength(1);
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

		const ws: Workspace = { id: "proj1", name: "P1", path: "/p1", kind: "project", sort: 0, mode: "code" };
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

		const ws: Workspace = { id: "proj1", name: "P1", path: "/p1", kind: "project", sort: 0, mode: "code" };
		const result = groupSessions([parent, child, normal], [ws]);

		expect(result.pinnedSessions.map((s) => s.id)).toEqual(["c1"]);
		expect(
			result.workspaceGroups[0].subgroups.flatMap((s) => s.sessions.map((x) => x.id)),
		).toEqual(["p1", "n1"]);
	});
});

describe("needsAttention", () => {
	it("returns true only for statuses that need the user now", () => {
		expect(needsAttention(makeSession({ status: "working" }))).toBe(true);
		expect(needsAttention(makeSession({ status: "awaiting_approval" }))).toBe(true);
		expect(needsAttention(makeSession({ status: "awaiting_answer" }))).toBe(true);
		// review/error/interrupted/unread are not sticky: they keep their dot
		// and collapsed-group bubble but stay folded by paging.
		expect(needsAttention(makeSession({ status: "review", unread: false }))).toBe(false);
		expect(needsAttention(makeSession({ status: "error", unread: false }))).toBe(false);
		expect(needsAttention(makeSession({ status: "interrupted", unread: false }))).toBe(false);
		expect(needsAttention(makeSession({ status: "idle", unread: true }))).toBe(false);
		expect(needsAttention(makeSession({ status: "idle", unread: false }))).toBe(false);
	});
});

describe("snapshotOrder & frozenOrder", () => {
	it("records snapshotOrder across all lists in render order", () => {
		const p1 = makeSession({ id: "p1", pinned: true, updatedAt: "2026-09-25T12:00:00Z" });
		const g1 = makeSession({ id: "g1", workspaceId: "global", updatedAt: "2026-09-25T11:00:00Z" });
		const s1 = makeSession({ id: "s1", workspaceId: "proj1", updatedAt: "2026-09-25T10:00:00Z" });
		const u1 = makeSession({ id: "u1", workspaceId: null, updatedAt: "2026-09-25T09:00:00Z" });
		const d1 = makeSession({ id: "d1", workspaceId: null, cwd: "/repo/.cache/wt-dead", git: null });

		const wsG: Workspace = { id: "global", name: "Global", path: "/global", kind: "global", sort: 0, mode: "code" };
		const wsP: Workspace = { id: "proj1", name: "P1", path: "/p1", kind: "project", sort: 1, mode: "code" };

		const res = groupSessions([p1, g1, s1, u1, d1], [wsG, wsP]);
		const order = snapshotOrder(res);

		expect(order.get("p1")).toBe(0);
		expect(order.get("g1")).toBe(1);
		expect(order.get("s1")).toBe(2);
		expect(order.get("u1")).toBe(3);
		expect(order.get("d1")).toBe(4);
	});

	it("preserves rank for existing ids while placing new ids on top by updatedAt desc and keeping pinned first", () => {
		// Existing sessions: s1 (rank 0), s2 (rank 1), s3 (rank 2)
		const frozenOrder = new Map([
			["s1", 0],
			["s2", 1],
			["s3", 2],
		]);

		// New session s_new has newer timestamp than s1
		const sNew = makeSession({ id: "s_new", workspaceId: "proj1", updatedAt: "2026-09-25T15:00:00Z" });
		// s2 received an update making it newer than s1, but frozenOrder should preserve its rank after s1
		const s2Updated = makeSession({ id: "s2", workspaceId: "proj1", updatedAt: "2026-09-25T14:00:00Z" });
		const s1 = makeSession({ id: "s1", workspaceId: "proj1", updatedAt: "2026-09-25T10:00:00Z" });
		const s3 = makeSession({ id: "s3", workspaceId: "proj1", updatedAt: "2026-09-25T08:00:00Z" });
		const pNew = makeSession({ id: "p_new", pinned: true, workspaceId: "proj1", updatedAt: "2026-09-25T16:00:00Z" });

		const ws: Workspace = { id: "proj1", name: "P1", path: "/p1", kind: "project", sort: 0, mode: "code" };
		const res = groupSessions([s1, s2Updated, s3, sNew, pNew], [ws], { frozenOrder });

		expect(res.pinnedSessions.map((s) => s.id)).toEqual(["p_new"]);
		// In proj1: new session on top, then existing in rank order s1, s2, s3
		const projSessions = res.workspaceGroups[0].subgroups[0].sessions.map((s) => s.id);
		expect(projSessions).toEqual(["s_new", "s1", "s2", "s3"]);
	});
});

describe("global-id filter mode (G1 backstop)", () => {
	it("keeps per-mode global rows separate by id and mode", () => {
		const wsG: Workspace = { id: "global", name: "Global", path: "/global", kind: "global", sort: 0, mode: "code" };
		const wsP: Workspace = { id: "proj1", name: "P1", path: "/p1", kind: "project", sort: 1, mode: "code" };

		const g1 = makeSession({ id: "g1", workspaceId: "global" });
		const p1 = makeSession({ id: "p1", workspaceId: "proj1" });

		const res = groupSessions([g1, p1], [wsG, wsP], { mode: "code" });

		expect(res.globalGroup?.workspace.id).toBe("global");
		expect(res.globalGroup?.subgroups[0]?.sessions.map((s) => s.id)).toEqual(["g1"]);
		expect(res.workspaceGroups.map((w) => w.workspace.id)).toEqual(["proj1"]);
		expect(res.totalVisible).toBe(2);
	});
});

describe("pinnedCount under filters", () => {
	it("counts pinned sessions belonging to the workspace after filters", () => {
		const ws: Workspace = { id: "proj1", name: "P1", path: "/p1", kind: "project", sort: 0, mode: "code" };
		const p1 = makeSession({ id: "p1", pinned: true, workspaceId: "proj1" });
		const p2 = makeSession({ id: "p2", pinned: true, archived: true, workspaceId: "proj1" });
		const s1 = makeSession({ id: "s1", pinned: false, workspaceId: "proj1" });
		const s2 = makeSession({ id: "s2", pinned: false, archived: true, workspaceId: "proj1" });

		const res = groupSessions([p1, p2, s1, s2], [ws], {});
		const wg = res.workspaceGroups[0];
		expect(wg.pinnedCount).toBe(1); // p2 is archived and hidden
		expect(wg.totalCount).toBe(1); // s2 is archived and hidden
		expect(res.pinnedSessions.map((s) => s.id)).toEqual(["p1"]);
	});
});

describe("canonical path containment & sessionIds attachment (G8)", () => {
	it("attaches session to worktree when cwd has /tmp vs /private/tmp", () => {
		const ws: Workspace = { id: "proj1", name: "P1", path: "/tmp/proj", kind: "project", sort: 0, mode: "code" };
		const worktrees = [
			{ path: "/private/tmp/proj", branch: "main", head: "aaa", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
			{ path: "/private/tmp/proj/.worktrees/feat", branch: "feat", head: "bbb", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		];

		const s1 = makeSession({ id: "s1", workspaceId: "proj1", cwd: "/tmp/proj" });
		const s2 = makeSession({ id: "s2", workspaceId: "proj1", cwd: "/tmp/proj/.worktrees/feat" });

		const res = groupSessions([s1, s2], [ws], { worktrees: { proj1: worktrees } });
		const wg = res.workspaceGroups[0];

		// Does not create duplicate fallback buckets
		expect(wg.subgroups.map((g) => g.label)).toEqual(["main", "feat"]);
		expect(wg.subgroups.find((g) => g.label === "main")?.sessions.map((s) => s.id)).toEqual(["s1"]);
		expect(wg.subgroups.find((g) => g.label === "feat")?.sessions.map((s) => s.id)).toEqual(["s2"]);
	});

	it("attaches session directly via WorktreeInfo.sessionIds first", () => {
		const ws: Workspace = { id: "proj1", name: "P1", path: "/proj", kind: "project", sort: 0, mode: "code" };
		const worktrees = [
			{ path: "/proj", branch: "main", head: "aaa", dirty: 0, sessionIds: ["s_in_custom"], ahead: 0, behind: 0 },
			{ path: "/proj/.worktrees/custom", branch: "custom", head: "bbb", dirty: 0, sessionIds: ["s_in_custom"], ahead: 0, behind: 0 },
		];

		const sCustom = makeSession({ id: "s_in_custom", workspaceId: "proj1", cwd: "/weird/non-nested/path" });
		const res = groupSessions([sCustom], [ws], { worktrees: { proj1: worktrees } });
		const wg = res.workspaceGroups[0];

		const customSub = wg.subgroups.find((g) => g.label === "custom");
		expect(customSub?.sessions.map((s) => s.id)).toEqual(["s_in_custom"]);
	});
});

describe("stale-badge deleted inference (G9)", () => {
	it("treats cwd in wt-dir as deleted when missing from non-empty live worktree list", () => {
		const ws: Workspace = { id: "proj1", name: "P1", path: "/repo", kind: "project", sort: 0, mode: "code" };
		const worktrees = [
			{ path: "/repo", branch: "main", head: "aaa", dirty: 0, sessionIds: [], ahead: 0, behind: 0 },
		];

		// Session has stale git badge pointing to wt-removed which no longer exists in live worktrees
		const s = makeSession({
			id: "s1",
			workspaceId: "proj1",
			cwd: "/repo/.worktrees/wt-removed",
			git: { branch: "omp/removed", worktree: "wt-removed", dirty: 0 },
		});

		const res = groupSessions([s], [ws], { worktrees: { proj1: worktrees } });
		const wg = res.workspaceGroups[0];
		expect(wg.deletedSubgroups).toHaveLength(1);
		expect(wg.deletedSubgroups[0].label).toBe("wt-removed");
		expect(wg.deletedSubgroups[0].deleted).toBe(true);
	});
});

describe("multi-token search without absolute prefix (G10)", () => {
	it("matches tokens with AND logic and never matches home dir prefix", () => {
		const s = makeSession({
			id: "s1",
			title: "Fix the sidebar layout",
			cwd: "/Users/me/Documents/omp-workspace",
			workspaceId: "proj1",
		});
		const ws: Workspace = {
			id: "proj1",
			name: "omp-workspace",
			path: "/Users/me/Documents/omp-workspace",
			kind: "project",
			sort: 0,
			mode: "code",
		};

		// "sidebar fix" matches both tokens in title
		expect(matchesSearch(s, "sidebar fix", ws.path)).toBe(true);
		// "doc" or "me" or "user" does not match the parent directory
		expect(matchesSearch(s, "doc", ws.path)).toBe(false);
		expect(matchesSearch(s, "me", ws.path)).toBe(false);
		expect(matchesSearch(s, "user", ws.path)).toBe(false);
		// "workspace" matches basename of workspace cwd
		expect(matchesSearch(s, "workspace", ws.path)).toBe(true);
	});
});

describe("archive cascade exemption (G13)", () => {
	it("never hides a child that is live, pinned, pending, working or awaiting", () => {
		const parent = makeSession({ id: "p1", archived: true });
		const liveChild = makeSession({ id: "c_live", parentId: "p1", live: true, archived: false });
		const pinnedChild = makeSession({ id: "c_pinned", parentId: "p1", pinned: true, archived: false });
		const pendingChild = makeSession({ id: "c_pending", parentId: "p1", pending: "approval", archived: false });
		const workingChild = makeSession({ id: "c_working", parentId: "p1", status: "working", archived: false });
		const awaitingChild = makeSession({ id: "c_awaiting", parentId: "p1", status: "awaiting_approval", archived: false });
		const idleChild = makeSession({ id: "c_idle", parentId: "p1", status: "idle", archived: false });

		const filtered = filterSessions(
			[parent, liveChild, pinnedChild, pendingChild, workingChild, awaitingChild, idleChild],
			{ showArchived: false },
		);

		const keptIds = filtered.map((s) => s.id);
		expect(keptIds).toContain("c_live");
		expect(keptIds).toContain("c_pinned");
		expect(keptIds).toContain("c_pending");
		expect(keptIds).toContain("c_working");
		expect(keptIds).toContain("c_awaiting");
		expect(keptIds).not.toContain("c_idle");
		expect(keptIds).not.toContain("p1");
	});
});

describe("unassignedGroups grouping (G15 / Contract 5)", () => {
	it("groups unassigned sessions by repoRoot ?? cwd, newest group first", () => {
		const s1 = makeSession({
			id: "s1",
			workspaceId: null,
			cwd: "/dirA/sub1",
			repoRoot: "/dirA",
			updatedAt: "2026-09-25T10:00:00Z",
		});
		const s2 = makeSession({
			id: "s2",
			workspaceId: null,
			cwd: "/dirA/sub2",
			repoRoot: "/dirA",
			updatedAt: "2026-09-25T12:00:00Z",
		});
		const s3 = makeSession({
			id: "s3",
			workspaceId: null,
			cwd: "/dirB",
			repoRoot: null,
			updatedAt: "2026-09-25T14:00:00Z", // newest group
		});

		const res = groupSessions([s1, s2, s3], []);
		expect(res.unassignedGroups).toHaveLength(2);
		expect(res.unassignedGroups[0].key).toBe("/dirB");
		expect(res.unassignedGroups[0].label).toBe("dirB");
		expect(res.unassignedGroups[0].sessions.map((s) => s.id)).toEqual(["s3"]);

		expect(res.unassignedGroups[1].key).toBe("/dirA");
		expect(res.unassignedGroups[1].label).toBe("dirA");
		expect(res.unassignedGroups[1].sessions.map((s) => s.id)).toEqual(["s2", "s1"]);

		// Flat unassigned list stays intact
		expect(res.unassigned.map((s) => s.id)).toEqual(["s3", "s2", "s1"]);
		expect(UNASSIGNED_LABEL).toBe("未归入工作区");
		expect(DELETED_LABEL).toBe("已清理的工作树");
	});
});

describe("nestSideChats", () => {
	const side = (id: string, parentId: string | null) =>
		makeSession({ id, parentId, forkDepth: 1, kind: "side" });

	it("places side chats right after their parent, keeping sibling order", () => {
		const list = [
			makeSession({ id: "a" }),
			side("a.1", "b"),
			makeSession({ id: "b" }),
			side("a.2", "a"),
			side("b.1", "b"),
		];
		expect(nestSideChats(list).map((s) => s.id)).toEqual(["a", "a.2", "b", "a.1", "b.1"]);
	});

	it("keeps a side chat in place when its parent is not in the list", () => {
		const list = [makeSession({ id: "x" }), side("orphan", "gone"), makeSession({ id: "y" })];
		expect(nestSideChats(list).map((s) => s.id)).toEqual(["x", "orphan", "y"]);
	});

	it("does not touch full forks and returns the same array without side chats", () => {
		const list = [makeSession({ id: "a" }), makeSession({ id: "f", parentId: "a", kind: "fork" })];
		expect(nestSideChats(list)).toBe(list);
	});

	it("nests side chats of side chats", () => {
		const list = [side("c2", "c1"), makeSession({ id: "p" }), side("c1", "p")];
		expect(nestSideChats(list).map((s) => s.id)).toEqual(["p", "c1", "c2"]);
	});
});
