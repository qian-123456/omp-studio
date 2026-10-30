import { describe, expect, it } from "vitest";
import type { SubagentSummary } from "../../../lib/contracts";
import { mergeAgents } from "./merge";

const summary = (id: string, prompt: string, status: SubagentSummary["status"] = "completed"): SubagentSummary => ({
	id,
	status,
	model: "m",
	thinkingLevel: null,
	agent: "task",
	prompt,
	messageCount: 1,
	toolCallCount: 2,
	requestCount: 1,
	tokens: 10,
	cost: 0,
	startedAt: null,
	endedAt: null,
	outputPath: null,
	filePath: `/tmp/${id}.jsonl`,
});

describe("mergeAgents per-dispatch rows", () => {
	const fileList = [
		summary("0-Alpha", "Complete assignment thoroughly: do alpha"),
		summary("1-Beta", "Complete assignment thoroughly: do beta"),
		summary("2-Gamma", "Complete assignment thoroughly: do gamma"),
	];

	it("second dispatch shows only its own agents and never file-only ones", () => {
		const second = mergeAgents({
			args: { tasks: [{ id: "Gamma", task: "do gamma" }] },
			details: null,
			fileList,
			toolCallId: "call-2",
		});
		expect(second.rows).toHaveLength(1);
		expect(second.rows[0]?.id).toBe("Gamma");
		expect(second.rows[0]?.filePath).toBe("/tmp/2-Gamma.jsonl");
		expect(second.rows[0]?.status).toBe("completed");

		const first = mergeAgents({
			args: { tasks: [{ id: "Alpha", task: "do alpha" }, { id: "Beta", task: "do beta" }] },
			details: null,
			fileList,
			toolCallId: "call-1",
		});
		expect(first.rows.map((r) => r.id)).toEqual(["Alpha", "Beta"]);
	});

	it("enriches by exact id", () => {
		const r = mergeAgents({
			args: { tasks: [{ id: "1-Beta", task: "x" }] },
			details: null,
			fileList,
			toolCallId: "c",
		});
		expect(r.rows).toHaveLength(1);
		expect(r.rows[0]?.filePath).toBe("/tmp/1-Beta.jsonl");
	});
});

describe("mergeAgents attempt isolation", () => {
	const tasks = [
		{ id: "Core", task: "do core" },
		{ id: "Models", task: "do models" },
	];
	// The re-dispatch (call-2) spawned these; same prompts as the failed call-1.
	const redispatched = [
		summary("0-Core", "Complete assignment thoroughly: do core", "running"),
		summary("1-Models", "Complete assignment thoroughly: do models", "running"),
	];

	it("errored dispatch neither leaks the re-dispatch's file state nor keeps pending", () => {
		const failed = mergeAgents({
			args: { tasks },
			details: null,
			fileList: redispatched,
			toolCallId: "call-1",
			callStatus: "error",
			resultText: "model not allowed",
		});
		expect(failed.rows.map((r) => r.status)).toEqual(["failed", "failed"]);
		expect(failed.rows.every((r) => !r.filePath && r.tokens === undefined)).toBe(true);
		expect(failed.rows[0]?.error).toBe("model not allowed");

		const second = mergeAgents({
			args: { tasks },
			details: null,
			fileList: redispatched,
			toolCallId: "call-2",
			callStatus: "done",
		});
		expect(second.rows.map((r) => r.status)).toEqual(["running", "running"]);
		expect(second.rows[0]?.filePath).toBe("/tmp/0-Core.jsonl");
	});

	it("errored dispatch keeps a detached child its own live entry proves running", () => {
		const r = mergeAgents({
			args: { tasks },
			details: null,
			toolCallId: "call-1",
			callStatus: "error",
			liveSubagents: {
				Core: { status: "running", label: "Core", parentToolCallId: "call-1", index: 0 },
				Other: { status: "running", label: "Other", parentToolCallId: "call-2", index: 0 },
			},
		});
		expect(r.rows.map((x) => [x.id, x.status])).toEqual([
			["Core", "running"],
			["Models", "failed"],
		]);
	});

	it("a terminal result is never revived by a later running source", () => {
		const r = mergeAgents({
			args: { tasks: [{ id: "Core", task: "do core" }] },
			details: { results: [{ id: "Core", status: "completed" }] } as never,
			fileList: [summary("0-Core", "do core", "running")],
			toolCallId: "c",
			liveSubagents: {
				Core: { status: "running", label: "Core", parentToolCallId: "c", index: 0 },
			},
		});
		expect(r.rows[0]?.status).toBe("completed");
	});
});

describe("mergeAgents failure + context", () => {
	const args = {
		context: "SHARED CTX",
		tasks: [
			{ id: "A", agent: "task", task: "do a", solutionSpace: "open: fix or design" },
			{ id: "B", agent: "task", task: "do b" },
			{ id: "C", agent: "task", task: "do c" },
		],
	};

	it("failed call with 3 tasks keeps reason on every row and carries context/solutionSpace", () => {
		const { context, rows } = mergeAgents({
			args,
			details: null,
			toolCallId: "t1",
			callStatus: "error",
			resultText: "sourceSession: must NOT have additional properties",
		});
		expect(context).toBe("SHARED CTX");
		expect(rows).toHaveLength(3);
		for (const r of rows) {
			expect(r.status).toBe("failed");
			expect(r.error).toContain("must NOT have additional properties");
			expect(r.sharedContext).toBe("SHARED CTX");
		}
		expect(rows[0].solutionSpace).toBe("open: fix or design");
		expect(rows[1].solutionSpace).toBeUndefined();
	});

	it("flat form carries solutionSpace", () => {
		const { rows } = mergeAgents({
			args: { agent: "task", task: "x", solutionSpace: "one fix", context: "C" },
			details: null,
			toolCallId: "t",
		});
		expect(rows[0].solutionSpace).toBe("one fix");
		expect(rows[0].sharedContext).toBe("C");
	});

	it("live completed beats stale disk running", () => {
		const { rows } = mergeAgents({
			args,
			details: null,
			fileList: [summary("A", "do a", "running")],
			liveSubagents: { A: { status: "completed", label: "A", parentToolCallId: "t1", index: 0 } as never },
			toolCallId: "t1",
		});
		expect(rows.find((r) => r.id === "A")?.status).toBe("completed");
	});
});

describe("mergeAgents per-agent timing", () => {
	it("agents finishing at different times keep their own durations; unknown stays unknown", () => {
		const a = { ...summary("A", "do a"), startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:00:10Z" };
		const b = { ...summary("B", "do b"), startedAt: "2026-01-01T00:00:00Z", endedAt: "2026-01-01T00:01:00Z" };
		const c = summary("C", "do c"); // no child timestamps
		const { rows } = mergeAgents({
			args: { tasks: [{ id: "A", task: "do a" }, { id: "B", task: "do b" }, { id: "C", task: "do c" }] },
			details: null,
			fileList: [a, b, c],
			toolCallId: "t",
			callStatus: "done",
		});
		const by = Object.fromEntries(rows.map((r) => [r.id, r]));
		expect(by.A.durationMs).toBe(10_000);
		expect(by.B.durationMs).toBe(60_000);
		expect(by.C.durationMs).toBeUndefined();
		expect(by.C.endedAt).toBeUndefined();
		expect(by.C.startedAt).toBeUndefined();
	});
});
