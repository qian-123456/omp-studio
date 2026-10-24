import { describe, expect, it } from "vitest";
import type { Attention, SessionMeta, SessionStatus } from "../../lib/contracts";
import { getGroupStatusCounts } from "./GroupHeader";
import type { BranchSubgroup } from "./grouping";

const NOW = Date.parse("2026-10-02T12:00:00Z");
const H = 3_600_000;

function meta(
	id: string,
	attention: Attention | null,
	hoursAgo: number,
	status: SessionStatus = "idle",
): SessionMeta {
	return {
		id,
		tool: "omp",
		file: `/tmp/${id}.jsonl`,
		cwd: "/repo",
		title: id,
		label: id,
		createdAt: new Date(NOW - 500 * H).toISOString(),
		updatedAt: new Date(NOW - hoursAgo * H).toISOString(),
		parentId: null,
		forkDepth: 0,
		status,
		unread: attention === "unread",
		pending: null,
		live: false,
		externalPid: null,
		pinned: false,
		archived: false,
		workspaceId: null,
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
		model: null,
		attention,
		mode: "code",
		groupId: null,
	};
}

describe("getGroupStatusCounts", () => {
	it("counts only attention inside the inbox window, not sticky old unread/error", () => {
		const sessions = [
			meta("fresh-unread", "unread", 1),
			meta("old-unread", "unread", 200),
			meta("old-error", "error", 200, "error"),
			meta("awaiting-old", "awaiting", 200, "awaiting_answer"),
			meta("seen-error", null, 1, "error"),
		];
		expect(getGroupStatusCounts(sessions, NOW, 24)).toEqual({ working: 0, attention: 2 });
	});

	it("flattens subgroups and counts working sessions separately", () => {
		const subgroups = [
			{ sessions: [meta("a", "awaiting", 1, "awaiting_approval"), meta("w", "running", 1, "working")] },
			{ sessions: [meta("e", "error", 2, "error")] },
		] as unknown as BranchSubgroup[];
		expect(getGroupStatusCounts(subgroups, NOW, 24)).toEqual({ working: 1, attention: 2 });
	});
});
