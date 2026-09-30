import { describe, expect, it } from "vitest";
import { formatCadence, formatRelativeTime } from "./humanCadence";

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
});

describe("formatRelativeTime", () => {
	it("handles null or empty", () => {
		expect(formatRelativeTime(null)).toBe("从未运行");
		expect(formatRelativeTime(undefined)).toBe("从未运行");
	});
});
