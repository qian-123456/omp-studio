import { describe, expect, it } from "vitest";
import type { Todo } from "../../lib/contracts";
import { splitTodos, subagentBucket, subagentCounts } from "./logic";

describe("todos logic", () => {
	it("sorts open todos by priority desc then age asc, and closed ones by updatedAt desc", () => {
		const todos: Todo[] = [
			{
				id: "t1",
				kind: "review",
				source: "system",
				status: "open",
				sessionId: null,
				title: "Review session",
				detail: "",
				payload: {},
				priority: 20,
				createdAt: "2026-09-24T10:00:00Z",
				updatedAt: "2026-09-24T10:00:00Z",
			},
			{
				id: "t2",
				kind: "approval",
				source: "system",
				status: "open",
				sessionId: null,
				title: "Approval required",
				detail: "",
				payload: {},
				priority: 50,
				createdAt: "2026-09-24T10:05:00Z",
				updatedAt: "2026-09-24T10:05:00Z",
			},
			{
				id: "t3",
				kind: "error",
				source: "system",
				status: "done",
				sessionId: null,
				title: "Fixed error",
				detail: "",
				payload: {},
				priority: 30,
				createdAt: "2026-09-24T09:00:00Z",
				updatedAt: "2026-09-24T09:30:00Z",
			},
		];

		const { open, closed } = splitTodos(todos);
		expect(open).toHaveLength(2);
		expect(open[0].id).toBe("t2"); // priority 50 before 20
		expect(open[1].id).toBe("t1");
		expect(closed).toHaveLength(1);
		expect(closed[0].id).toBe("t3");
	});

	it("buckets subagent statuses correctly", () => {
		expect(subagentBucket("running")).toBe("running");
		expect(subagentBucket("completed")).toBe("done");
		expect(subagentBucket("failed")).toBe("failed");
		expect(subagentBucket("aborted")).toBe("failed");

		const counts = subagentCounts({
			s1: { id: "s1", label: "Subagent 1", status: "running" },
			s2: { id: "s2", label: "Subagent 2", status: "finished" },
			s3: { id: "s3", label: "Subagent 3", status: "error" },
		});
		expect(counts).toEqual({ running: 1, done: 1, failed: 1 });
	});
});
