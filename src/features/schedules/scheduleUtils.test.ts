import { describe, expect, it } from "vitest";
import type { Schedule } from "../../lib/contracts";
import {
	buildDraft,
	cadenceToModel,
	dateValueToEndOfDay,
	defaultForm,
	deriveName,
	formFromSchedule,
	isRecentRun,
	lifecycleOf,
	presetOfForm,
	renameDraft,
	toLocalInputValue,
	validateForm,
} from "./scheduleUtils";

function futureLocalInput(hoursAhead = 2): string {
	return toLocalInputValue(
		new Date(Date.now() + hoursAhead * 3600_000).toISOString(),
	);
}

describe("lifecycleOf", () => {
	it("derives from enabled when lifecycle is missing", () => {
		expect(lifecycleOf({ enabled: true })).toBe("active");
		expect(lifecycleOf({ enabled: false })).toBe("paused");
	});
	it("prefers the backend lifecycle when present", () => {
		expect(lifecycleOf({ enabled: false, lifecycle: "completed" })).toBe(
			"completed",
		);
		expect(lifecycleOf({ enabled: true, lifecycle: "paused" })).toBe("paused");
	});
});

describe("cadenceToModel", () => {
	it("maps each cadence kind onto the 每 N unit model", () => {
		expect(cadenceToModel({ kind: "interval", minutes: 45 })).toEqual({
			every: 45,
			unit: "minute",
		});
		expect(cadenceToModel({ kind: "interval", minutes: 120 })).toEqual({
			every: 2,
			unit: "hour",
		});
		expect(cadenceToModel({ kind: "daily", time: "09:00" })).toEqual({
			every: 1,
			unit: "day",
		});
		expect(
			cadenceToModel({ kind: "daily", time: "09:00", every: 3 }),
		).toEqual({ every: 3, unit: "day" });
		expect(
			cadenceToModel({
				kind: "daily",
				time: "09:00",
				weekdays: [1, 3],
				every: 2,
			}),
		).toEqual({ every: 2, unit: "week" });
		expect(
			cadenceToModel({ kind: "monthly", day: 15, time: "09:00", every: 2 }),
		).toEqual({ every: 2, unit: "month" });
	});
});

describe("presetOfForm", () => {
	const base = { repeat: "recur" as const, weekdays: [5] };

	it("detects each named preset", () => {
		expect(presetOfForm({ ...base, every: 1, unit: "hour" })).toBe("hourly");
		expect(presetOfForm({ ...base, every: 1, unit: "day" })).toBe("daily");
		expect(
			presetOfForm({ ...base, every: 1, unit: "week", weekdays: [1, 2, 3, 4, 5] }),
		).toBe("weekdays");
		expect(
			presetOfForm({ ...base, every: 1, unit: "week", weekdays: [1, 3] }),
		).toBe("weekly");
		expect(presetOfForm({ ...base, every: 1, unit: "month" })).toBe("monthly");
	});

	it("returns custom for every>1, minute unit, and once", () => {
		expect(presetOfForm({ ...base, every: 2, unit: "hour" })).toBe("custom");
		expect(presetOfForm({ ...base, every: 30, unit: "minute" })).toBe(
			"custom",
		);
		expect(presetOfForm({ ...base, every: 1, unit: "day" })).toBe("daily");
		expect(
			presetOfForm({ ...base, repeat: "once", every: 1, unit: "day" }),
		).toBe("once");
	});
});

