import { describe, expect, it } from "vitest";
import {
	formatCadence,
	formatCadenceWithEnd,
	formatNextRun,
	formatRelativeTime,
} from "./humanCadence";

describe("formatCadence", () => {
	it("formats intervals", () => {
		expect(formatCadence({ kind: "interval", minutes: 30 })).toBe("每 30 分钟");
		expect(formatCadence({ kind: "interval", minutes: 60 })).toBe("每 1 小时");
		expect(formatCadence({ kind: "interval", minutes: 120 })).toBe("每 2 小时");
		expect(formatCadence({ kind: "interval", minutes: 4 })).toBe("每 5 分钟"); // clamped
	});

	it("formats daily every day", () => {
		expect(formatCadence({ kind: "daily", time: "09:00" })).toBe("每天 09:00");
		expect(formatCadence({ kind: "daily", time: "09:00", weekdays: [] })).toBe(
			"每天 09:00",
		);
		expect(
			formatCadence({
				kind: "daily",
				time: "09:00",
				weekdays: [0, 1, 2, 3, 4, 5, 6],
			}),
		).toBe("每天 09:00");
	});

	it("formats workdays", () => {
		expect(
			formatCadence({
				kind: "daily",
				time: "18:00",
				weekdays: [1, 2, 3, 4, 5],
			}),
		).toBe("工作日 18:00");
	});

	it("formats weekends", () => {
		expect(
			formatCadence({
				kind: "daily",
				time: "10:00",
				weekdays: [0, 6],
			}),
		).toBe("周末 10:00");
	});

	it("formats specific days", () => {
		expect(
			formatCadence({
				kind: "daily",
				time: "09:30",
				weekdays: [1, 3],
			}),
		).toBe("周一、周三 09:30");
	});

	it("formats monthly", () => {
		expect(formatCadence({ kind: "monthly", day: 15, time: "09:00" })).toBe(
			"每月 15 日 · 09:00",
		);
		expect(formatCadence({ kind: "monthly", day: 1, time: "08:30" })).toBe(
			"每月 1 日 · 08:30",
		);
	});

	it("formats once with local date and time", () => {
		const at = new Date(2026, 9, 15, 9, 0, 0).toISOString();
		expect(formatCadence({ kind: "once", at })).toBe(
			"一次 · 2026年10月15日 09:00",
		);
	});

	it("handles invalid once date", () => {
		expect(formatCadence({ kind: "once", at: "not-a-date" })).toBe("一次");
	});

	it("formats every-N intervals", () => {
		expect(formatCadence({ kind: "interval", minutes: 90 })).toBe("每 90 分钟");
		expect(formatCadence({ kind: "interval", minutes: 180 })).toBe("每 3 小时");
	});

	it("formats every-N days", () => {
		expect(
			formatCadence({ kind: "daily", time: "09:00", every: 2 }),
		).toBe("每 2 天 09:00");
	});

	it("formats every-N weeks with weekday names", () => {
		expect(
			formatCadence({
				kind: "daily",
				time: "09:00",
				weekdays: [1, 3],
				every: 2,
			}),
		).toBe("每 2 周的周一、周三 09:00");
		expect(
			formatCadence({
				kind: "daily",
				time: "18:00",
				weekdays: [1, 2, 3, 4, 5],
				every: 2,
			}),
		).toBe("每 2 周的工作日 18:00");
	});

	it("formats every-N months", () => {
		expect(
			formatCadence({ kind: "monthly", day: 1, time: "09:00", every: 3 }),
		).toBe("每 3 个月 1 日 · 09:00");
	});
});

describe("formatCadenceWithEnd", () => {
	it("appends end date for recurring cadences", () => {
		const endAt = new Date(2026, 9, 31, 23, 59).toISOString();
		expect(
			formatCadenceWithEnd({ kind: "daily", time: "09:00" }, endAt),
		).toBe("每天 09:00 · 至 10月31日");
		expect(
			formatCadenceWithEnd({ kind: "interval", minutes: 60 }, endAt),
		).toBe("每 1 小时 · 至 10月31日");
	});

	it("appends a run cap and combines with end date", () => {
		expect(
			formatCadenceWithEnd({ kind: "daily", time: "09:00" }, null, 10),
		).toBe("每天 09:00 · 共 10 次");
		const endAt = new Date(2026, 9, 31, 23, 59).toISOString();
		expect(
			formatCadenceWithEnd({ kind: "daily", time: "09:00" }, endAt, 10),
		).toBe("每天 09:00 · 共 10 次 · 至 10月31日");
	});

	it("ignores endAt for once and null", () => {
		const endAt = new Date(2026, 9, 31).toISOString();
		const once = formatCadence({ kind: "once", at: endAt });
		expect(formatCadenceWithEnd({ kind: "once", at: endAt }, endAt)).toBe(once);
		expect(
			formatCadenceWithEnd({ kind: "once", at: endAt }, endAt, 5),
		).toBe(once);
		expect(formatCadenceWithEnd({ kind: "daily", time: "09:00" }, null)).toBe(
			"每天 09:00",
		);
	});
});

