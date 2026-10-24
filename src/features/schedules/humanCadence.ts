import type { ScheduleCadence } from "../../lib/contracts";
import type { Locale } from "../../lib/i18n";
import { useLanguageStore } from "../../stores/language";

const DAY_NAMES_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const DAY_NAMES_EN = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES_EN = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];

const pad = (n: number) => String(n).padStart(2, "0");

function getLocale(locale?: Locale): Locale {
	if (locale) return locale;
	try {
		return useLanguageStore.getState().locale;
	} catch {
		return "zh-CN";
	}
}

/**
 * Format cadence into human-readable description per locale.
 * zh-CN examples: "每 30 分钟", "每 2 小时", "每天 09:00", "每 2 天 09:00",
 * "工作日 18:00", "每 2 周的周一、周三 09:00", "每月 15 日 · 09:00",
 * "每 3 个月 1 日 · 09:00", "一次 · 2026年10月15日 09:00".
 * en-US examples: "Every 30 minutes", "Every 2 hours", "Daily at 09:00",
 * "Weekdays at 18:00", "Every 2 weeks on Mon, Wed at 09:00",
 * "Monthly on day 15 · 09:00", "Once · Oct 15, 2026 09:00".
 */
export function formatCadence(
	cadence: ScheduleCadence,
	locale?: Locale,
): string {
	const loc = getLocale(locale);

	if (cadence.kind === "interval") {
		const mins = Math.max(5, cadence.minutes);
		if (mins >= 60 && mins % 60 === 0) {
			const hours = mins / 60;
			if (loc === "en-US") {
				return hours === 1 ? "Every hour" : `Every ${hours} hours`;
			}
			return `每 ${hours} 小时`;
		}
		if (loc === "en-US") {
			return mins === 1 ? "Every minute" : `Every ${mins} minutes`;
		}
		return `每 ${mins} 分钟`;
	}

	if (cadence.kind === "once") {
		const d = new Date(cadence.at);
		if (Number.isNaN(d.getTime())) {
			return loc === "en-US" ? "Once" : "一次";
		}
		if (loc === "en-US") {
			return `Once · ${MONTH_NAMES_EN[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
		}
		return `一次 · ${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
	}

	if (cadence.kind === "monthly") {
		const every = Math.max(1, Math.floor(cadence.every ?? 1));
		const time = cadence.time || "09:00";
		if (loc === "en-US") {
			const prefix =
				every <= 1 ? "Monthly" : `Every ${every} months`;
			return `${prefix} on day ${cadence.day} · ${time}`;
		}
		const prefix = every <= 1 ? "每月" : `每 ${every} 个月`;
		return `${prefix} ${cadence.day} 日 · ${time}`;
	}

	const time = cadence.time || "09:00";
	const every = Math.max(1, Math.floor(cadence.every ?? 1));
	const weekdays = cadence.weekdays ?? [];
	if (weekdays.length === 0 || weekdays.length === 7) {
		if (loc === "en-US") {
			return every <= 1 ? `Daily at ${time}` : `Every ${every} days at ${time}`;
		}
		return every <= 1 ? `每天 ${time}` : `每 ${every} 天 ${time}`;
	}

	const normalized = [...new Set(weekdays.map((w) => w % 7))].sort(
		(a, b) => a - b,
	);
	if (normalized.length === 7) {
		if (loc === "en-US") {
			return every <= 1 ? `Daily at ${time}` : `Every ${every} days at ${time}`;
		}
		return every <= 1 ? `每天 ${time}` : `每 ${every} 天 ${time}`;
	}

	// Workdays: [1, 2, 3, 4, 5]
	if (
		normalized.length === 5 &&
		normalized.every((d) => [1, 2, 3, 4, 5].includes(d))
	) {
		if (loc === "en-US") {
			return every <= 1
				? `Weekdays at ${time}`
				: `Every ${every} weeks on weekdays at ${time}`;
		}
		const prefix = every <= 1 ? "" : `每 ${every} 周的`;
		return `${prefix}工作日 ${time}`;
	}

	// Weekends: [0, 6]
	if (
		normalized.length === 2 &&
		normalized.includes(0) &&
		normalized.includes(6)
	) {
		if (loc === "en-US") {
			return every <= 1
				? `Weekends at ${time}`
				: `Every ${every} weeks on weekends at ${time}`;
		}
		const prefix = every <= 1 ? "" : `每 ${every} 周的`;
		return `${prefix}周末 ${time}`;
	}

	if (loc === "en-US") {
		const days = normalized.map((d) => DAY_NAMES_EN[d]).join(", ");
		return every <= 1
			? `Every ${days} at ${time}`
			: `Every ${every} weeks on ${days} at ${time}`;
	}

	const prefix = every <= 1 ? "" : `每 ${every} 周的`;
	return `${prefix}${normalized.map((d) => DAY_NAMES_ZH[d]).join("、")} ${time}`;
}

/**
 * Cadence description plus end-condition suffixes.
 * zh-CN: "· 共 10 次", "· 至 10月31日"
 * en-US: "· 10 runs total", "· until Oct 31"
 */
export function formatCadenceWithEnd(
	cadence: ScheduleCadence,
	endAt: string | null | undefined,
	maxRuns?: number | null,
	locale?: Locale,
): string {
	const loc = getLocale(locale);
	const base = formatCadence(cadence, loc);
	if (cadence.kind === "once") return base;
	let out = base;
	if (typeof maxRuns === "number" && maxRuns >= 1) {
		const runs = Math.floor(maxRuns);
		if (loc === "en-US") {
			out += ` · ${runs} ${runs === 1 ? "run" : "runs"} total`;
		} else {
			out += ` · 共 ${runs} 次`;
		}
	}
	if (endAt) {
		const d = new Date(endAt);
		if (!Number.isNaN(d.getTime())) {
			if (loc === "en-US") {
				out += ` · until ${MONTH_NAMES_EN[d.getMonth()]} ${d.getDate()}`;
			} else {
				out += ` · 至 ${d.getMonth() + 1}月${d.getDate()}日`;
			}
		}
	}
	return out;
}

/**
 * Format relative time for next run or last run.
 */
export function formatRelativeTime(
	isoString: string | null | undefined,
	locale?: Locale,
): string {
	const loc = getLocale(locale);
	if (!isoString) return loc === "en-US" ? "Never run" : "从未运行";
	const date = new Date(isoString);
	if (Number.isNaN(date.getTime())) return isoString;

	const now = Date.now();
	const diffMs = date.getTime() - now;
	const diffSec = Math.round(diffMs / 1000);
	const absSec = Math.abs(diffSec);

	if (diffMs > 0) {
		// In future (next run)
		if (absSec < 60) return loc === "en-US" ? "Starting soon" : "即将运行";
		if (absSec < 3600) {
			const m = Math.round(absSec / 60);
			return loc === "en-US" ? `in ${m} min` : `${m} 分钟后`;
		}
		if (absSec < 86400) {
			const hours = Math.floor(absSec / 3600);
			const mins = Math.round((absSec % 3600) / 60);
			if (loc === "en-US") {
				return mins > 0 ? `in ${hours} hr ${mins} min` : `in ${hours} hr`;
			}
			return mins > 0 ? `${hours} 小时 ${mins} 分钟后` : `${hours} 小时后`;
		}
		const days = Math.round(absSec / 86400);
		if (loc === "en-US") {
			return `in ${days} ${days === 1 ? "day" : "days"}`;
		}
		return `${days} 天后`;
	}

	// In past (last run)
	if (absSec < 60) return loc === "en-US" ? "Just now" : "刚刚";
	if (absSec < 3600) {
		const m = Math.round(absSec / 60);
		return loc === "en-US" ? `${m} min ago` : `${m} 分钟前`;
	}
	if (absSec < 86400) {
		const h = Math.round(absSec / 3600);
		return loc === "en-US" ? `${h} hr ago` : `${h} 小时前`;
	}
	const days = Math.round(absSec / 86400);
	if (loc === "en-US") {
		return `${days} ${days === 1 ? "day" : "days"} ago`;
	}
	return `${days} 天前`;
}

/**
 * Friendly relative label for a future instant.
 */
export function formatNextRun(
	isoString: string | null | undefined,
	now: Date = new Date(),
	locale?: Locale,
): string | null {
	if (!isoString) return null;
	const d = new Date(isoString);
	if (Number.isNaN(d.getTime())) return null;
	const diffMs = d.getTime() - now.getTime();
	if (diffMs <= 0) return null;

	const loc = getLocale(locale);
	const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
	const startOfDay = (x: Date) =>
		new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
	const dayDelta = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);

	// Beyond today, the calendar day is more useful than raw hours.
	if (dayDelta === 1) {
		return loc === "en-US" ? `Tomorrow at ${time}` : `明天 ${time}`;
	}
	if (dayDelta === 2) {
		return loc === "en-US" ? `In 2 days at ${time}` : `后天 ${time}`;
	}
	if (dayDelta > 2) {
		return loc === "en-US" ? `in ${dayDelta} days` : `${dayDelta} 天后`;
	}

	const diffSec = Math.round(diffMs / 1000);
	if (diffSec < 60) return loc === "en-US" ? "Starting soon" : "即将运行";
	if (diffSec < 3600) {
		const m = Math.round(diffSec / 60);
		return loc === "en-US" ? `in ${m} min` : `${m} 分钟后`;
	}
	const hours = Math.floor(diffSec / 3600);
	const mins = Math.round((diffSec % 3600) / 60);
	if (loc === "en-US") {
		return mins > 0 ? `in ${hours} hr ${mins} min` : `in ${hours} hr`;
	}
	return mins > 0 ? `${hours} 小时 ${mins} 分钟后` : `${hours} 小时后`;
}
