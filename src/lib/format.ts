/** Formatting helpers (Chinese UI text). */

import { t as translate } from "./i18n";
import { useLanguageStore } from "../stores/language";

const locale = () => useLanguageStore.getState().locale;
const tr = (key: string, params?: Record<string, string | number>) =>
	translate(key, params, locale());
/**
 * 格式化绝对时间为 YYYY-MM-DD HH:mm:ss，用于 title hover 显示。
 */
export function absoluteTime(input: string | number | Date): string {
	const d =
		typeof input === "string" || input instanceof Date
			? new Date(input)
			: new Date(input);
	if (Number.isNaN(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	const y = d.getFullYear();
	const m = pad(d.getMonth() + 1);
	const date = pad(d.getDate());
	const h = pad(d.getHours());
	const min = pad(d.getMinutes());
	const s = pad(d.getSeconds());
	return `${y}-${m}-${date} ${h}:${min}:${s}`;
}

/** 格式化日历日期为 YYYY-MM-DD */
export function formatDate(input: string | number | Date): string {
	const d =
		typeof input === "string" || input instanceof Date
			? new Date(input)
			: new Date(input);
	if (Number.isNaN(d.getTime())) return "";
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Compact relative time without the 「前」 suffix: 刚刚 / N分钟 / N小时 / N天；
 * 超过 30 天时显示日历日期（YYYY-MM-DD）。用于侧边栏等紧凑位置；
 * 需要完整语句时用 `timeAgo`。
 */
export function relativeTime(input: string | number | Date): string {
	const t =
		typeof input === "string" || input instanceof Date
			? new Date(input).getTime()
			: input;
	if (Number.isNaN(t)) return "";
	const diff = Date.now() - t;
	if (diff < 0) return tr("time.justNow");
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return tr("time.justNow");
	if (minutes < 60) return locale() === "en-US" ? `${minutes}m` : `${minutes}分钟`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return locale() === "en-US" ? `${hours}h` : `${hours}小时`;
	const days = Math.floor(hours / 24);
	if (days <= 30) return locale() === "en-US" ? `${days}d` : `${days}天`;
	return formatDate(t);
}

/**
 * 完整相对时间：刚刚 / N 分钟前 / N 小时前 / N 天前；
 * 超过 30 天时显示日历日期（YYYY-MM-DD）。无效输入返回空串。
 */
export function timeAgo(input: string | number | Date): string {
	const t =
		typeof input === "string" || input instanceof Date
			? new Date(input).getTime()
			: input;
	if (Number.isNaN(t)) return "";
	const diff = Date.now() - t;
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return tr("time.justNow");
	if (minutes < 60) return tr("time.minutesAgo", { minutes });
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return tr("time.hoursAgo", { hours });
	const days = Math.floor(hours / 24);
	if (days <= 30) return tr("time.daysAgo", { days });
	return formatDate(t);
}

/** 返回相对时间与绝对时间 title 的组合对象 */
export function timeWithTitle(input: string | number | Date): {
	title: string;
	text: string;
} {
	return {
		title: absoluteTime(input),
		text: relativeTime(input),
	};
}

/** Truncate to `max` chars with an ellipsis. */
export function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/** Human-readable byte size; 「—」 for null/undefined. */
export function formatBytes(bytes: number | null | undefined): string {
	if (bytes == null) return "—";
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let i = 0;
	while (value >= 1024 && i < units.length - 1) {
		value /= 1024;
		i += 1;
	}
	return `${value.toFixed(1)} ${units[i]}`;
}
