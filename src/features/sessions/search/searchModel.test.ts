import { describe, expect, it } from "vitest";
import {
	bucketRecent,
	limitBuckets,
	mergeResults,
	metadataMatches,
	searchableSessions,
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
