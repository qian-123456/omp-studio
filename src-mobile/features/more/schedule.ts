import { formatDuration } from "../../core/lib/format";

export type CadenceKind = "interval" | "daily" | "once" | "monthly";
export type RunMode = "local" | "worktree";
export type NotifyMode = "all" | "important" | "none";

export type Cadence =
	| { kind: "interval"; minutes: number }
	| { kind: "daily"; time: string; weekdays?: number[]; every?: number; anchor?: string }
	| { kind: "once"; at: string }
	| { kind: "monthly"; day: number; time: string; every?: number; anchor?: string };

export interface Schedule {
	id: string;
	name: string;
	prompt: string;
	cwd: string;
	runMode: RunMode;
	cadence: Cadence;
	model: string | null;
	thinking: string | null;
	approvalMode: string | null;
	enabled: boolean;
	nextRunAt: string | null;
	lastRunAt: string | null;
	lastRunStatus: RunStatus | null;
	notify: NotifyMode;
	newChatEachRun: boolean;
	endAt: string | null;
	lifecycle: "active" | "paused" | "completed";
	maxRuns: number | null;
	runsDone: number;
}

export type RunStatus = "running" | "ok" | "error" | "skipped";

export interface ScheduleRun {
	id: string;
	scheduleId: string;
	sessionId: string | null;
	status: RunStatus;
	startedAt: string;
	finishedAt: string | null;
	summary: string | null;
}

export const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
export const RUN_STATUS_LABEL: Record<string, string> = { running: "运行中", ok: "成功", error: "失败", skipped: "跳过" };
export const LIFECYCLE_LABEL: Record<string, string> = { active: "进行中", paused: "已暂停", completed: "已完成" };
export const KIND_LABEL: Record<CadenceKind, string> = { interval: "间隔", daily: "每天/周", once: "仅一次", monthly: "每月" };
export const NOTIFY_LABEL: Record<NotifyMode, string> = { all: "全部", important: "仅重要", none: "不通知" };
export const NOTIFY_HINT: Record<NotifyMode, string> = {
	all: "每次运行结束都通知",
	important: "仅在失败或需要回复时通知",
	none: "从不通知",
};
export const RUN_MODE_LABEL: Record<RunMode, string> = { local: "直接运行", worktree: "新建工作树" };
export const RUN_MODE_HINT: Record<RunMode, string> = {
	local: "在所选目录中直接运行",
	worktree: "每次运行新建一个 Git 工作树，互不影响",
};

const pad = (n: number): string => String(n).padStart(2, "0");

