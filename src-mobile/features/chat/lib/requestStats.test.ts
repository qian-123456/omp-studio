import { describe, expect, it } from "vitest";
import {
	MISSING,
	buildStat,
	fieldText,
	formatRequestStat,
	formatStatDateTime,
	formatStatTokens,
	requestStatFromItem,
	requestStatFromMessage,
	tokensPerSecond,
	ttftSplit,
} from "./requestStats";

const usage = { input: 1000, output: 500, cacheRead: 16000, cacheWrite: 300, totalTokens: 17800, cost: 0.0123 };

describe("formatStatTokens", () => {
	it("compacts like the TUI", () => {
		expect(formatStatTokens(235)).toBe("235");
		expect(formatStatTokens(1300)).toBe("1.3K");
		expect(formatStatTokens(16000)).toBe("16K");
		expect(formatStatTokens(1200000)).toBe("1.2M");
		expect(formatStatTokens(Number.NaN)).toBe(MISSING);
	});
});

describe("stats", () => {
	it("derives startedAt from completedAt - duration", () => {
		expect(buildStat(10000, 4000, null, null).startedAt).toBe(6000);
		expect(buildStat(10000, null, null, null).startedAt).toBe(10000);
	});

	it("computes tokens per second", () => {
		expect(tokensPerSecond(buildStat(1, 2000, null, usage))).toBe(250);
		expect(tokensPerSecond(buildStat(1, null, null, usage))).toBeNull();
		expect(tokensPerSecond(buildStat(1, 0, null, usage))).toBeNull();
	});

	it("builds from assistant items only and falls back to ts", () => {
		expect(requestStatFromItem({ kind: "user" })).toBeNull();
		const s = requestStatFromItem({ kind: "assistant", ts: "2026-01-01T00:00:10.000Z", duration: 4000, usage });
		expect(s?.completedAt).toBe(Date.parse("2026-01-01T00:00:10.000Z"));
		expect(s?.startedAt).toBe((s?.completedAt ?? 0) - 4000);
		expect(requestStatFromItem({ kind: "assistant", ts: "bad" })?.completedAt).toBeNull();
	});

	it("reads cost objects from raw messages", () => {
		const s = requestStatFromMessage({ timestamp: 5, usage: { cost: { total: 2.5 } } });
		expect(s.usage?.cost).toBe(2.5);
		expect(s.completedAt).toBe(5);
		expect(requestStatFromMessage({}, 9).completedAt).toBe(9);
	});

	it("formats fields, with cost digits and missing values", () => {
		const s = buildStat(100000, 2000, 400, usage);
		expect(fieldText(s, "input")).toBe("1.3K");
		expect(fieldText(s, "cache")).toBe("16K");
		expect(fieldText(s, "ttft")).toBe("0.4s");
		expect(fieldText(s, "tps")).toBe("250.0/s");
		expect(fieldText(s, "cost")).toBe("0.012");
		expect(fieldText({ ...s, usage: { ...usage, cost: 3.456 } }, "cost")).toBe("3.46");
		const empty = buildStat(null, null, null, null);
		expect(fieldText(empty, "time")).toBeNull();
		expect(formatRequestStat(empty).map((p) => p.text)).toEqual(Array(6).fill(MISSING));
	});

	it("formats local date-time", () => {
		expect(formatStatDateTime(new Date(2026, 9, 16, 12, 47, 23).getTime())).toBe("2026年10月16日 12:47:23");
	});
});

describe("ttftSplit", () => {
	it("clamps the wait share", () => {
		expect(ttftSplit(buildStat(1, 4000, 1000, null))).toEqual({ ttftMs: 1000, generationMs: 3000, waitPercent: 25 });
		expect(ttftSplit(buildStat(1, 1000, 1000, null))?.waitPercent).toBe(98);
		expect(ttftSplit(buildStat(1, 10000, 1, null))?.waitPercent).toBe(2);
		expect(ttftSplit(buildStat(1, null, 1000, null))).toBeNull();
		expect(ttftSplit(buildStat(1, 1000, null, null))).toBeNull();
	});
});
