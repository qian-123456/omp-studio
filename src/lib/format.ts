/** Formatting helpers (Chinese UI text). */

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
 * 刚刚 / N分钟前 / N小时前 / N天前；
 * 超过 30 天时显示日历日期（YYYY-MM-DD）。
 */
export function relativeTime(input: string | number | Date): string {
	const t =
		typeof input === "string" || input instanceof Date
			? new Date(input).getTime()
			: input;
	if (Number.isNaN(t)) return "";
	const diff = Date.now() - t;
	if (diff < 0) return "刚刚";
	const minutes = Math.floor(diff / 60_000);
	if (minutes < 1) return "刚刚";
	if (minutes < 60) return `${minutes}分钟前`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}小时前`;
	const days = Math.floor(hours / 24);
	if (days <= 30) return `${days}天前`;
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

/** Human-readable byte size. */
export function formatBytes(bytes: number): string {
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
