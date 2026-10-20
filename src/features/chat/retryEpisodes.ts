/**
 * Retry / fallback history entries in the message flow. Each finished turn's
 * episode is spliced in as a synthetic `system` item right after the last
 * transcript item written at or before the turn ended, so it scrolls with the
 * thread instead of staying pinned at the bottom.
 */
import type { TranscriptItem } from "../../lib/contracts";
import { type RetryEpisode, retrySummary } from "../../stores/retryNotice";

export type RetryItem = TranscriptItem & { retry?: RetryEpisode };

export const isRetryItem = (
	item: TranscriptItem,
): item is RetryItem & { retry: RetryEpisode } => (item as RetryItem).retry !== undefined;

function episodeItem(ep: RetryEpisode): RetryItem {
	return {
		id: `retry-episode-${ep.id}`,
		parentId: null,
		ts: new Date(ep.endedAt).toISOString(),
		kind: "system",
		text: retrySummary(ep.notices, ep.fallback),
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		retry: ep,
	};
}

export function withRetryEpisodes(
	items: TranscriptItem[],
	episodes: readonly RetryEpisode[],
): TranscriptItem[] {
	if (episodes.length === 0) return items;
	const times = items.map((it) => Date.parse(it.ts));
	const after: Map<number, RetryEpisode[]> = new Map(); // item index (-1 = head) → episodes
	for (const ep of episodes) {
		let idx = -1;
		times.forEach((t, i) => {
			if (!Number.isNaN(t) && t <= ep.endedAt) idx = i;
		});
		after.set(idx, [...(after.get(idx) ?? []), ep]);
	}
	const out: TranscriptItem[] = (after.get(-1) ?? []).map(episodeItem);
	items.forEach((it, i) => {
		out.push(it);
		for (const ep of after.get(i) ?? []) out.push(episodeItem(ep));
	});
	return out;
}
