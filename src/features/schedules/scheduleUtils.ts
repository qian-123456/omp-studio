/**
 * Pure helpers shared by the schedules list page and the editor modal:
 * lifecycle fallback, `每 N unit` composer ↔ ScheduleCadence mapping,
 * local/ISO date conversion, form → ScheduleDraft building and Chinese
 * validation messages.
 */
import type {
	Schedule,
	ScheduleCadence,
	ScheduleDraft,
	ScheduleLifecycle,
	ScheduleNotify,
	ScheduleRun,
	ScheduleRunMode,
} from "../../lib/contracts";
import { composeSelection, parseSelection } from "../../components/modelSelectLogic";

/** 周期 menu modes: a one-shot date-time, or the recurring `每 N unit` composer. */
export type RepeatMode = "once" | "recur";

/** Units of the recurring composer; minutes/hours map to `interval`. */
export type CadenceUnit = "minute" | "hour" | "day" | "week" | "month";

export const CADENCE_UNITS: { value: CadenceUnit; label: string }[] = [
	{ value: "minute", label: "分钟" },
	{ value: "hour", label: "小时" },
	{ value: "day", label: "天" },
	{ value: "week", label: "周" },
	{ value: "month", label: "月" },
];

/** The `每 N unit` model a recurring ScheduleCadence maps to. */
export interface CadenceModel {
	every: number;
	unit: CadenceUnit;
}

/** Named 周期 shortcuts; `custom` = the model matches none of them. */
export type CadencePreset =
	| "once"
	| "hourly"
	| "daily"
	| "weekdays"
	| "weekly"
	| "monthly"
	| "custom";

/** Map an existing cadence onto the recurring `每 N unit` composer model. */
export function cadenceToModel(cadence: ScheduleCadence): CadenceModel {
	switch (cadence.kind) {
		case "interval":
			return cadence.minutes >= 60 && cadence.minutes % 60 === 0
				? { every: cadence.minutes / 60, unit: "hour" }
				: { every: Math.max(1, cadence.minutes), unit: "minute" };
		case "daily":
			return {
				every: Math.max(1, Math.floor(cadence.every ?? 1)),
				unit: (cadence.weekdays?.length ?? 0) > 0 ? "week" : "day",
			};
		case "monthly":
			return {
				every: Math.max(1, Math.floor(cadence.every ?? 1)),
				unit: "month",
			};
		case "once":
			return { every: 1, unit: "day" };
	}
}

/** Editor "结束重复" choices: never, on a date, or after N runs. */
export type EndMode = "never" | "date" | "count";

/** Time options for the HH:MM picker — 15-minute slots like ChatGPT. */
export const TIME_SLOTS: string[] = (() => {
	const out: string[] = [];
	for (let h = 0; h < 24; h++) {
		for (const m of [0, 15, 30, 45]) {
			out.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
		}
	}
	return out;
})();

/** "HH:MM" for a slot select; when off-grid, a custom value is appended. */
export function timeSlotOptions(current: string): string[] {
	return TIME_SLOTS.includes(current) ? TIME_SLOTS : [...TIME_SLOTS, current];
}

/** Days 1-31 for the monthly day-of-month select. */
export const MONTH_DAYS: number[] = Array.from({ length: 31 }, (_, i) => i + 1);

export const WEEKDAY_CHIPS = [
	{ id: 1, label: "一" },
	{ id: 2, label: "二" },
	{ id: 3, label: "三" },
	{ id: 4, label: "四" },
	{ id: 5, label: "五" },
	{ id: 6, label: "六" },
	{ id: 0, label: "日" },
] as const;

/**
 * Lifecycle with a fallback for backends that predate the field
 * (old rows lack `lifecycle`: enabled → active, disabled → paused).
 */
export function lifecycleOf(
	schedule: Pick<Schedule, "enabled"> & Partial<Pick<Schedule, "lifecycle">>,
): ScheduleLifecycle {
	return schedule.lifecycle ?? (schedule.enabled ? "active" : "paused");
}

/** Most recent run counts as "fresh" for 24h after it finished. */
export function isRecentRun(run: ScheduleRun | null | undefined, now = Date.now()): boolean {
	if (!run) return false;
	if (run.status !== "ok" && run.status !== "error") return false;
	const end = run.finishedAt ?? run.startedAt;
	const t = new Date(end).getTime();
	if (Number.isNaN(t)) return false;
	return now - t < 24 * 3600 * 1000 && now - t >= -60 * 1000;
}

