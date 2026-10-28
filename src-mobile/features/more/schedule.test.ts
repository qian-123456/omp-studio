import { describe, expect, it } from "vitest";
import {
	buildPayload,
	cadenceText,
	emptyForm,
	formFromSchedule,
	parseModel,
	runDurationText,
	scheduleMeta,
	validateForm,
} from "./schedule";
import type { Schedule } from "./schedule";

const base: Schedule = {
	id: "s1",
	name: "晨报",
	prompt: "总结昨天",
	cwd: "/w",
	runMode: "local",
	cadence: { kind: "daily", time: "09:00", weekdays: [1, 3], every: 2, anchor: "2026-01-05" },
	model: "anthropic/claude",
	thinking: "high",
	approvalMode: "yolo",
	enabled: true,
	nextRunAt: null,
	lastRunAt: null,
	lastRunStatus: "ok",
	notify: "important",
	newChatEachRun: false,
	endAt: null,
	lifecycle: "active",
	maxRuns: 5,
	runsDone: 2,
};

describe("schedule form", () => {
	it("round-trips an existing schedule without changing cadence, anchor or hidden fields", () => {
		const payload = buildPayload(formFromSchedule(base), base);
		expect(payload).toMatchObject({
			id: "s1",
			cadence: { kind: "daily", time: "09:00", weekdays: [1, 3], every: 2, anchor: "2026-01-05" },
			approvalMode: "yolo",
			model: "anthropic/claude",
			thinking: "high",
			newChatEachRun: false,
			notify: "important",
			maxRuns: 5,
			endAt: null,
		});
	});

	it("maps interval units to minutes and restores the unit when editing", () => {
		const f = { ...emptyForm("/w"), name: "a", prompt: "b", kind: "interval" as const, ivNum: "2", ivUnit: "hour" as const };
		expect(buildPayload(f).cadence).toEqual({ kind: "interval", minutes: 120 });
		const back = formFromSchedule({ ...base, cadence: { kind: "interval", minutes: 90 } });
		expect([back.ivNum, back.ivUnit]).toEqual(["90", "min"]);
	});

	it("drops end/max for one-shot schedules and clears thinking without a model", () => {
		const f = {
			...emptyForm("/w"),
			name: "a",
			prompt: "b",
			kind: "once" as const,
			at: "2026-03-01T08:30",
			endAt: "2026-04-01T00:00",
			maxRuns: "3",
			thinking: "high",
		};
		const p = buildPayload(f);
		expect(p).toMatchObject({ endAt: null, maxRuns: null, thinking: null });
		expect((p.cadence as { at: string }).at).toBe(new Date("2026-03-01T08:30").toISOString());
	});

	it("reports every invalid field with a full message", () => {
		const f = { ...emptyForm(""), kind: "monthly" as const, mday: "40", mTime: "", maxRuns: "0" };
		const e = validateForm(f);
		expect(Object.keys(e).sort()).toEqual(["cwd", "mTime", "maxRuns", "mday", "name", "prompt"]);
		expect(validateForm({ ...emptyForm("/w"), name: "a", prompt: "b", kind: "daily", maxRuns: "1.5" })).toEqual({
			maxRuns: "最多运行次数需为不小于 1 的整数，留空表示不限",
		});
		expect(validateForm({ ...emptyForm("/w"), name: "a", prompt: "b", kind: "interval", ivNum: "0" }).iv).toBeTruthy();
		expect(validateForm({ ...emptyForm("/w"), name: "a", prompt: "b", kind: "once", at: "" }).at).toBeTruthy();
	});

	it("sorts and dedupes weekdays", () => {
		const f = { ...emptyForm("/w"), name: "a", prompt: "b", weekdays: [3, 1, 3] };
		expect((buildPayload(f).cadence as { weekdays: number[] }).weekdays).toEqual([1, 3]);
	});
});

describe("schedule text", () => {
	it("describes cadences", () => {
		expect(cadenceText({ kind: "interval", minutes: 120 })).toBe("每 2 小时");
		expect(cadenceText({ kind: "interval", minutes: undefined as unknown as number })).toBe("周期未设置");
		expect(cadenceText({ kind: "interval", minutes: 0 })).toBe("周期未设置");
		expect(cadenceText({ kind: "interval", minutes: -1 })).toBe("周期未设置");
		expect(cadenceText({ kind: "interval", minutes: 45 })).toBe("每 45 分钟");
		expect(cadenceText(base.cadence)).toBe("每 2 周 周一、周三 09:00");
		expect(cadenceText({ kind: "daily", time: "07:30" })).toBe("每天 07:30");
		expect(cadenceText({ kind: "monthly", day: 5, time: "10:00", every: 3 })).toBe("每 3 月 5 日 10:00");
	});

	it("builds the row meta line", () => {
		expect(scheduleMeta({ ...base, nextRunAt: "2026-01-02T03:04:00" })).toBe("下次 1-02 03:04 · 上次成功 · 2/5 次");
		expect(scheduleMeta({ ...base, enabled: false, lifecycle: "paused", lastRunStatus: null, maxRuns: null })).toBe("");
	});

	it("formats run history durations", () => {
		expect(runDurationText({ startedAt: "2026-01-01T00:00:00Z", finishedAt: "2026-01-01T00:01:05Z" })).toBe("耗时 1m 05s");
		expect(runDurationText({ startedAt: "2026-01-01T00:00:00Z", finishedAt: null })).toBe("");
		expect(runDurationText({ startedAt: "bad", finishedAt: "2026-01-01T00:00:00Z" })).toBe("");
	});

	it("matches stored model strings against the catalog", () => {
		const models = [{ provider: "p", id: "m1" }];
		expect(parseModel("p/m1", models)).toEqual({ provider: "p", modelId: "m1" });
		expect(parseModel("gone/x", models)).toBeNull();
	});
});
