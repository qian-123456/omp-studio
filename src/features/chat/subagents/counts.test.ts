import { describe, expect, it } from "vitest";
import { countStatuses, subagentBucket, subagentCounts } from "./counts";

describe("subagent counts", () => {
	it("buckets subagent statuses correctly", () => {
		expect(subagentBucket("running")).toBe("running");
		expect(subagentBucket("completed")).toBe("done");
		expect(subagentBucket("failed")).toBe("failed");
		expect(subagentBucket("aborted")).toBe("failed");
		expect(subagentBucket("error")).toBe("failed");
		expect(subagentBucket("cancelled")).toBe("failed");
		expect(subagentBucket("killed")).toBe("failed");
		expect(subagentBucket("succeeded")).toBe("done");
		expect(subagentBucket("working")).toBe("running");
		const counts = subagentCounts({
			s1: { label: "Subagent 1", status: "running" },
			s2: { label: "Subagent 2", status: "completed" },
			s3: { label: "Subagent 3", status: "failed" },
		});
		expect(counts).toEqual({ running: 1, queued: 0, done: 1, failed: 1 });
		expect(subagentBucket("pending")).toBe("queued");
		expect(
			subagentCounts({
				a: { label: "a", status: "pending" },
				b: { label: "b", status: "completed" },
			}),
		).toEqual({ running: 0, queued: 1, done: 1, failed: 0 });
	});

	it("task card: all-pending rows count as queued (派发中), not running", () => {
		expect(countStatuses(Array(6).fill("pending"))).toEqual({ running: 0, queued: 6, done: 0, failed: 0 });
		expect(countStatuses(["pending", "running", "completed", "failed"])).toEqual({
			running: 1,
			queued: 1,
			done: 1,
			failed: 1,
		});
	});
});
