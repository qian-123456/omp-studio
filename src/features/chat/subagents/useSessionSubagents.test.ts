import { describe, expect, it } from "vitest";
import type { SubagentSummary } from "../../../lib/contracts";
import { subagentCounts } from "./counts";
import { mergeDiskAndLive } from "./useSessionSubagents";

const disk = (over: Partial<SubagentSummary>): SubagentSummary => ({
	id: "0-Explore",
	status: "running",
	model: "p/m",
	thinkingLevel: null,
	agent: null,
	prompt: "Complete assignment thoroughly:\nScan the repo",
	messageCount: 2,
	toolCallCount: 3,
	requestCount: 1,
	tokens: 10,
	cost: 0,
	startedAt: "2026-01-01T00:00:00Z",
	endedAt: "2026-01-01T00:00:05Z",
	outputPath: null,
	filePath: "/s/p/parent/0-Explore.jsonl",
	...over,
});

describe("mergeDiskAndLive", () => {
	it("builds rows from on-disk subagents of an external CLI session", () => {
		const { subagents, rows } = mergeDiskAndLive([disk({})], {});
		expect(subagents["0-Explore"].label).toBe("Scan the repo");
		expect(subagents["0-Explore"].status).toBe("running");
		expect(rows["0-Explore"].filePath).toBe("/s/p/parent/0-Explore.jsonl");
		expect(rows["0-Explore"].durationMs).toBe(5000);
	});

	it("live status wins over disk-inferred status", () => {
		const { rows } = mergeDiskAndLive([disk({ status: "completed" })], {
			"0-Explore": { status: "running", label: "x", agent: "explore" },
		});
		expect(rows["0-Explore"].status).toBe("running");
		expect(rows["0-Explore"].agent).toBe("explore");
		expect(rows["0-Explore"].filePath).toBe("/s/p/parent/0-Explore.jsonl");
	});

	it("adds queued agents of a running task call and counts them", () => {
		const { subagents } = mergeDiskAndLive(
			[disk({ status: "completed" })],
			{},
			{
				t1: {
					toolCallId: "t1",
					toolName: "task",
					args: {
						tasks: [
							{ id: "Explore", task: "Scan the repo" },
							{ id: "Later", task: "Not started yet" },
						],
					},
					intent: null,
					status: "running",
					text: "",
					details: null,
				},
			},
		);
		expect(subagentCounts(subagents)).toEqual({ running: 0, queued: 1, done: 1, failed: 0 });
		expect(subagents.Later?.status).toBe("pending");
	});

	it("counts queued agents of a task call still being streamed (no tool entry yet)", () => {
		const streaming = {
			role: "assistant",
			content: [
				{ type: "text", text: "dispatching" },
				{
					type: "toolCall",
					id: "t9",
					name: "task",
					arguments: { tasks: [{ id: "ImportBackend" }, { id: "ImportFrontend" }] },
				},
			],
		};
		const { subagents } = mergeDiskAndLive([], {}, {}, streaming);
		expect(subagentCounts(subagents)).toEqual({ running: 0, queued: 2, done: 0, failed: 0 });

		// Once omp starts the call, the tool entry owns the rows (no double count).
		const started = {
			t9: {
				toolCallId: "t9",
				toolName: "task",
				args: { tasks: [{ id: "ImportBackend" }, { id: "ImportFrontend" }] },
				intent: null,
				status: "running" as const,
				text: "",
				details: null,
			},
		};
		const after = mergeDiskAndLive([], {}, started, streaming);
		expect(subagentCounts(after.subagents).queued).toBe(2);
	});
});
