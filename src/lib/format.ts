/** Formatting helpers (Chinese UI text). */

/** 刚刚 / N分钟前 / N小时前 / N天前 — accepts ISO string or epoch ms. */
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
	return `${days}天前`;
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
