import { describe, expect, it } from "vitest";
import { groupByTime } from "./ChronologicalView";
import type { TreeSession } from "./tree";

const makeSession = (id: string, updatedAt: string, archived = false): TreeSession => ({
	id,
	label: id,
	title: `Session ${id}`,
	status: "idle",
	updatedAt,
	cwd: "/w",
	live: false,
	archived,
});

describe("groupByTime", () => {
	it("groups sessions chronologically into today, yesterday, 7 days, and earlier", () => {
		const now = new Date();
		const todayIso = new Date(now.getTime() - 1000 * 60).toISOString();
		const yesterdayIso = new Date(now.getTime() - 86400000).toISOString();
		const fourDaysAgoIso = new Date(now.getTime() - 86400000 * 4).toISOString();
		const twoWeeksAgoIso = new Date(now.getTime() - 86400000 * 14).toISOString();

		const sessions: TreeSession[] = [
			makeSession("s1", todayIso),
			makeSession("s2", yesterdayIso),
			makeSession("s3", fourDaysAgoIso),
			makeSession("s4", twoWeeksAgoIso),
			makeSession("s_archived", todayIso, true),
		];

		const groups = groupByTime(sessions);
		expect(groups.map((g) => g.label)).toEqual(["今天", "昨天", "7 天内", "更早"]);
		expect(groups[0].sessions.map((s) => s.id)).toEqual(["s1"]);
		expect(groups[1].sessions.map((s) => s.id)).toEqual(["s2"]);
		expect(groups[2].sessions.map((s) => s.id)).toEqual(["s3"]);
		expect(groups[3].sessions.map((s) => s.id)).toEqual(["s4"]);
	});

	it("omits empty groups and skips archived sessions", () => {
		const now = new Date();
		const todayIso = new Date(now.getTime() - 1000 * 60).toISOString();
		const sessions: TreeSession[] = [
			makeSession("s1", todayIso),
			makeSession("s2", todayIso, true),
		];

		const groups = groupByTime(sessions);
		expect(groups).toHaveLength(1);
		expect(groups[0].label).toBe("今天");
		expect(groups[0].sessions).toHaveLength(1);
		expect(groups[0].sessions[0].id).toBe("s1");
	});
});
