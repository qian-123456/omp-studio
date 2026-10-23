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
