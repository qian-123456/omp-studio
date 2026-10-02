import { describe, expect, it } from "vitest";
import type { Attention, SessionMeta } from "../../lib/contracts";
import { groupInbox } from "./attention";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const H = 3_600_000;

function meta(id: string, attention: Attention | null, hoursAgo: number, archived = false): SessionMeta {
	return {
		id,
		tool: "omp",
		file: `/tmp/${id}.jsonl`,
		cwd: "/repo",
		title: id,
		label: id,
		createdAt: new Date(NOW - 100 * H).toISOString(),
		updatedAt: new Date(NOW - hoursAgo * H).toISOString(),
		parentId: null,
		forkDepth: 0,
		status: "idle",
		unread: false,
		pending: null,
		live: false,
		externalPid: null,
		pinned: false,
		archived,
		workspaceId: null,
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
		model: null,
		attention,
	};
}

describe("groupInbox", () => {
	it("drops error/unread older than the window but keeps the boundary", () => {
		const g = groupInbox(
			[meta("inside", "unread", 24), meta("outside", "unread", 24.01), meta("oldErr", "error", 30)],
			NOW,
			24,
		);
		expect(g.byKind.unread.map((s) => s.id)).toEqual(["inside"]);
		expect(g.byKind.error).toEqual([]);
		expect(g.badge).toBe(1);
	});

	it("never expires awaiting or running", () => {
		const g = groupInbox([meta("a", "awaiting", 500), meta("r", "running", 500)], NOW, 1);
		expect(g.byKind.awaiting.map((s) => s.id)).toEqual(["a"]);
		expect(g.byKind.running.map((s) => s.id)).toEqual(["r"]);
	});

	it("counts awaiting+error+unread in the badge but not running or none", () => {
		const g = groupInbox(
			[meta("a", "awaiting", 1), meta("e", "error", 1), meta("u", "unread", 1), meta("r", "running", 1), meta("n", null, 1)],
			NOW,
			24,
		);
		expect(g.badge).toBe(3);
		expect(g.all.map((s) => s.id)).toEqual(["a", "e", "u", "r"]);
	});

	it("excludes archived sessions everywhere", () => {
		const g = groupInbox([meta("x", "awaiting", 1, true), meta("y", "running", 1, true)], NOW, 24);
		expect(g.all).toEqual([]);
		expect(g.badge).toBe(0);
	});

	it("orders each kind by most recent updatedAt", () => {
		const g = groupInbox([meta("old", "unread", 5), meta("new", "unread", 1)], NOW, 24);
		expect(g.byKind.unread.map((s) => s.id)).toEqual(["new", "old"]);
	});
});
