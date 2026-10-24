import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatBytes, relativeTime, timeAgo } from "./format";
import { useLanguageStore } from "../stores/language";

const NOW = new Date("2026-06-15T12:00:00").getTime();
const ago = (ms: number) => NOW - ms;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	useLanguageStore.setState({ locale: "zh-CN" });
});
afterEach(() => {
	vi.useRealTimers();
});

describe("formatBytes", () => {
	it("returns a dash for null/undefined", () => {
		expect(formatBytes(null)).toBe("—");
		expect(formatBytes(undefined)).toBe("—");
	});
	it("formats B / KB / MB", () => {
		expect(formatBytes(0)).toBe("0 B");
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(1536)).toBe("1.5 KB");
		expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
	});
});

describe("relativeTime (compact, no 前)", () => {
	it("keeps the short form", () => {
		expect(relativeTime(ago(10_000))).toBe("刚刚");
		expect(relativeTime(ago(5 * MIN))).toBe("5分钟");
		expect(relativeTime(ago(3 * HOUR))).toBe("3小时");
		expect(relativeTime(ago(2 * DAY))).toBe("2天");
		expect(relativeTime(ago(40 * DAY))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(relativeTime("not a date")).toBe("");
	});
	it("supports en-US compact relative time", () => {
		useLanguageStore.setState({ locale: "en-US" });
		expect(relativeTime(ago(10_000))).toBe("just now");
		expect(relativeTime(ago(5 * MIN))).toBe("5m");
		expect(relativeTime(ago(3 * HOUR))).toBe("3h");
		expect(relativeTime(ago(2 * DAY))).toBe("2d");
	});
});

describe("timeAgo", () => {
	it("appends 前 with spaced numbers", () => {
		expect(timeAgo(ago(10_000))).toBe("刚刚");
		expect(timeAgo(ago(-5 * MIN))).toBe("刚刚");
		expect(timeAgo(ago(5 * MIN))).toBe("5 分钟前");
		expect(timeAgo(ago(3 * HOUR))).toBe("3 小时前");
		expect(timeAgo(new Date(ago(2 * DAY)).toISOString())).toBe("2 天前");
		expect(timeAgo(ago(40 * DAY))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(timeAgo("not a date")).toBe("");
	});
});
