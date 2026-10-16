import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import type { SessionLive } from "../../stores/live";
import {
	computeHeatmapBadge,
	computeSidechatBadge,
} from "./useTabBadges";

describe("useTabBadges pure compute functions", () => {
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
