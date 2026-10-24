import type { SessionMeta } from "../../lib/contracts";
import { t } from "../../lib/i18n";
import { useLanguageStore } from "../../stores/language";

export type TimeChunkKey = "today" | "yesterday" | "last7Days" | "earlier";

export interface TimeChunk {
	key: TimeChunkKey;
	label: string;
	sessions: SessionMeta[];
}

/**
 * Group sessions into 4 time buckets:
 * - 今天 (Today): modified today (since local midnight)
 * - 昨天 (Yesterday): modified yesterday (between yesterday's midnight and today's midnight)
 * - 前 7 天 (Previous 7 Days): modified in the past 7 days (prior to yesterday's midnight)
 * - 更早 (Earlier): older than 7 days, or invalid timestamp
 *
 * Empty buckets are omitted.
 */
export function chunkSessionsByTime(
	sessions: readonly SessionMeta[],
	now: Date = new Date(),
): TimeChunk[] {
	const locale = useLanguageStore.getState().locale;
	if (sessions.length === 0) return [];

	const startOfToday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	).getTime();
	const startOfYesterday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - 1,
	).getTime();
	const startOf7Days = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate() - 6,
	).getTime();

	const buckets: Record<TimeChunkKey, SessionMeta[]> = {
		today: [],
		yesterday: [],
		last7Days: [],
		earlier: [],
	};

	for (const s of sessions) {
		const raw = s.updatedAt || s.createdAt;
		const ts = new Date(raw).getTime();
		if (Number.isNaN(ts) || ts < startOf7Days) {
			buckets.earlier.push(s);
		} else if (ts < startOfYesterday) {
			buckets.last7Days.push(s);
		} else if (ts < startOfToday) {
			buckets.yesterday.push(s);
		} else {
			buckets.today.push(s);
		}
	}

	const defs: Array<{ key: TimeChunkKey; label: string }> = [
		{ key: "today", label: t("time.today", undefined, locale) },
		{ key: "yesterday", label: t("time.yesterday", undefined, locale) },
		{ key: "last7Days", label: t("time.last7Days", undefined, locale) },
		{ key: "earlier", label: t("time.earlier", undefined, locale) },
	];

	const out: TimeChunk[] = [];
	for (const { key, label } of defs) {
		const list = buckets[key];
		if (list.length > 0) {
			out.push({ key, label, sessions: list });
		}
	}
	return out;
}