/** "M-DD HH:mm" in local time, "" for an unparsable instant. */
export function fmtTime(iso: string | null | undefined): string {
	const d = new Date(iso ?? "");
	return Number.isNaN(d.getTime()) ? "" : `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Value for `<input type="datetime-local">` (local time) from an RFC3339 instant. */
export function toLocalInput(iso: string | null | undefined): string {
	const d = new Date(iso ?? "");
	return Number.isNaN(d.getTime())
		? ""
		: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Human description of a cadence, e.g. "每 2 小时", "每周 周一、周三 09:00". */
export function cadenceText(c: Cadence | null | undefined): string {
	if (!c) return "";
	switch (c.kind) {
		case "interval":
			if (!Number.isFinite(c.minutes) || c.minutes < 1) return "周期未设置";
			return c.minutes % 60 === 0 ? `每 ${c.minutes / 60} 小时` : `每 ${c.minutes} 分钟`;
		case "daily": {
			const wd = c.weekdays ?? [];
			const ev = c.every ?? 1;
			if (wd.length) return `每${ev > 1 ? ` ${ev} ` : ""}周 ${wd.map((d) => `周${WEEK[d % 7]}`).join("、")} ${c.time}`;
			return `${ev > 1 ? `每 ${ev} 天` : "每天"} ${c.time}`;
		}
		case "once":
			return `一次 · ${fmtTime(c.at)}`;
		case "monthly":
			return `每${(c.every ?? 1) > 1 ? ` ${c.every} ` : ""}月 ${c.day} 日 ${c.time}`;
	}
	return "";
}

/* ---------------------------------------------------------------- form <-> payload */

export interface ScheduleForm {
	name: string;
	prompt: string;
	cwd: string;
	runMode: RunMode;
	kind: CadenceKind;
	ivNum: string;
	ivUnit: "min" | "hour";
	time: string;
	every: string;
	weekdays: number[];
	at: string;
	mday: string;
	mTime: string;
	mEvery: string;
	endAt: string;
	maxRuns: string;
	notify: NotifyMode;
	fresh: boolean;
	enabled: boolean;
	model: string | null;
	thinking: string | null;
	/** Preserved from the stored cadence so editing does not shift the day/week/month phase. */
	anchor?: string;
}

export function emptyForm(defaultCwd = ""): ScheduleForm {
	return {
		name: "",
		prompt: "",
		cwd: defaultCwd,
		runMode: "local",
		kind: "daily",
		ivNum: "1",
		ivUnit: "hour",
		time: "09:00",
		every: "1",
		weekdays: [],
		at: "",
		mday: "1",
		mTime: "09:00",
		mEvery: "1",
		endAt: "",
		maxRuns: "",
		notify: "all",
		fresh: true,
		enabled: true,
		model: null,
		thinking: null,
	};
}

export function formFromSchedule(s: Schedule): ScheduleForm {
	const f = emptyForm(s.cwd);
	const c = s.cadence;
	Object.assign(f, {
		name: s.name,
		prompt: s.prompt,
		runMode: s.runMode,
		kind: c.kind,
		endAt: toLocalInput(s.endAt),
		maxRuns: s.maxRuns ? String(s.maxRuns) : "",
		notify: s.notify,
		fresh: s.newChatEachRun !== false,
		enabled: s.enabled,
		model: s.model,
		thinking: s.thinking,
	});
	if (c.kind === "interval") {
		const hour = c.minutes % 60 === 0;
		f.ivUnit = hour ? "hour" : "min";
		f.ivNum = String(hour ? c.minutes / 60 : c.minutes);
	} else if (c.kind === "daily") {
		f.time = c.time;
		f.every = String(c.every ?? 1);
		f.weekdays = [...(c.weekdays ?? [])];
		f.anchor = c.anchor;
	} else if (c.kind === "once") {
		f.at = toLocalInput(c.at);
	} else {
		f.mday = String(c.day);
		f.mTime = c.time;
		f.mEvery = String(c.every ?? 1);
		f.anchor = c.anchor;
	}
	return f;
}

export type FormField = "name" | "prompt" | "cwd" | "iv" | "time" | "at" | "mday" | "mTime" | "endAt" | "maxRuns";
export type FormErrors = Partial<Record<FormField, string>>;

const validDate = (local: string): boolean => !!local && !Number.isNaN(new Date(local).getTime());

/** Field-level validation; an empty object means the form is valid. Messages are shown in full under the field. */
export function validateForm(f: ScheduleForm): FormErrors {
	const e: FormErrors = {};
	if (!f.name.trim()) e.name = "请填写任务名称";
	if (!f.prompt.trim()) e.prompt = "请填写提示词，它会在每次运行时发送给 agent";
	if (!f.cwd) e.cwd = "请选择工作目录";
	if (f.kind === "interval") {
		const n = Math.round(Number(f.ivNum));
		if (!(n >= 1)) e.iv = "间隔至少为 1";
	} else if (f.kind === "daily") {
		if (!f.time) e.time = "请选择运行时间";
	} else if (f.kind === "once") {
		if (!validDate(f.at)) e.at = "请选择运行时间";
	} else {
		const d = Math.round(Number(f.mday));
		if (!(d >= 1 && d <= 31)) e.mday = "日期需在 1 到 31 之间";
		if (!f.mTime) e.mTime = "请选择运行时间";
	}
	if (f.kind !== "once") {
		if (f.endAt && !validDate(f.endAt)) e.endAt = "结束时间格式不正确";
		if (f.maxRuns.trim()) {
			const n = Number(f.maxRuns);
			if (!(Number.isInteger(n) && n >= 1)) e.maxRuns = "最多运行次数需为不小于 1 的整数，留空表示不限";
		}
	}
	return e;
}

const every = (raw: string): number => Math.max(1, Math.round(Number(raw) || 1));

export function buildCadence(f: ScheduleForm): Cadence {
	switch (f.kind) {
		case "interval": {
			const n = Math.round(Number(f.ivNum));
			return { kind: "interval", minutes: f.ivUnit === "hour" ? n * 60 : n };
		}
		case "daily": {
			const c: Cadence = { kind: "daily", time: f.time, every: every(f.every) };
			if (f.weekdays.length) c.weekdays = [...new Set(f.weekdays)].sort((a, b) => a - b);
			if (f.anchor) c.anchor = f.anchor;
			return c;
		}
		case "once":
			return { kind: "once", at: new Date(f.at).toISOString() };
		case "monthly": {
			const c: Cadence = { kind: "monthly", day: Math.round(Number(f.mday)), time: f.mTime, every: every(f.mEvery) };
			if (f.anchor) c.anchor = f.anchor;
			return c;
		}
	}
}

/** Body for POST/PUT `/left/schedules`. Caller must validate first. `existing` keeps fields the form does not edit. */
export function buildPayload(f: ScheduleForm, existing?: Schedule | null): Record<string, unknown> {
	const recurring = f.kind !== "once";
	const draft: Record<string, unknown> = {
		name: f.name.trim(),
		prompt: f.prompt.trim(),
		cwd: f.cwd,
		runMode: f.runMode,
		cadence: buildCadence(f),
		model: f.model,
		thinking: f.model ? f.thinking : null,
		approvalMode: existing ? existing.approvalMode : null,
		enabled: f.enabled,
		notify: f.notify,
		newChatEachRun: f.fresh,
		endAt: recurring && f.endAt ? new Date(f.endAt).toISOString() : null,
		maxRuns: recurring && f.maxRuns.trim() ? Math.max(1, Math.round(Number(f.maxRuns))) : null,
	};
	if (existing) draft.id = existing.id;
	return draft;
}

/* ---------------------------------------------------------------- list / runs formatting */

/** Secondary line of a schedule row: next run · last result · progress (lifecycle is a chip). */
export function scheduleMeta(s: Schedule): string {
	const parts: string[] = [];
	if (s.nextRunAt && s.enabled) parts.push(`下次 ${fmtTime(s.nextRunAt)}`);
	if (s.lastRunStatus) parts.push(`上次${RUN_STATUS_LABEL[s.lastRunStatus] ?? s.lastRunStatus}`);
	if (s.maxRuns) parts.push(`${s.runsDone}/${s.maxRuns} 次`);
	return parts.join(" · ");
}

/** "耗时 1m 05s" for a finished run, "" while running or when timestamps are unusable. */
export function runDurationText(r: Pick<ScheduleRun, "startedAt" | "finishedAt">): string {
	if (!r.finishedAt) return "";
	const ms = Date.parse(r.finishedAt) - Date.parse(r.startedAt);
	if (Number.isNaN(ms)) return "";
	return `耗时 ${formatDuration(Math.max(0, ms))}`;
}

export function runTone(status: string): "success" | "danger" | "accent" | "neutral" {
	return status === "ok" ? "success" : status === "error" ? "danger" : status === "running" ? "accent" : "neutral";
}

/** A stored model string "provider/id" matched against the catalog; null when not listed. */
export function parseModel(
	value: string | null | undefined,
	models: ReadonlyArray<{ provider: string; id: string }>,
): { provider: string; modelId: string } | null {
	if (!value) return null;
	const hit = models.find((m) => `${m.provider}/${m.id}` === value) ?? models.find((m) => m.id === value);
	return hit ? { provider: hit.provider, modelId: hit.id } : null;
}

export const modelString = (m: { provider: string; id: string }): string => `${m.provider}/${m.id}`;