describe("validateForm", () => {
	const base = defaultForm("/tmp/proj");
	base.prompt = "do something";
	base.hasSchedule = true;

	it("builds a daily cadence", () => {
		const { cadence, errors } = validateForm(base);
		expect(errors).toEqual({});
		expect(cadence).toEqual({ kind: "daily", time: "09:00", weekdays: [] });
	});

	it("rejects a past or empty once time with the backend message", () => {
		const empty = validateForm({ ...base, repeat: "once", onceAt: "" });
		expect(empty.errors.cadence).toBe("请选择未来的时间");

		const past = validateForm({
			...base,
			repeat: "once",
			onceAt: "2020-01-01T09:00",
		});
		expect(past.errors.cadence).toBe("请选择未来的时间");

		const ok = validateForm({
			...base,
			repeat: "once",
			onceAt: futureLocalInput(),
		});
		expect(ok.cadence?.kind).toBe("once");
		expect(ok.errors.cadence).toBeUndefined();
	});

	it("requires a schedule to be picked on fresh forms", () => {
		const f = defaultForm("/tmp/proj");
		f.prompt = "do something";
		expect(f.hasSchedule).toBe(false);
		const { cadence, errors } = validateForm(f);
		expect(cadence).toBeNull();
		expect(errors.cadence).toBe("请添加计划");
	});

	it("ignores a stray end date while the schedule is still empty", () => {
		const f = {
			...defaultForm("/tmp/proj"),
			prompt: "x",
			endMode: "date" as const,
			endDate: "2020-01-01",
		};
		const { endAt, errors } = validateForm(f);
		expect(errors.cadence).toBe("请添加计划");
		expect(errors.endAt).toBeUndefined();
		expect(endAt).toBeNull();
	});

	it("lets an unchanged past once time pass when editing", () => {
		const { errors, cadence } = validateForm(
			{ ...base, repeat: "once", onceAt: "2020-01-01T09:00" },
			{ onceAtUnchanged: true },
		);
		expect(errors.cadence).toBeUndefined();
		expect(cadence?.kind).toBe("once");
	});

	it("validates week unit needs at least one day", () => {
		const { errors } = validateForm({
			...base,
			unit: "week",
			weekdays: [],
		});
		expect(errors.cadence).toBe("请至少选择一天");
	});

	it("maps every-2-days to daily every=2", () => {
		const { cadence } = validateForm({ ...base, every: 2, unit: "day" });
		expect(cadence).toEqual({
			kind: "daily",
			time: "09:00",
			weekdays: [],
			every: 2,
		});
	});

	it("maps every-3-weeks to daily weekdays every=3", () => {
		const { cadence } = validateForm({
			...base,
			every: 3,
			unit: "week",
			weekdays: [1, 3],
		});
		expect(cadence).toEqual({
			kind: "daily",
			time: "09:00",
			weekdays: [1, 3],
			every: 3,
		});
	});

	it("clamps minute unit to >= 5", () => {
		const bad = validateForm({ ...base, every: 3, unit: "minute" });
		expect(bad.errors.cadence).toBe("间隔至少 5 分钟");
		const ok = validateForm({ ...base, every: 15, unit: "minute" });
		expect(ok.cadence).toEqual({ kind: "interval", minutes: 15 });
	});

	it("maps every-2-hours to interval minutes", () => {
		const { cadence } = validateForm({ ...base, every: 2, unit: "hour" });
		expect(cadence).toEqual({ kind: "interval", minutes: 120 });
	});

	it("rejects non-positive N for other units", () => {
		const bad = validateForm({ ...base, every: 0, unit: "day" });
		expect(bad.errors.cadence).toBe("间隔需为不小于 1 的整数");
	});

	it("builds monthly cadence with every=3", () => {
		const { cadence } = validateForm({
			...base,
			every: 3,
			unit: "month",
			monthDay: 31,
			time: "08:30",
		});
		expect(cadence).toEqual({
			kind: "monthly",
			day: 31,
			time: "08:30",
			every: 3,
		});
	});

	it("validates end date must be in the future", () => {
		const past = validateForm({
			...base,
			endMode: "date",
			endDate: "2020-01-01",
		});
		expect(past.errors.endAt).toBe("结束时间需晚于现在");

		const future = validateForm({
			...base,
			endMode: "date",
			endDate: "2999-12-31",
		});
		expect(future.errors.endAt).toBeUndefined();
		expect(future.endAt).not.toBeNull();
	});

	it("maps 重复 N 次后 to maxRuns", () => {
		const { maxRuns, errors } = validateForm({
			...base,
			endMode: "count",
			endRuns: 10,
		});
		expect(errors.maxRuns).toBeUndefined();
		expect(maxRuns).toBe(10);

		const bad = validateForm({ ...base, endMode: "count", endRuns: 0 });
		expect(bad.errors.maxRuns).toBe("次数需为不小于 1 的整数");
		expect(bad.maxRuns).toBeNull();
	});

	it("ignores end conditions for once cadences", () => {
		const { endAt, maxRuns, errors } = validateForm({
			...base,
			repeat: "once",
			onceAt: futureLocalInput(),
			endMode: "date",
			endDate: "2020-01-01",
		});
		expect(errors.endAt).toBeUndefined();
		expect(errors.maxRuns).toBeUndefined();
		expect(endAt).toBeNull();
		expect(maxRuns).toBeNull();
	});

	it("requires prompt and cwd", () => {
		const { errors } = validateForm({ ...base, prompt: "  ", cwd: "" });
		expect(errors.prompt).toBe("请填写任务指令");
		expect(errors.cwd).toBe("请选择项目目录");
	});
});

describe("deriveName", () => {
	it("uses the first line, clipped", () => {
		expect(deriveName("总结昨天的提交\n更多细节")).toBe("总结昨天的提交");
		const long = "a".repeat(40);
		expect(deriveName(long)).toBe(`${"a".repeat(24)}…`);
	});
	it("falls back to the default name", () => {
		expect(deriveName("   ")).toBe("未命名定时任务");
	});
});

