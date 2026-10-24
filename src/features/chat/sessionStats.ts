import type { TranscriptItem } from "../../lib/contracts";
import type { LiveRequest, SessionLive } from "../../stores/live";
import { type RequestStat, requestStatFromItem } from "./requestStats";
import { tNow } from "../../stores/language";

export interface ComputedSessionStats {
	rounds: number;
	steps: number;
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	cacheHitRate: number; // 0 - 100
	/** Σ request durations reported by the model, failed requests included
	 * (their wait was real wall time); 0 when nothing recorded one. */
	modelDurationMs: number;
	toolDurationMs: number;
	/** Mean of the real per-request `ttft` values of successful requests; null when none were recorded. */
	avgTtftMs: number | null;
	/** Σ output ÷ Σ duration over successful requests that recorded a duration; null when none did. */
	tps: number | null;
	/** Number of successful model requests that recorded a duration. */
	timedRequests: number;
	hasData: boolean;
}

/** Identity of one request for de-duplicating live entries the transcript
 * already carries (same message, same completion, same output). */
function requestKey(stat: RequestStat): string {
	return [stat.startedAt, stat.completedAt, stat.durationMs, stat.usage?.output].join("/");
}

/** Real stats of every model request in the session: transcript items first,
 * then the live requests of the current turn not yet in the transcript. */
export function sessionRequestStats(
	items: TranscriptItem[] = [],
	live?: SessionLive,
): RequestStat[] {
	const stats: RequestStat[] = [];
	const seen = new Set<string>();
	const push = (stat: RequestStat) => {
		const key = requestKey(stat);
		if (seen.has(key)) return;
		seen.add(key);
		stats.push(stat);
	};
	for (const item of items) {
		const stat = requestStatFromItem(item);
		if (stat) push(stat);
	}
	// Live requests of the current turn, not yet persisted to the transcript.
	for (const req of newLiveRequests(items, live)) push(req.stat);
	return stats;
}

/** Live requests whose stat the transcript does not carry yet. */
function newLiveRequests(items: TranscriptItem[], live?: SessionLive): LiveRequest[] {
	if (!live?.liveRequests?.length) return [];
	const persisted = new Set<string>();
	for (const item of items) {
		const stat = requestStatFromItem(item);
		if (stat) persisted.add(requestKey(stat));
	}
	const out: LiveRequest[] = [];
	for (const req of live.liveRequests) {
		const key = requestKey(req.stat);
		if (persisted.has(key)) continue;
		persisted.add(key);
		out.push(req);
	}
	return out;
}

