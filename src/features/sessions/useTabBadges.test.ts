import { describe, expect, it } from "vitest";
import type { SessionMeta, Todo as TodoItem } from "../../lib/contracts";
import type { SessionLive } from "../../stores/live";
import {
	computeHeatmapBadge,
	computeSidechatBadge,
	computeTodosBadge,
} from "./useTabBadges";

describe("useTabBadges pure compute functions", () => {
	it("computeTodosBadge returns active session open count or fallback to global open", () => {
		const todos: TodoItem[] = [
			{
				id: "t1",
				sessionId: "s1",
				status: "open",
				kind: "review",
				source: "system",
				title: "Review",
				detail: "",
				priority: 1,
				payload: {},
				createdAt: "1",
				updatedAt: "1",
			},
			{
				id: "t2",
				sessionId: "s2",
				status: "open",
				kind: "error",
				source: "system",
				title: "Error",
				detail: "",
				priority: 1,
				payload: {},
				createdAt: "2",
				updatedAt: "2",
			},
		];
		const counts = { open: 2 };

		// Session s1 has 1 open todo
		expect(computeTodosBadge(counts, todos, "s1")).toBe(1);

		// Session s2 has 1 open todo
		expect(computeTodosBadge(counts, todos, "s2")).toBe(1);

		// Session s3 has 0 open todos, falls back to total open count
		expect(computeTodosBadge(counts, todos, "s3")).toBe(2);

		// When no session selected (null), returns total open count
		expect(computeTodosBadge(counts, todos, null)).toBe(2);
	});

	it("computeSidechatBadge counts sidechats belonging to selectedSessionId", () => {
		const sessions: Record<string, SessionMeta> = {
			s1: { id: "s1", parentId: null } as unknown as SessionMeta,
			s1_child1: { id: "s1_child1", parentId: "s1" } as unknown as SessionMeta,
			s1_child2: { id: "s1_child2", parentId: "s1" } as unknown as SessionMeta,
			s2_child: { id: "s2_child", parentId: "s2" } as unknown as SessionMeta,
		};

		expect(computeSidechatBadge(sessions, "s1")).toBe(2);
		expect(computeSidechatBadge(sessions, "s2")).toBe(1);
		expect(computeSidechatBadge(sessions, "s3")).toBe(0);
		expect(computeSidechatBadge(sessions, null)).toBe(0);
	});

	it("computeHeatmapBadge counts items for selected session", () => {
		const liveSession = {
			items: [
				{ id: "m1" },
				{ id: "m2" },
				{ id: "m3" },
			],
		} as unknown as SessionLive;

		expect(computeHeatmapBadge(liveSession)).toBe(3);
		expect(computeHeatmapBadge(undefined)).toBe(0);
	});
});