describe("buildDraft", () => {
	const form = {
		...defaultForm("/tmp/x"),
		prompt: "run tests",
		modelSel: "openai/gpt-5:high",
	};
	it("splits the model selector into model + thinking", () => {
		const d = buildDraft(
			form,
			{ kind: "daily", time: "09:00", weekdays: [] },
			null,
		);
		expect(d.model).toBe("openai/gpt-5");
		expect(d.thinking).toBe("high");
		expect(d.name).toBe("run tests");
	});
	it("passes null model for the default", () => {
		const d = buildDraft(
			{ ...form, modelSel: "" },
			{ kind: "daily", time: "09:00", weekdays: [] },
			null,
		);
		expect(d.model).toBeNull();
		expect(d.thinking).toBeNull();
	});
	it("clears endAt and maxRuns for once cadences", () => {
		const d = buildDraft(
			form,
			{ kind: "once", at: new Date(Date.now() + 3600_000).toISOString() },
			"2999-01-01T00:00:00.000Z",
			10,
		);
		expect(d.endAt).toBeNull();
		expect(d.maxRuns).toBeNull();
	});
	it("passes through maxRuns for recurring cadences", () => {
		const d = buildDraft(
			form,
			{ kind: "daily", time: "09:00", weekdays: [] },
			null,
			10,
		);
		expect(d.maxRuns).toBe(10);
	});
	it("passes through notify and newChatEachRun", () => {
		const d = buildDraft(
			{ ...form, notify: "important", newChatEachRun: false },
			{ kind: "daily", time: "09:00", weekdays: [] },
			null,
		);
		expect(d.notify).toBe("important");
		expect(d.newChatEachRun).toBe(false);
	});
});

describe("formFromSchedule", () => {
	const sched = {
		id: "s1",
		name: "n",
		prompt: "p",
		cwd: "/x",
		runMode: "worktree",
		cadence: { kind: "monthly", day: 15, time: "10:30" },
		model: "openai/gpt-5",
		thinking: "high",
		approvalMode: "yolo",
		enabled: true,
		nextRunAt: null,
		lastRunAt: null,
		lastRunStatus: null,
		createdAt: "2026-01-01T00:00:00Z",
		updatedAt: "2026-01-01T00:00:00Z",
		endAt: "2999-10-31T23:59:00Z",
		maxRuns: null,
		runsDone: 0,
		lifecycle: "active",
		notify: "none",
		newChatEachRun: false,
	} satisfies Schedule;

	it("round-trips monthly + end date", () => {
		const f = formFromSchedule(sched);
		expect(f.repeat).toBe("recur");
		expect(f.unit).toBe("month");
		expect(f.every).toBe(1);
		expect(f.monthDay).toBe(15);
		expect(f.time).toBe("10:30");
		expect(f.endMode).toBe("date");
		expect(f.endDate).toBe(toLocalInputValue(sched.endAt).slice(0, 10));
		expect(f.modelSel).toBe("openai/gpt-5:high");
	});

	it("round-trips every-N and maxRuns through validateForm", () => {
		const f = formFromSchedule({
			...sched,
			cadence: { kind: "daily", time: "08:00", weekdays: [1, 3], every: 2 },
			endAt: null,
			maxRuns: 10,
		});
		expect(f.unit).toBe("week");
		expect(f.every).toBe(2);
		expect(f.weekdays).toEqual([1, 3]);
		expect(f.endMode).toBe("count");
		expect(f.endRuns).toBe(10);

		const { cadence, maxRuns, errors } = validateForm(f);
		expect(errors).toEqual({});
		expect(cadence).toEqual({
			kind: "daily",
			time: "08:00",
			weekdays: [1, 3],
			every: 2,
		});
		expect(maxRuns).toBe(10);
	});

	it("carries notify/newChatEachRun and marks the schedule set", () => {
		const f = formFromSchedule(sched);
		expect(f.hasSchedule).toBe(true);
		expect(f.notify).toBe("none");
		expect(f.newChatEachRun).toBe(false);
	});

	it("renameDraft updates the same schedule, changing only its name", () => {
		const paused = { ...sched, enabled: false };
		const d = renameDraft(paused, "AOCI 维护");
		expect(d.id).toBe("s1");
		expect(d.name).toBe("AOCI 维护");
		// A paused task must not be re-enabled by a rename.
		expect(d.enabled).toBe(false);
		expect(d.cadence).toEqual(sched.cadence);
		expect(d.endAt).toBe(sched.endAt);
		expect(d.prompt).toBe("p");
	});
});

describe("isRecentRun", () => {
	const run = {
		id: "r1",
		scheduleId: "s1",
		sessionId: null,
		status: "ok",
		startedAt: new Date(Date.now() - 1000).toISOString(),
		finishedAt: new Date().toISOString(),
		summary: null,
	} as const;

	it("is recent within 24h after finishing", () => {
		expect(isRecentRun(run)).toBe(true);
		expect(
			isRecentRun({ ...run, status: "error" as const }),
		).toBe(true);
	});
	it("is not recent for running/skipped or old runs", () => {
		expect(isRecentRun({ ...run, status: "running" as const })).toBe(false);
		expect(
			isRecentRun({
				...run,
				finishedAt: new Date(Date.now() - 25 * 3600_000).toISOString(),
			}),
		).toBe(false);
		expect(isRecentRun(null)).toBe(false);
	});
});

describe("dateValueToEndOfDay", () => {
	it("parses YYYY-MM-DD to local end of day", () => {
		const d = dateValueToEndOfDay("2026-10-31");
		expect(d?.getHours()).toBe(23);
		expect(d?.getMinutes()).toBe(59);
		expect(dateValueToEndOfDay("bogus")).toBeNull();
	});
});
