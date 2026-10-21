import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { chunkSessionsByTime } from "./timeChunking";

function makeSession(id: string, updatedAt: string): SessionMeta {
	return {
		id,
		tool: "omp",
		file: `/tmp/${id}.jsonl`,
		cwd: "/repo",
		title: `Session ${id}`,
		label: `Session ${id}`,
		createdAt: updatedAt,
		updatedAt,
		parentId: null,
		forkDepth: 0,
		workspaceId: "global",
		archived: false,
		pinned: false,
		status: "idle",
		unread: false,
		pending: null,
		live: false,
		externalPid: null,
		model: null,
		attention: null,
		mode: "chat",
		groupId: null,
		kind: null,
		repoRoot: null,
		git: null,
		result: null,
		lastAssistant: null,
	};
}

describe("chunkSessionsByTime", () => {
	const fixedNow = new Date(2026, 9, 21, 14, 30, 0); // local date

	it("returns empty array for empty input", () => {
		expect(chunkSessionsByTime([], fixedNow)).toEqual([]);
	});

	it("groups sessions into correct buckets based on date boundaries", () => {
		const sToday = makeSession(
			"today-1",
			new Date(2026, 9, 21, 10, 0, 0).toISOString(),
		);
		const sYesterday = makeSession(
			"yest-1",
			new Date(2026, 9, 20, 15, 0, 0).toISOString(),
		);
		const sLast7 = makeSession(
			"last7-1",
			new Date(2026, 9, 18, 12, 0, 0).toISOString(),
		);
		const sEarlier = makeSession(
			"early-1",
			new Date(2026, 9, 10, 12, 0, 0).toISOString(),
		);
		const sInvalid = makeSession("inv-1", "invalid-date");

		const chunks = chunkSessionsByTime(
			[sToday, sYesterday, sLast7, sEarlier, sInvalid],
			fixedNow,
		);

		expect(chunks.map((c) => c.key)).toEqual([
			"today",
			"yesterday",
			"last7Days",
			"earlier",
		]);

		expect(chunks.find((c) => c.key === "today")?.sessions.map((s) => s.id)).toEqual(["today-1"]);
		expect(chunks.find((c) => c.key === "yesterday")?.sessions.map((s) => s.id)).toEqual(["yest-1"]);
		expect(chunks.find((c) => c.key === "last7Days")?.sessions.map((s) => s.id)).toEqual(["last7-1"]);
		expect(chunks.find((c) => c.key === "earlier")?.sessions.map((s) => s.id)).toEqual(["early-1", "inv-1"]);
	});

	it("omits empty buckets when there are no sessions in them", () => {
		const sToday = makeSession(
			"today-1",
			new Date(2026, 9, 21, 10, 0, 0).toISOString(),
		);
		const sEarlier = makeSession(
			"early-1",
			new Date(2026, 9, 1, 12, 0, 0).toISOString(),
		);

		const chunks = chunkSessionsByTime([sToday, sEarlier], fixedNow);
		expect(chunks.map((c) => c.key)).toEqual(["today", "earlier"]);
	});
});
