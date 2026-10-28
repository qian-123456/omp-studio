import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date(2026, 9, 29, 12));
});
afterEach(() => vi.useRealTimers());

describe("groupByTime", () => {
	it("groups sessions into today, yesterday, this calendar week, and earlier", () => {
		const now = new Date();
		const todayIso = new Date(now.getTime() - 1000 * 60).toISOString();
		const yesterdayIso = new Date(now.getTime() - 86400000).toISOString();
		const twoDaysAgoIso = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 2, 12).toISOString();
		const twoWeeksAgoIso = new Date(now.getTime() - 86400000 * 14).toISOString();

		const sessions: TreeSession[] = [
			makeSession("s1", todayIso),
			makeSession("s2", yesterdayIso),
			makeSession("s3", twoDaysAgoIso),
			makeSession("s4", twoWeeksAgoIso),
			makeSession("s_archived", todayIso, true),
		];

		const groups = groupByTime(sessions);
		expect(groups.map((g) => g.label)).toEqual(["今天", "昨天", "本周", "更早"]);
		expect(groups[0].sessions.map((s) => s.id)).toEqual(["s1"]);
		expect(groups[1].sessions.map((s) => s.id)).toEqual(["s2"]);
		expect(groups[2].sessions.map((s) => s.id)).toEqual(["s3"]);
		expect(groups[3].sessions.map((s) => s.id)).toEqual(["s4"]);
	});

	it("puts the previous Sunday into 更早, not 本周, and sorts newest first", () => {
		const groups = groupByTime([
			makeSession("sunday", new Date(2026, 9, 25, 20).toISOString()),
			makeSession("monday", new Date(2026, 9, 26, 9).toISOString()),
			makeSession("tuesday", new Date(2026, 9, 27, 9).toISOString()),
		]);
		expect(groups.map((g) => g.label)).toEqual(["本周", "更早"]);
		expect(groups[0].sessions.map((s) => s.id)).toEqual(["tuesday", "monday"]);
		expect(groups[1].sessions[0].id).toBe("sunday");
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