/** "12:34" style duration between run start/finish; em-dash while running. */
export function formatRunDuration(run: ScheduleRun): string {
	const start = new Date(run.startedAt).getTime();
	const end = run.finishedAt ? new Date(run.finishedAt).getTime() : NaN;
	if (Number.isNaN(start)) return "";
	if (Number.isNaN(end)) return "进行中";
	let secs = Math.max(0, Math.round((end - start) / 1000));
	const h = Math.floor(secs / 3600);
	secs -= h * 3600;
	const m = Math.floor(secs / 60);
	const s = secs - m * 60;
	if (h > 0) return `${h} 小时 ${m} 分`;
	if (m > 0) return `${m} 分 ${s} 秒`;
	return `${s} 秒`;
}

/** Local timezone label for display next to time pickers, e.g. "GMT+8 · Asia/Shanghai". */
export function localTimezoneLabel(): string {
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
	let short = "";
	try {
		short =
			new Intl.DateTimeFormat("zh-CN", { timeZoneName: "short" })
				.formatToParts(new Date())
				.find((p) => p.type === "timeZoneName")?.value ?? "";
	} catch {
		short = "";
	}
	return short && short !== tz ? `${short} · ${tz}` : tz || short;
}


/** "YYYY-MM-DDTHH:MM" for a `datetime-local` input, from an ISO instant. */
export function toLocalInputValue(iso: string | null | undefined): string {
	if (!iso) return "";
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Parse a `datetime-local` value into a Date (local wall clock). */
export function localInputToDate(value: string): Date | null {
	if (!value) return null;
	const d = new Date(value);
	return Number.isNaN(d.getTime()) ? null : d;
}

/** "YYYY-MM-DD" for a `date` input, from an ISO instant (or empty). */
export function toLocalDateValue(iso: string | null | undefined): string {
	return toLocalInputValue(iso).slice(0, 10);
}

/** "YYYY-MM-DD" (local calendar day) → Date at local end of day. */
export function dateValueToEndOfDay(value: string): Date | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	const [y, m, d] = value.split("-").map((x) => parseInt(x, 10));
	const date = new Date(y, m - 1, d, 23, 59, 59, 999);
	return Number.isNaN(date.getTime()) ? null : date;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Every field the editor form holds; kept flat so `JSON.stringify` gives a
 * cheap dirty-check snapshot. `modelSel` is the combined `key[:level]`
 * selector used by ModelSelect; split on submit.
 */
export interface EditorForm {
	name: string;
	prompt: string;
	cwd: string;
	runMode: ScheduleRunMode;
	/** Which finished runs create an inbox entry. */
	notify: ScheduleNotify;
	/** false = reuse the previous run's session when it can be resumed. */
	newChatEachRun: boolean;
	/** Combined `provider/model[:thinking]` selector; "" = default model. */
	modelSel: string;
	approvalMode: string;
	/** false on a fresh create form until the user picks a cadence (请添加计划). */
	hasSchedule: boolean;
	/** "once" = 不重复（仅一次）; "recur" = the `每 N unit` composer. */
	repeat: RepeatMode;
	/** N of `每 N unit` for recurring cadences (>=1; >=5 for `minute`). */
	every: number;
	unit: CadenceUnit;
	/** HH:MM for day/week/month units. */
	time: string;
	/** Weekday subset for `week` unit; empty = invalid (must pick ≥1). */
	weekdays: number[];
	/** Day of month for `month` unit (clamped by the backend in short months). */
	monthDay: number;
	/** datetime-local value for `once`. */
	onceAt: string;
	endMode: EndMode;
	/** "YYYY-MM-DD" end date for recurring schedules when endMode === "date". */
	endDate: string;
	/** Stop after N runs for recurring schedules when endMode === "count". */
	endRuns: number;
}

export const DEFAULT_TIME = "09:00";
const DEFAULT_WEEKDAYS = [5]; // 每周 defaults to Friday
const WORKDAY_SET = [1, 2, 3, 4, 5];

function sameDays(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((d) => b.includes(d));
}

/** Which named 周期 preset the form model currently equals (else "custom"). */
export function presetOfForm(
	form: Pick<EditorForm, "repeat" | "every" | "unit" | "weekdays">,
): CadencePreset {
	if (form.repeat === "once") return "once";
	switch (form.unit) {
		case "minute":
			return "custom";
		case "hour":
			return form.every === 1 ? "hourly" : "custom";
		case "day":
			return form.every === 1 ? "daily" : "custom";
		case "week": {
			if (form.every !== 1) return "custom";
			if (sameDays(form.weekdays, WORKDAY_SET)) return "weekdays";
			const wd = [...new Set(form.weekdays.map((d) => ((d % 7) + 7) % 7))];
			return wd.length > 0 && wd.length < 7 ? "weekly" : "custom";
		}
		case "month":
			return form.every === 1 ? "monthly" : "custom";
	}
}

/** Default form for a fresh task: no schedule yet — "+ 添加计划". */
export function defaultForm(cwd: string): EditorForm {
	return {
		name: "",
		prompt: "",
		cwd,
		runMode: "local",
		notify: "important",
		newChatEachRun: true,
		modelSel: "",
		approvalMode: "write",
		hasSchedule: false,
		repeat: "recur",
		every: 1,
		unit: "day",
		time: DEFAULT_TIME,
		weekdays: [...DEFAULT_WEEKDAYS],
		monthDay: new Date().getDate(),
		onceAt: "",
		endMode: "never",
		endDate: "",
		endRuns: 10,
	};
}

/** Fill the recurring composer fields (every/unit/time/weekdays/monthDay) from a cadence. */
function applyCadenceToForm(base: EditorForm, cadence: ScheduleCadence): void {
	base.repeat = cadence.kind === "once" ? "once" : "recur";
	const model = cadenceToModel(cadence);
	base.every = model.every;
	base.unit = model.unit;
	switch (cadence.kind) {
		case "once":
			base.onceAt = toLocalInputValue(cadence.at);
			break;
		case "monthly":
			base.monthDay = cadence.day;
			base.time = cadence.time || DEFAULT_TIME;
			break;
		case "daily": {
			base.time = cadence.time || DEFAULT_TIME;
			const wd = cadence.weekdays ?? [];
			base.weekdays =
				wd.length === 0 || wd.length >= 7 ? [...DEFAULT_WEEKDAYS] : [...wd];
			break;
		}
		case "interval":
			break;
	}
}

/** Fill endMode/endDate/endRuns from persisted end fields (endAt wins over maxRuns). */
function applyEndToForm(
	base: EditorForm,
	endAt: string | null | undefined,
	maxRuns: number | null | undefined,
): void {
	if (endAt) {
		base.endMode = "date";
		base.endDate = toLocalDateValue(endAt);
	} else if (typeof maxRuns === "number" && maxRuns >= 1) {
		base.endMode = "count";
		base.endRuns = Math.floor(maxRuns);
	}
}

/** Form initialized from an existing schedule (edit mode). */
export function formFromSchedule(s: Schedule): EditorForm {
	const base = defaultForm(s.cwd);
	base.name = s.name;
	base.prompt = s.prompt;
	base.runMode = s.runMode;
	base.modelSel = s.model ? composeSelection(s.model, s.thinking) : "";
	base.approvalMode = s.approvalMode ?? "write";
	base.notify = s.notify;
	base.newChatEachRun = s.newChatEachRun;
	base.hasSchedule = true;
	applyCadenceToForm(base, s.cadence);
	applyEndToForm(base, s.endAt, s.maxRuns);
	return base;
}

/** Form initialized from a quick-create template. */
export function formFromTemplate(
	template: Partial<ScheduleDraft>,
	fallbackCwd: string,
): EditorForm {
	const base = defaultForm(template.cwd ?? fallbackCwd);
	base.name = template.name ?? "";
	base.prompt = template.prompt ?? "";
	base.runMode = template.runMode ?? "local";
	base.modelSel = template.model ? composeSelection(template.model, template.thinking ?? null) : "";
	base.approvalMode = template.approvalMode ?? "write";
	base.notify = template.notify ?? "important";
	base.newChatEachRun = template.newChatEachRun ?? true;
	base.hasSchedule = !!template.cadence;
	if (template.cadence) applyCadenceToForm(base, template.cadence);
	applyEndToForm(base, template.endAt, template.maxRuns);
	return base;
}

export interface FormErrors {
	prompt?: string;
	cwd?: string;
	cadence?: string;
	endAt?: string;
	maxRuns?: string;
}

/**
 * Validate a form into a ScheduleCadence + end fields. Mirrors the backend's
 * Chinese error strings so the user sees the same message client-side.
 * `onceAtUnchanged` lets editing a completed one-shot keep its past time
 * when the user did not touch it.
 *
 * Cadence mapping: minute/hour units → `interval` (`every × unit`);
 * day → `daily` without weekdays (`every` days); week → `daily` with weekday
 * subset (`every` weeks); month → `monthly` (`every` months). `anchor` is
 * left to the backend (it fills today's local date when `every` > 1).
 */
export function validateForm(
	form: EditorForm,
	opts: { onceAtUnchanged?: boolean } = {},
): {
	cadence: ScheduleCadence | null;
	endAt: string | null;
	maxRuns: number | null;
	errors: FormErrors;
} {
	const errors: FormErrors = {};
	let cadence: ScheduleCadence | null = null;

	if (!form.prompt.trim()) errors.prompt = "请填写任务指令";
	if (!form.cwd.trim()) errors.cwd = "请选择项目目录";

	if (!form.hasSchedule) {
		errors.cadence = "请添加计划";
	} else if (form.repeat === "once") {
		const at = localInputToDate(form.onceAt);
		if (!at) {
			errors.cadence = "请选择未来的时间";
		} else if (at.getTime() <= Date.now() && !opts.onceAtUnchanged) {
			errors.cadence = "请选择未来的时间";
		} else {
			cadence = { kind: "once", at: at.toISOString() };
		}
	} else {
		const every = Math.floor(form.every);
		switch (form.unit) {
		case "minute": {
			if (!Number.isFinite(every) || every < 5) {
				errors.cadence = "间隔至少 5 分钟";
			} else {
				cadence = { kind: "interval", minutes: every };
			}
			break;
		}
		case "hour": {
			if (!Number.isFinite(every) || every < 1) {
				errors.cadence = "间隔需为不小于 1 的整数";
			} else {
				cadence = { kind: "interval", minutes: every * 60 };
			}
			break;
		}
		case "day":
		case "week": {
			if (!Number.isFinite(every) || every < 1) {
				errors.cadence = "间隔需为不小于 1 的整数";
				break;
			}
			if (!TIME_RE.test(form.time)) {
				errors.cadence = "请选择时间";
				break;
			}
			const wd =
				form.unit === "day"
					? []
					: [...new Set(form.weekdays)].sort((a, b) => a - b);
			if (form.unit === "week" && wd.length === 0) {
				errors.cadence = "请至少选择一天";
				break;
			}
			cadence = {
				kind: "daily",
				time: form.time,
				weekdays: wd,
				// `every` omitted when 1 — old serialized shape stays identical.
				...(every > 1 ? { every } : {}),
			};
			break;
		}
		case "month": {
			if (!Number.isFinite(every) || every < 1) {
				errors.cadence = "间隔需为不小于 1 的整数";
				break;
			}
			if (!TIME_RE.test(form.time)) {
				errors.cadence = "请选择时间";
				break;
			}
			if (form.monthDay < 1 || form.monthDay > 31) {
				errors.cadence = "日期需在 1-31 之间";
				break;
			}
			cadence = {
				kind: "monthly",
				day: Math.floor(form.monthDay),
				time: form.time,
				...(every > 1 ? { every } : {}),
			};
			break;
		}
		}
	}

	// 结束重复 only applies to recurring cadences.
	const recurring = form.hasSchedule && form.repeat !== "once";
	let endAt: string | null = null;
	let maxRuns: number | null = null;
	if (recurring && form.endMode === "date") {
		const end = dateValueToEndOfDay(form.endDate);
		if (!end || end.getTime() <= Date.now()) {
			errors.endAt = "结束时间需晚于现在";
		} else {
			endAt = end.toISOString();
		}
	}
	if (recurring && form.endMode === "count") {
		const runs = Math.floor(form.endRuns);
		if (!Number.isFinite(runs) || runs < 1) {
			errors.maxRuns = "次数需为不小于 1 的整数";
		} else {
			maxRuns = runs;
		}
	}

	return { cadence, endAt, maxRuns, errors };
}

/** Derive a display name from the first line of the instructions. */
export function deriveName(prompt: string): string {
	const first =
		prompt
			.replace(/\[(?:Image|图片)\s*#?\d*(?:,\s*\d+x\d+)?:\s*[^\]]+\]/gu, "")
			.trim()
			.split("\n")[0]
			?.trim() ?? "";
	const clipped = first.length > 24 ? `${first.slice(0, 24)}…` : first;
	return clipped || "未命名定时任务";
}

/** Build the IPC draft; splits the combined model selector into model+thinking. */
export function buildDraft(
	form: EditorForm,
	cadence: ScheduleCadence,
	endAt: string | null,
	maxRuns?: number | null,
	id?: string,
	enabled?: boolean,
): ScheduleDraft {
	const sel = parseSelection(form.modelSel);
	const once = cadence.kind === "once";
	return {
		id,
		name: form.name.trim() || deriveName(form.prompt),
		prompt: form.prompt.trim(),
		cwd: form.cwd.trim(),
		runMode: form.runMode,
		cadence,
		notify: form.notify,
		newChatEachRun: form.newChatEachRun,
		model: sel.selector || null,
		thinking: sel.level,
		approvalMode: form.approvalMode || null,
		enabled,
		// `once` ignores endAt/maxRuns entirely.
		endAt: once ? null : endAt,
		maxRuns: once ? null : (maxRuns ?? null),
	};
}

/** Draft used by the "复制" overflow action: same config, no id. */
export function draftFromSchedule(s: Schedule): ScheduleDraft {
	return {
		name: `${s.name}（副本）`,
		prompt: s.prompt,
		cwd: s.cwd,
		runMode: s.runMode,
		cadence: s.cadence,
		notify: s.notify,
		newChatEachRun: s.newChatEachRun,
		model: s.model,
		thinking: s.thinking,
		approvalMode: s.approvalMode,
		enabled: true,
		endAt: s.endAt,
		maxRuns: s.maxRuns,
	};
}

/** Update draft for an existing schedule that changes only its name. Timing
 * fields are unchanged, so the backend keeps the stored next run. */
export function renameDraft(s: Schedule, name: string): ScheduleDraft {
	return { ...draftFromSchedule(s), id: s.id, name, enabled: s.enabled };
}

export interface ScheduleTemplate {
	title: string;
	desc: string;
	draft: Partial<ScheduleDraft>;
}

/** Quick-fill templates shown in the empty state and as create-form chips. */
export const TEMPLATES: ScheduleTemplate[] = [
	{
		title: "每天早上总结昨天的提交",
		desc: "每工作日 09:00 自动拉取最近 24 小时提交并生成工作早报",
		draft: {
			name: "每天早上总结昨天的提交",
			prompt:
				"请查看仓库最近 24 小时（或昨天的所有 git commit 提交记录），分析各个改动的主要内容，生成一份简明的工作总结报告，列出完成的功能和修复的 Bug。",
			cadence: {
				kind: "daily",
				time: "09:00",
				weekdays: [1, 2, 3, 4, 5],
			},
			approvalMode: "write",
			runMode: "local",
		},
	},
	{
		title: "每工作日检查依赖安全更新",
		desc: "每工作日 10:00 自动检查 package.json / Cargo.toml 漏洞与过时版本",
		draft: {
			name: "每工作日检查依赖安全更新",
			prompt:
				"请检查当前项目的依赖配置文件（如 package.json、Cargo.toml 等），分析是否有已知的安全漏洞、安全通告或主版本过期的依赖项，并输出一份安全评估简报与升级建议。",
			cadence: {
				kind: "daily",
				time: "10:00",
				weekdays: [1, 2, 3, 4, 5],
			},
			approvalMode: "write",
			runMode: "local",
		},
	},
	{
		title: "每周五梳理待办与未完成任务",
		desc: "每周五 17:00 自动扫描代码中的 TODO / FIXME 注释并整理清单",
		draft: {
			name: "每周五梳理待办与未完成任务",
			prompt:
				"请扫描当前代码库中的 TODO、FIXME 注释以及未完成的代码项，按模块梳理出本周待办清单，并给出优先级建议。",
			cadence: {
				kind: "daily",
				time: "17:00",
				weekdays: [5],
			},
			approvalMode: "write",
			runMode: "local",
		},
	},
];