describe("formatRelativeTime", () => {
	it("handles null or empty", () => {
		expect(formatRelativeTime(null)).toBe("从未运行");
		expect(formatRelativeTime(undefined)).toBe("从未运行");
	});
});

describe("formatNextRun", () => {
	const now = new Date(2026, 9, 12, 10, 0, 0); // Oct 12 2026, 10:00 local

	it("returns null for missing, invalid, or past times", () => {
		expect(formatNextRun(null, now)).toBeNull();
		expect(formatNextRun(undefined, now)).toBeNull();
		expect(formatNextRun("garbage", now)).toBeNull();
		expect(
			formatNextRun(new Date(2026, 9, 12, 9, 0).toISOString(), now),
		).toBeNull();
	});

	it("formats sub-minute and sub-hour deltas", () => {
		expect(
			formatNextRun(new Date(now.getTime() + 30_000).toISOString(), now),
		).toBe("即将运行");
		expect(
			formatNextRun(new Date(now.getTime() + 45 * 60_000).toISOString(), now),
		).toBe("45 分钟后");
	});

	it("formats hours within the same day", () => {
		expect(
			formatNextRun(
				new Date(now.getTime() + 2 * 3600_000).toISOString(),
				now,
			),
		).toBe("2 小时后");
		expect(
			formatNextRun(
				new Date(now.getTime() + 90 * 60_000).toISOString(),
				now,
			),
		).toBe("1 小时 30 分钟后");
	});

	it("formats tomorrow and later days", () => {
		expect(
			formatNextRun(new Date(2026, 9, 13, 9, 0).toISOString(), now),
		).toBe("明天 09:00");
		expect(
			formatNextRun(new Date(2026, 9, 14, 9, 0).toISOString(), now),
		).toBe("后天 09:00");
		expect(
			formatNextRun(new Date(2026, 9, 20, 9, 0).toISOString(), now),
		).toBe("8 天后");
	});
});

describe("humanCadence en-US", () => {
	it("formats intervals", () => {
		expect(formatCadence({ kind: "interval", minutes: 30 }, "en-US")).toBe(
			"Every 30 minutes",
		);
		expect(formatCadence({ kind: "interval", minutes: 60 }, "en-US")).toBe(
			"Every hour",
		);
		expect(formatCadence({ kind: "interval", minutes: 120 }, "en-US")).toBe(
			"Every 2 hours",
		);
	});

	it("formats daily and weekdays", () => {
		expect(
			formatCadence({ kind: "daily", time: "09:00" }, "en-US"),
		).toBe("Daily at 09:00");
		expect(
			formatCadence(
				{ kind: "daily", time: "18:00", weekdays: [1, 2, 3, 4, 5] },
				"en-US",
			),
		).toBe("Weekdays at 18:00");
		expect(
			formatCadence(
				{ kind: "daily", time: "10:00", weekdays: [0, 6] },
				"en-US",
			),
		).toBe("Weekends at 10:00");
		expect(
			formatCadence(
				{ kind: "daily", time: "09:30", weekdays: [1, 3] },
				"en-US",
			),
		).toBe("Every Mon, Wed at 09:30");
	});

	it("formats monthly and once", () => {
		expect(
			formatCadence({ kind: "monthly", day: 15, time: "09:00" }, "en-US"),
		).toBe("Monthly on day 15 · 09:00");
		const at = new Date(2026, 9, 15, 9, 0, 0).toISOString();
		expect(formatCadence({ kind: "once", at }, "en-US")).toBe(
			"Once · Oct 15, 2026 09:00",
		);
	});

	it("formats end conditions", () => {
		const endAt = new Date(2026, 9, 31, 23, 59).toISOString();
		expect(
			formatCadenceWithEnd(
				{ kind: "daily", time: "09:00" },
				endAt,
				10,
				"en-US",
			),
		).toBe("Daily at 09:00 · 10 runs total · until Oct 31");
	});

	it("formats relative time", () => {
		expect(formatRelativeTime(null, "en-US")).toBe("Never run");
	});
});
