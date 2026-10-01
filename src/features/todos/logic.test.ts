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
			{
				id: "t4",
				kind: "suggestion",
				source: "supervisor",
				status: "ignored",
				sessionId: null,
				title: "Ignored suggestion",
				detail: "",
				payload: {},
				priority: 10,
				createdAt: "2026-09-24T09:10:00Z",
				updatedAt: "2026-09-24T09:40:00Z",
			},
		];

		const { open, closed } = splitTodos(todos);
		expect(open).toHaveLength(2);
		expect(open[0].id).toBe("t2"); // priority 50 before 20
		expect(open[1].id).toBe("t1");
		expect(closed).toHaveLength(2);
		expect(closed[0].id).toBe("t4"); // updatedAt 09:40 before 09:30
		expect(closed[1].id).toBe("t3");
	});
	it("handles sessionId scoping: null returns empty, undefined returns all, string filters", () => {
		const todos: Todo[] = [
			{
				id: "t1",
				kind: "review",
				source: "system",
				status: "open",
				sessionId: "sess-1",
				title: "Review session 1",
				detail: "",
				payload: {},
				priority: 20,
				createdAt: "2026-09-24T10:00:00Z",
				updatedAt: "2026-09-24T10:00:00Z",
			},
			{
				id: "t2",
				kind: "schedule_run",
				source: "schedule",
				status: "open",
				sessionId: "sess-2",
				title: "Scheduled task run",
				detail: "",
				payload: { scheduleId: "sc1", runId: "r1", ok: true },
				priority: 12,
				createdAt: "2026-09-24T10:05:00Z",
				updatedAt: "2026-09-24T10:05:00Z",
			},
		];

		// undefined -> all
		const all = splitTodos(todos, undefined);
		expect(all.open).toHaveLength(2);

		// null -> empty (no session selected)
		const none = splitTodos(todos, null);
		expect(none.open).toHaveLength(0);
		expect(none.closed).toHaveLength(0);

		// string -> specific session
		const sess1 = splitTodos(todos, "sess-1");
		expect(sess1.open).toHaveLength(1);
		expect(sess1.open[0].id).toBe("t1");
	});
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
