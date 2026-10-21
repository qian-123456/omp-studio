import { describe, expect, it } from "vitest";
import {
	durationWithSubagents,
	turnSubagentSpan,
	type SubagentFacts,
} from "./turnSubagents";

const T0 = Date.parse("2026-10-21T23:04:00Z");
const sub = (over: Partial<SubagentFacts>): SubagentFacts => ({ status: "running", ...over });

describe("turnSubagentSpan", () => {
	it("owns subagents by dispatching call id", () => {
		const span = turnSubagentSpan({
			turnStart: T0,
			toolCallIds: new Set(["c1"]),
			subagents: [sub({ parentToolCallId: "c1" }), sub({ parentToolCallId: "other" })],
		});
		expect(span.running).toBe(true);
		expect(
			turnSubagentSpan({ turnStart: T0, toolCallIds: new Set(["c1"]), subagents: [sub({ parentToolCallId: "x" })] }),
		).toEqual({ running: false, endedAt: undefined });
	});

	it("falls back to the turn's start window for disk rows", () => {
		const subagents = [
			sub({ status: "completed", startedAt: T0 + 5_000, endedAt: T0 + 600_000 }),
			sub({ status: "completed", startedAt: T0 + 9_000_000, endedAt: T0 + 9_100_000 }),
		];
		const span = turnSubagentSpan({
			turnStart: T0,
			nextTurnStart: T0 + 3_600_000,
			toolCallIds: new Set(),
			subagents,
		});
		expect(span).toEqual({ running: false, endedAt: T0 + 600_000 });
	});

	it("ignores pending (queued/stale) agents", () => {
		const span = turnSubagentSpan({
			turnStart: T0,
			toolCallIds: new Set(["c1"]),
			subagents: [sub({ status: "pending", parentToolCallId: "c1" })],
		});
		expect(span.running).toBe(false);
	});
});

describe("durationWithSubagents", () => {
	it("extends a 46s parent turn to the last subagent's end", () => {
		const end = T0 + 68_000;
		expect(durationWithSubagents(46_000, end, end + 12 * 60_000)).toBe(46_000 + 12 * 60_000);
	});

	it("is unchanged without subagents or when they ended before the parent", () => {
		expect(durationWithSubagents(46_000, T0, undefined)).toBe(46_000);
		expect(durationWithSubagents(46_000, T0 + 100, T0)).toBe(46_000);
	});
});
