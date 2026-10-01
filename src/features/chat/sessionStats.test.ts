import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import {
	computeSessionStats,
	formatDuration,
	formatTokens,
} from "./sessionStats";

function makeItem(partial: Partial<TranscriptItem>): TranscriptItem {
	return {
		id: Math.random().toString(),
		parentId: null,
		ts: new Date().toISOString(),
		kind: "user",
		text: null,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		...partial,
	};
}

describe("formatDuration", () => {
	it("formats seconds correctly", () => {
		expect(formatDuration(0)).toBe("0秒");
		expect(formatDuration(1500)).toBe("2秒");
		expect(formatDuration(45000)).toBe("45秒");
	});

	it("formats minutes and seconds correctly", () => {
		expect(formatDuration(65000)).toBe("1分5秒");
		expect(formatDuration(120000)).toBe("2分钟");
		expect(formatDuration(314 * 60 * 1000 + 28 * 1000)).toBe("5小时14分");
	});
});

describe("formatTokens", () => {
	it("formats small tokens", () => {
		expect(formatTokens(0)).toBe("0 tok");
		expect(formatTokens(800)).toBe("800 tok");
	});

	it("formats thousands (k)", () => {
		expect(formatTokens(44800)).toBe("44.8k tok");
		expect(formatTokens(1200)).toBe("1.2k tok");
	});

	it("formats millions (M) and billions (B)", () => {
		expect(formatTokens(1511000000)).toBe("1.5B tok");
		expect(formatTokens(12500000)).toBe("12.5M tok");
	});
});

describe("computeSessionStats", () => {
	it("handles empty items gracefully", () => {
		const stats = computeSessionStats([]);
		expect(stats.rounds).toBe(0);
		expect(stats.steps).toBe(0);
		expect(stats.totalTokens).toBe(0);
		expect(stats.cacheHitRate).toBe(0);
		expect(stats.hasData).toBe(false);
	});

	it("computes rounds, steps, and tokens correctly", () => {
		const items: TranscriptItem[] = [
			makeItem({
				kind: "user",
				ts: "2026-03-29T10:00:00.000Z",
			}),
			makeItem({
				kind: "assistant",
				ts: "2026-03-29T10:00:02.500Z",
				toolCalls: [{ id: "t1", name: "bash", args: {}, intent: null }],
				usage: {
					input: 1000,
					output: 200,
					cacheRead: 9000,
					cacheWrite: 500,
					totalTokens: 10200,
					cost: 0.05,
				},
			}),
			makeItem({
				kind: "tool_result",
				ts: "2026-03-29T10:00:05.000Z",
			}),
			makeItem({
				kind: "assistant",
				ts: "2026-03-29T10:00:07.000Z",
				usage: {
					input: 500,
					output: 300,
					cacheRead: 9500,
					cacheWrite: 0,
					totalTokens: 10300,
					cost: 0.02,
				},
			}),
		];

		const stats = computeSessionStats(items);
		expect(stats.rounds).toBe(1);
		expect(stats.steps).toBe(3); // 2 assistant + 1 tool call
		expect(stats.totalTokens).toBe(20500);
		expect(stats.outputTokens).toBe(500);
		expect(stats.inputTokens).toBe(1500);
		expect(stats.cacheRead).toBe(18500);
		// totalInput = 18500 + 500 (cacheWrite) + 1500 = 20500; 18500/20500 = 90.24%
		expect(stats.cacheHitRate).toBeCloseTo(90.2, 1);
		expect(stats.hasData).toBe(true);
		expect(stats.avgTtftMs).toBe(2500);
	});
});
