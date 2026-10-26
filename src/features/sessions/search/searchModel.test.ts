import { describe, expect, it } from "vitest";
import type { Workspace } from "../../../lib/contracts";
import {
	bucketRecent,
	limitBuckets,
	mergeResults,
	metadataMatches,
	searchableSessions,
	matchesSearchFilters,
	countActiveFilters,
	DEFAULT_SEARCH_FILTERS,
	type SearchFilters,
} from "./searchModel";
import { makeHit as hit, makeSession } from "./testFixtures";

describe("bucketRecent", () => {
	const now = new Date(2026, 9, 23, 15, 0, 0); // local Oct 23, 15:00
	const at = (daysAgo: number, hour = 9) =>
		new Date(2026, 9, 23 - daysAgo, hour).toISOString();

	it("groups into 今天/昨天/过去 7 天/过去 30 天/更早, newest first, omitting empty buckets", () => {
		const list = [
			makeSession({ id: "old", updatedAt: at(90) }),
			makeSession({ id: "t2", updatedAt: at(0, 8) }),
			makeSession({ id: "y", updatedAt: at(1) }),
			makeSession({ id: "t1", updatedAt: at(0, 14) }),
			makeSession({ id: "w", updatedAt: at(4) }),
			makeSession({ id: "m", updatedAt: at(20) }),
		];
		const buckets = bucketRecent(list, now);
		expect(buckets.map((b) => b.label)).toEqual(["今天", "昨天", "过去 7 天", "过去 30 天", "更早"]);
		expect(buckets[0].sessions.map((s) => s.id)).toEqual(["t1", "t2"]);
		expect(buckets.map((b) => b.sessions.map((s) => s.id))).toEqual([
			["t1", "t2"],
			["y"],
			["w"],
			["m"],
			["old"],
		]);
		expect(bucketRecent([makeSession({ id: "only", updatedAt: at(0) })], now).map((b) => b.key)).toEqual([
			"today",
		]);
	});

	it("limitBuckets caps the total across buckets", () => {
		const list = [
			makeSession({ id: "a", updatedAt: at(0, 14) }),
			makeSession({ id: "b", updatedAt: at(0, 13) }),
			makeSession({ id: "c", updatedAt: at(1) }),
		];
		const capped = limitBuckets(bucketRecent(list, now), 2);
		expect(capped.map((b) => b.sessions.map((s) => s.id))).toEqual([["a", "b"]]);
	});
});

describe("searchableSessions", () => {
	it("drops blank drafts and empty side chats", () => {
		const blank = makeSession({ id: "blank" });
		const side = makeSession({ id: "side", parentId: "p", kind: "side", title: "" });
		const ok = makeSession({ id: "ok" });
		const out = searchableSessions([blank, side, ok], (s) => s.id === "blank");
		expect(out.map((s) => s.id)).toEqual(["ok"]);
	});
});

describe("metadataMatches", () => {
	it("matches title/branch/model tokens (AND), archived included, newest first", () => {
		const a = makeSession({ id: "a", title: "auth refactor", updatedAt: "2026-10-02T00:00:00Z" });
		const b = makeSession({
			id: "b",
			title: "misc",
			archived: true,
			updatedAt: "2026-10-03T00:00:00Z",
			git: { branch: "feature/auth", dirty: 0, worktree: null } as never,
		});
		const c = makeSession({ id: "c", title: "unrelated" });
		expect(metadataMatches([a, b, c], "auth", []).map((s) => s.id)).toEqual(["b", "a"]);
		expect(metadataMatches([a, b, c], "auth refactor", []).map((s) => s.id)).toEqual(["a"]);
	});
});

describe("mergeResults", () => {
	const a = makeSession({ id: "a", title: "needle title", updatedAt: "2026-10-01T00:00:00Z" });
	const b = makeSession({ id: "b", title: "other", updatedAt: "2026-10-03T00:00:00Z" });
	const c = makeSession({ id: "c", title: "third", updatedAt: "2026-10-02T00:00:00Z" });
	const listable = new Map([a, b, c].map((s) => [s.id, s]));

	it("orders rows newest first regardless of metadata/content source, one row per session", () => {
		const rows = mergeResults([a], [hit("c"), hit("b"), hit("c", { entryId: "dup" })], listable);
		expect(rows.map((r) => [r.session.id, r.source])).toEqual([
			["b", "content"],
			["c", "content"],
			["a", "meta"],
		]);
		// first (best) hit per session wins
		expect(rows.find((r) => r.session.id === "c")?.hit?.entryId).toBe("e-c");
	});

	it("a session matching by title AND content shows the title row WITH the snippet", () => {
		const rows = mergeResults([a], [hit("a")], listable);
		expect(rows).toHaveLength(1);
		expect(rows[0].source).toBe("meta");
		expect(rows[0].hit?.entryId).toBe("e-a");
	});

	it("drops content hits of sessions that are not listable", () => {
		const rows = mergeResults([], [hit("ghost"), hit("b")], listable);
		expect(rows.map((r) => r.session.id)).toEqual(["b"]);
	});
});

