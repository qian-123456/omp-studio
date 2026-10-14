import type { ScheduleCadence } from "../../lib/contracts";

const DAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Format cadence into human-readable Chinese description.
 * Examples: "每 30 分钟", "每 2 小时", "每天 09:00", "每 2 天 09:00",
 * "工作日 18:00", "每 2 周的周一、周三 09:00", "每月 15 日 · 09:00",
 * "每 3 个月 1 日 09:00", "一次 · 2026年10月15日 09:00".
 */
export function formatCadence(cadence: ScheduleCadence): string {
	if (cadence.kind === "interval") {
		const mins = Math.max(5, cadence.minutes);
		if (mins >= 60 && mins % 60 === 0) {
			return `每 ${mins / 60} 小时`;
		}
		return `每 ${mins} 分钟`;
	}

	if (cadence.kind === "once") {
		const d = new Date(cadence.at);
		if (Number.isNaN(d.getTime())) return "一次";
		return `一次 · ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	if (cadence.kind === "monthly") {
		const every = Math.max(1, Math.floor(cadence.every ?? 1));
		const prefix = every <= 1 ? "每月" : `每 ${every} 个月`;
		return `${prefix} ${cadence.day} 日 · ${cadence.time || "09:00"}`;
	}

	const time = cadence.time || "09:00";
	const every = Math.max(1, Math.floor(cadence.every ?? 1));
	const weekdays = cadence.weekdays ?? [];
	if (weekdays.length === 0 || weekdays.length === 7) {
		return every <= 1 ? `每天 ${time}` : `每 ${every} 天 ${time}`;
	}

	const normalized = [...new Set(weekdays.map((w) => w % 7))].sort(
		(a, b) => a - b,
	);
	if (normalized.length === 7) {
		return every <= 1 ? `每天 ${time}` : `每 ${every} 天 ${time}`;
	}

	// A subset means "every `every` weeks on these weekdays".
	const prefix = every <= 1 ? "" : `每 ${every} 周的`;

	// Workdays: [1, 2, 3, 4, 5]
	if (
		normalized.length === 5 &&
		normalized.every((d) => [1, 2, 3, 4, 5].includes(d))
	) {
		return `${prefix}工作日 ${time}`;
	}

	// Weekends: [0, 6]
	if (
		normalized.length === 2 &&
		normalized.includes(0) &&
		normalized.includes(6)
	) {
		return `${prefix}周末 ${time}`;
	}

	return `${prefix}${normalized.map((d) => DAY_NAMES[d]).join("、")} ${time}`;
}

/**
 * Cadence description plus end-condition suffixes: "· 共 10 次" for a run cap
 * and "· 至 10月31日" for an end date (both shown when a backend row has both).
 * Neither applies to `once` (no repetition to end).
 */
export function formatCadenceWithEnd(
	cadence: ScheduleCadence,
	endAt: string | null | undefined,
	maxRuns?: number | null,
): string {
	const base = formatCadence(cadence);
	if (cadence.kind === "once") return base;
	let out = base;
	if (typeof maxRuns === "number" && maxRuns >= 1) {
		out += ` · 共 ${Math.floor(maxRuns)} 次`;
	}
	if (endAt) {
		const d = new Date(endAt);
		if (!Number.isNaN(d.getTime())) {
			out += ` · 至 ${d.getMonth() + 1}月${d.getDate()}日`;
		}
	}
	return out;
}

/**
 * Format relative time for next run or last run.
 */
export function formatRelativeTime(isoString: string | null | undefined): string {
	if (!isoString) return "从未运行";
	const date = new Date(isoString);
	if (Number.isNaN(date.getTime())) return isoString;

	const now = Date.now();
	const diffMs = date.getTime() - now;
	const diffSec = Math.round(diffMs / 1000);
	const absSec = Math.abs(diffSec);

	if (diffMs > 0) {
		// In future (next run)
		if (absSec < 60) return "即将运行";
		if (absSec < 3600) return `${Math.round(absSec / 60)} 分钟后`;
		if (absSec < 86400) {
			const hours = Math.floor(absSec / 3600);
			const mins = Math.round((absSec % 3600) / 60);
			return mins > 0 ? `${hours} 小时 ${mins} 分钟后` : `${hours} 小时后`;
		}
		const days = Math.round(absSec / 86400);
		return `${days} 天后`;
	}

	// In past (last run)
	if (absSec < 60) return "刚刚";
	if (absSec < 3600) return `${Math.round(absSec / 60)} 分钟前`;
	if (absSec < 86400) return `${Math.round(absSec / 3600)} 小时前`;
	const days = Math.round(absSec / 86400);
	return `${days} 天前`;
}

/**
 * Friendly relative label for a future instant: "即将运行", "45 分钟后",
 * "N 小时后" within a day, "明天 09:00" / "后天 09:00" on the next calendar
 * days, else "N 天后". Returns null for missing/invalid input or times
 * already in the past.
 */
export function formatNextRun(
	isoString: string | null | undefined,
	now: Date = new Date(),
): string | null {
	if (!isoString) return null;
	const d = new Date(isoString);
	if (Number.isNaN(d.getTime())) return null;
	const diffMs = d.getTime() - now.getTime();
	if (diffMs <= 0) return null;

	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	const startOfDay = (x: Date) =>
		new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const dayDelta = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);

	// Beyond today, the calendar day is more useful than raw hours.
	if (dayDelta === 1) return `明天 ${time}`;
	if (dayDelta === 2) return `后天 ${time}`;
	if (dayDelta > 2) return `${dayDelta} 天后`;

	const diffSec = Math.round(diffMs / 1000);
	if (diffSec < 60) return "即将运行";
	if (diffSec < 3600) return `${Math.round(diffSec / 60)} 分钟后`;
	const hours = Math.floor(diffSec / 3600);
	const mins = Math.round((diffSec % 3600) / 60);
	return mins > 0 ? `${hours} 小时 ${mins} 分钟后` : `${hours} 小时后`;
}