export function computeSessionStats(
	items: TranscriptItem[] = [],
	live?: SessionLive,
): ComputedSessionStats {
	let rounds = 0;
	let assistantCount = 0;
	let toolCallCount = 0;

	let totalTokens = 0;
	let inputTokens = 0;
	let outputTokens = 0;
	let cacheRead = 0;
	let cacheWrite = 0;

	let toolDurationMs = 0;
	let modelDurationMs = 0;
	let timedOutput = 0;
	let timedMs = 0;
	let timedRequests = 0;
	let ttftSum = 0;
	let ttftCount = 0;

	for (const item of items) {
		if (item.kind === "user") {
			rounds++;
		} else if (item.kind === "assistant" && item.stopReason !== "error") {
			// Failed requests (auto-retried provider errors) produced nothing.
			assistantCount++;
		}

		if (item.toolCalls && item.toolCalls.length > 0) {
			toolCallCount += item.toolCalls.length;
		}
	}

	// The running turn is not in the transcript page yet: its user message is
	// still a pending echo (reconciled away once the jsonl carries it, so no
	// double count), and each finished live request is a step plus its tools.
	// Failed requests produced nothing and are not steps.
	rounds += live?.pendingUserEchoes?.length ?? 0;
	for (const req of newLiveRequests(items, live)) {
		if (req.stat.error) continue;
		assistantCount++;
		toolCallCount += req.toolCallIds.length;
	}

	// Token usage: transcript items plus the live requests of the current turn
	// the transcript has not caught up with yet (same de-duplication as timing).
	const requestStats = sessionRequestStats(items, live);
	for (const stat of requestStats) {
		const u = stat.usage;
		if (!u) continue;
		inputTokens += u.input || 0;
		outputTokens += u.output || 0;
		cacheRead += u.cacheRead || 0;
		cacheWrite += u.cacheWrite || 0;
		totalTokens += u.totalTokens || u.input + u.output + u.cacheRead + u.cacheWrite;
	}

	// Real per-request timing comes from the messages themselves; live requests
	// of the current turn are folded in until the transcript catches up.
	for (const stat of requestStats) {
		if (stat.durationMs != null && stat.durationMs > 0) {
			modelDurationMs += stat.durationMs;
			if (!stat.error) {
				timedMs += stat.durationMs;
				timedOutput += stat.usage?.output ?? 0;
				timedRequests++;
			}
		}
		if (stat.ttftMs != null && !stat.error) {
			ttftSum += stat.ttftMs;
			ttftCount++;
		}
	}

	// Tool durations from transcript: pair each toolResult with its issuing
	// assistant item via toolCallId and use their ISO timestamps' delta.
	// Build a map from toolCallId → assistant item ts first.
	const toolCallTs = new Map<string, number>();
	for (const item of items) {
		if (item.toolCalls && item.toolCalls.length > 0) {
			const ts = Date.parse(item.ts);
			if (!Number.isNaN(ts)) {
				for (const tc of item.toolCalls) {
					toolCallTs.set(tc.id, ts);
				}
			}
		}
	}
	// Collect live-tool ids so we don't double-count the current turn.
	const liveToolIds = new Set(live?.tools ? Object.keys(live.tools) : []);
	for (const item of items) {
		if (item.kind === "tool_result" && item.toolResult) {
			const tcId = item.toolResult.toolCallId;
			if (liveToolIds.has(tcId)) continue; // current turn covered below
			const callTs = toolCallTs.get(tcId);
			if (callTs == null) continue;
			const resultTs = Date.parse(item.ts);
			if (!Number.isNaN(resultTs) && resultTs > callTs) {
				toolDurationMs += resultTs - callTs;
			}
		}
	}
	// Live tool execution times for the current turn (precise startedAt/endedAt).
	if (live?.tools) {
		for (const tool of Object.values(live.tools)) {
			if (tool.startedAt && tool.endedAt && tool.endedAt >= tool.startedAt) {
				toolDurationMs += tool.endedAt - tool.startedAt;
			}
		}
	}

	const steps = assistantCount + toolCallCount;

	// Cache hit rate: cacheRead / total input. `cacheWrite` tokens were computed
	// this request (cache miss, now stored) and `input` is the uncached remainder,
	// so misses = input + cacheWrite, hits = cacheRead.
	const totalInput = cacheRead + cacheWrite + inputTokens;
	const cacheHitRate =
		totalInput > 0 ? Math.min(100, Math.max(0, (cacheRead / totalInput) * 100)) : 0;

	return {
		rounds,
		steps,
		totalTokens,
		inputTokens,
		outputTokens,
		cacheRead,
		cacheWrite,
		cacheHitRate,
		modelDurationMs,
		toolDurationMs,
		avgTtftMs: ttftCount > 0 ? ttftSum / ttftCount : null,
		tps: timedMs > 0 ? timedOutput / (timedMs / 1000) : null,
		timedRequests,
		hasData: rounds > 0 || steps > 0 || totalTokens > 0,
	};
}

export function formatDuration(ms: number): string {
	if (!ms || ms <= 0) return tNow("chatView.sessionStats.durationZero");
	const totalSec = Math.round(ms / 1000);
	if (totalSec < 60) {
		return tNow("chatView.sessionStats.durationSecs", { s: totalSec });
	}
	const mins = Math.floor(totalSec / 60);
	const secs = totalSec % 60;
	if (mins < 60) {
		return secs > 0
			? tNow("chatView.sessionStats.durationMinsSecs", { m: mins, s: secs })
			: tNow("chatView.sessionStats.durationMins", { m: mins });
	}
	const hours = Math.floor(mins / 60);
	const remMins = mins % 60;
	return remMins > 0
		? tNow("chatView.sessionStats.durationHoursMins", { h: hours, m: remMins })
		: tNow("chatView.sessionStats.durationHours", { h: hours });
}

export function formatTokens(tokens: number): string {
	if (!tokens || tokens <= 0) return "0 token";
	if (tokens >= 1_000_000_000) {
		return `${(tokens / 1_000_000_000).toFixed(1)}B token`;
	}
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M token`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}k token`;
	}
	return `${tokens} token`;
}