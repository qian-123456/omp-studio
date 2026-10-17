import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { DEFAULT_REQUEST_STAT_FIELDS } from "../../stores/displayPrefs";
import {
	aggregateRequestStats,
	formatRequestStat,
	type RequestStat,
	requestStatFromItem,
	requestStatFromMessage,
} from "./requestStats";

const ALL_FIELDS = Object.fromEntries(
	Object.keys(DEFAULT_REQUEST_STAT_FIELDS).map((k) => [k, true]),
) as typeof DEFAULT_REQUEST_STAT_FIELDS;

const assistant = (over: Partial<TranscriptItem>): TranscriptItem => ({
	id: "a1",
	parentId: null,
	ts: "2026-10-17T04:47:27.600Z",
	kind: "assistant",
	text: null,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
	...over,
});

const text = (stat: RequestStat, fields = ALL_FIELDS) =>
	formatRequestStat(stat, fields).map((p) => `${p.glyph}${p.text}`);

describe("requestStats", () => {
	it("formats a real omp message like the TUI line", () => {
		const completedAt = new Date(2026, 9, 17, 12, 47, 30).getTime();
		const stat = requestStatFromMessage(
			{
				completedAt,
				duration: 6967,
				ttft: 2350,
				usage: {
					input: 2,
					output: 306,
					cacheRead: 27_400,
					cacheWrite: 3592,
					totalTokens: 31_300,
					cost: { input: 0.01, total: 0.0691 },
				},
			},
			0,
		);
		expect(text(stat)).toEqual([
			"12:47:23",
			"↘3.6K",
			"↗306",
			"💾27K",
			"⏱2.4s",
			"⚡43.9/s",
			"⌛7.0s",
			"$0.069",
		]);
	});

	it("shows — for timing fields an old session never recorded", () => {
		const stat = requestStatFromItem(
			assistant({
				usage: { input: 16_000, output: 235, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0 },
			}),
		);
		expect(stat).not.toBeNull();
		const parts = text(stat!);
		expect(parts[1]).toBe("↘16K");
		expect(parts.slice(4, 7)).toEqual(["⏱—", "⚡—", "⌛—"]);
	});

	it("ignores non-assistant items and respects disabled fields", () => {
		expect(requestStatFromItem(assistant({ kind: "user" }))).toBeNull();
		const stat = requestStatFromItem(assistant({ duration: 1000, ttft: 500 }))!;
		expect(formatRequestStat(stat, DEFAULT_REQUEST_STAT_FIELDS).map((p) => p.field)).toEqual([
			"time",
			"input",
			"output",
			"cache",
			"ttft",
			"tps",
		]);
	});

	it("averages speed only over requests with a duration", () => {
		const u = (output: number) => ({ input: 10, output, cacheRead: 0, cacheWrite: 5, totalTokens: 0, cost: 0.5 });
		const totals = aggregateRequestStats([
			{ startedAt: 0, completedAt: 0, durationMs: 2000, ttftMs: null, usage: u(100) },
			{ startedAt: 0, completedAt: 0, durationMs: null, ttftMs: null, usage: u(900) },
		]);
		expect(totals).toMatchObject({ count: 2, input: 30, output: 1000, cost: 1, avgTps: 50 });
	});
});
