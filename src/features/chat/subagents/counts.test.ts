import { describe, expect, it } from "vitest";
import { subagentBucket, subagentCounts } from "./counts";

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
		expect(counts).toEqual({ running: 1, done: 1, failed: 1 });
	});
});
