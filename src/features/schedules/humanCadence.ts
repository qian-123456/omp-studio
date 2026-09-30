import type { ScheduleCadence } from "../../lib/contracts";

const DAY_NAMES = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/**
 * Format cadence into human-readable Chinese description.
 * Examples: "每 30 分钟", "每 2 小时", "每天 09:00", "工作日 18:00", "周末 10:00", "周一、周三 09:00"
 */
export function formatCadence(cadence: ScheduleCadence): string {
	if (cadence.kind === "interval") {
		const mins = Math.max(5, cadence.minutes);
		if (mins >= 60 && mins % 60 === 0) {
			return `每 ${mins / 60} 小时`;
		}
		return `每 ${mins} 分钟`;
	}

	const time = cadence.time || "09:00";
	const weekdays = cadence.weekdays ?? [];
	if (weekdays.length === 0 || weekdays.length === 7) {
		return `每天 ${time}`;
	}

	const normalized = [...new Set(weekdays.map((w) => w % 7))].sort((a, b) => a - b);
	if (normalized.length === 7) {
		return `每天 ${time}`;
	}

	// Workdays: [1, 2, 3, 4, 5]
	if (
		normalized.length === 5 &&
		normalized.every((d) => [1, 2, 3, 4, 5].includes(d))
	) {
		return `工作日 ${time}`;
	}

	// Weekends: [0, 6]
	if (
		normalized.length === 2 &&
		normalized.includes(0) &&
		normalized.includes(6)
	) {
		return `周末 ${time}`;
	}

	return `${normalized.map((d) => DAY_NAMES[d]).join("、")} ${time}`;
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
