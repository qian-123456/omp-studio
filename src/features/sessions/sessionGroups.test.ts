import { describe, expect, it, vi } from "vitest";
import type { SessionGroup, SessionMeta } from "../../lib/contracts";
import { groupsForMode, splitSessionsByGroup } from "./sessionGroups";

vi.mock("../../lib/ipc", () => ({
	listSessionGroups: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../lib/events", () => ({
	onSessionGroupsChanged: vi.fn().mockResolvedValue(() => {}),
}));

function makeSession(partial: Partial<SessionMeta>): SessionMeta {
	return {
		id: partial.id || "s1",
		tool: "omp",
		file: "/tmp/s1.jsonl",
		cwd: "/global",
		title: partial.title || "Session",
		label: "#1",
		createdAt: "2026-09-24T10:00:00Z",
		updatedAt: partial.updatedAt || "2026-09-24T10:00:00Z",
		parentId: null,
		forkDepth: 0,
		status: "idle",
		unread: false,
		pending: null,
		live: false,
		externalPid: null,
		pinned: false,
		archived: false,
		workspaceId: partial.workspaceId ?? "global",
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
		model: null,
		attention: null,
		mode: partial.mode ?? "code",
		groupId: partial.groupId ?? null,
		...partial,
	};
}

function makeGroup(partial: Partial<SessionGroup> & { id: string }): SessionGroup {
	return {
		mode: partial.mode ?? "code",
		name: partial.id,
		sort: 0,
		...partial,
	};
}

describe("groupsForMode", () => {
	it("returns only the mode's groups in user sort order", () => {
		const groups = [
			makeGroup({ id: "b", name: "B组", sort: 2 }),
			makeGroup({ id: "w", name: "工作", sort: 0, mode: "work" }),
			makeGroup({ id: "a", name: "A组", sort: 1 }),
		];
		expect(groupsForMode(groups, "code").map((g) => g.id)).toEqual(["a", "b"]);
		expect(groupsForMode(groups, "work").map((g) => g.id)).toEqual(["w"]);
		expect(groupsForMode(groups, "study")).toEqual([]);
	});

	it("breaks sort ties by name", () => {
		const groups = [
			makeGroup({ id: "z", name: "Zeta", sort: 1 }),
			makeGroup({ id: "a", name: "Alpha", sort: 1 }),
		];
		expect(groupsForMode(groups, "code").map((g) => g.id)).toEqual(["a", "z"]);
	});
});

describe("splitSessionsByGroup", () => {
	it("buckets global-area sessions per group and keeps the ungrouped tail", () => {
		const groups = [
			makeGroup({ id: "g1", name: "调研" }),
			makeGroup({ id: "g2", name: "杂项", sort: 1 }),
		];
		const sessions = [
			makeSession({ id: "s-free", groupId: null }),
			makeSession({ id: "s-2", groupId: "g2" }),
			makeSession({ id: "s-1", groupId: "g1" }),
		];
		const { byGroup, ungrouped } = splitSessionsByGroup(sessions, groups);
		expect(byGroup.g1.map((s) => s.id)).toEqual(["s-1"]);
		expect(byGroup.g2.map((s) => s.id)).toEqual(["s-2"]);
		expect(ungrouped.map((s) => s.id)).toEqual(["s-free"]);
	});

	it("falls back to ungrouped for group ids that are not in the passed list", () => {
		// Callers pass mode-filtered groups (groupsForMode); ids missing from
		// that list — deleted groups, other modes — land ungrouped.
		const groups = [makeGroup({ id: "g1" })];
		const sessions = [
			makeSession({ id: "s-dead", groupId: "gone" }),
			makeSession({ id: "s-1", groupId: "g1" }),
		];
		const { byGroup, ungrouped } = splitSessionsByGroup(sessions, groups);
		expect(byGroup.g1.map((s) => s.id)).toEqual(["s-1"]);
		expect(ungrouped.map((s) => s.id)).toEqual(["s-dead"]);
	});

	it("preserves session order inside each bucket", () => {
		const groups = [makeGroup({ id: "g1" })];
		const sessions = [
			makeSession({ id: "s1", groupId: "g1", updatedAt: "2026-09-25T10:00:00Z" }),
			makeSession({ id: "s2", groupId: "g1", updatedAt: "2026-09-25T09:00:00Z" }),
			makeSession({ id: "s3", groupId: null }),
		];
		const { byGroup, ungrouped } = splitSessionsByGroup(sessions, groups);
		expect(byGroup.g1.map((s) => s.id)).toEqual(["s1", "s2"]);
		expect(ungrouped.map((s) => s.id)).toEqual(["s3"]);
	});
});