describe("searchFilters", () => {
	const now = new Date(2026, 9, 23, 15, 0, 0).getTime();
	const at = (daysAgo: number) => new Date(2026, 9, 23 - daysAgo, 10, 0, 0).toISOString();

	const ws1 = { id: "ws1", name: "Project 1", path: "/p1", kind: "project" as const, sort: 0, mode: "code" as const };
	const wsGlobal = { id: "global", name: "Universal", path: "/global", kind: "global" as const, sort: 99, mode: "chat" as const };
	const workspacesById = new Map<string, Workspace>([
		[ws1.id, ws1],
		[wsGlobal.id, wsGlobal],
	]);

	const projectSession = makeSession({ id: "p-today", workspaceId: "ws1", updatedAt: at(0) });
	const universalSession = makeSession({ id: "u-week", workspaceId: "global", updatedAt: at(5) });
	const noWsSession = makeSession({ id: "u-old", workspaceId: null, updatedAt: at(60) });
	const archivedSession = makeSession({ id: "archived", workspaceId: "ws1", archived: true, updatedAt: at(2) });

	it("countActiveFilters counts non-default filters", () => {
		expect(countActiveFilters(DEFAULT_SEARCH_FILTERS)).toBe(0);
		expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, scope: "project" })).toBe(1);
		expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, scope: "project", projectId: "ws1" })).toBe(2);
		expect(countActiveFilters({ ...DEFAULT_SEARCH_FILTERS, scope: "project", projectId: "ws1", timeRange: "today" })).toBe(3);
		expect(countActiveFilters({ scope: "project", projectId: "ws1", timeRange: "today", includeArchived: false })).toBe(4);
	});

	it("filters by archived status", () => {
		expect(matchesSearchFilters(archivedSession, DEFAULT_SEARCH_FILTERS, workspacesById, now)).toBe(true);
		expect(matchesSearchFilters(archivedSession, { ...DEFAULT_SEARCH_FILTERS, includeArchived: false }, workspacesById, now)).toBe(false);
		expect(matchesSearchFilters(projectSession, { ...DEFAULT_SEARCH_FILTERS, includeArchived: false }, workspacesById, now)).toBe(true);
	});

	it("filters by scope (project vs universal)", () => {
		const projectFilters: SearchFilters = { ...DEFAULT_SEARCH_FILTERS, scope: "project" };
		expect(matchesSearchFilters(projectSession, projectFilters, workspacesById, now)).toBe(true);
		expect(matchesSearchFilters(universalSession, projectFilters, workspacesById, now)).toBe(false);
		expect(matchesSearchFilters(noWsSession, projectFilters, workspacesById, now)).toBe(false);

		const universalFilters: SearchFilters = { ...DEFAULT_SEARCH_FILTERS, scope: "universal" };
		expect(matchesSearchFilters(projectSession, universalFilters, workspacesById, now)).toBe(false);
		expect(matchesSearchFilters(universalSession, universalFilters, workspacesById, now)).toBe(true);
		expect(matchesSearchFilters(noWsSession, universalFilters, workspacesById, now)).toBe(true);
	});

	it("filters by specific project", () => {
		const filters: SearchFilters = { ...DEFAULT_SEARCH_FILTERS, projectId: "ws1" };
		expect(matchesSearchFilters(projectSession, filters, workspacesById, now)).toBe(true);
		expect(matchesSearchFilters(universalSession, filters, workspacesById, now)).toBe(false);
	});

	it("filters by time range (today, 7days, 30days)", () => {
		const todayFilters: SearchFilters = { ...DEFAULT_SEARCH_FILTERS, timeRange: "today" };
		expect(matchesSearchFilters(projectSession, todayFilters, workspacesById, now)).toBe(true);
		expect(matchesSearchFilters(universalSession, todayFilters, workspacesById, now)).toBe(false);

		const weekFilters: SearchFilters = { ...DEFAULT_SEARCH_FILTERS, timeRange: "7days" };
		expect(matchesSearchFilters(projectSession, weekFilters, workspacesById, now)).toBe(true);
		expect(matchesSearchFilters(universalSession, weekFilters, workspacesById, now)).toBe(true);
		expect(matchesSearchFilters(noWsSession, weekFilters, workspacesById, now)).toBe(false);

		const monthFilters: SearchFilters = { ...DEFAULT_SEARCH_FILTERS, timeRange: "30days" };
		expect(matchesSearchFilters(universalSession, monthFilters, workspacesById, now)).toBe(true);
		expect(matchesSearchFilters(noWsSession, monthFilters, workspacesById, now)).toBe(false);
	});
});
