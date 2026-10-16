import { describe, expect, it } from "vitest";
import type { SubagentSummary } from "../../../lib/contracts";
import { mergeDiskAndLive } from "./useSessionSubagents";

const disk = (over: Partial<SubagentSummary>): SubagentSummary => ({
	id: "0-Explore",
	status: "running",
	model: "p/m",
	thinkingLevel: null,
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
});
