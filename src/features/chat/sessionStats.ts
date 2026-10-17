import type { TranscriptItem } from "../../lib/contracts";
import type { SessionLive } from "../../stores/live";
import { type RequestStat, requestStatFromItem } from "./requestStats";

export interface ComputedSessionStats {
	rounds: number;
	steps: number;
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	cacheHitRate: number; // 0 - 100
	/** Σ request durations reported by the model; 0 when nothing recorded one. */
	modelDurationMs: number;
	toolDurationMs: number;
	/** Mean of the real per-request `ttft` values; null when none were recorded. */
	avgTtftMs: number | null;
	/** Σ output ÷ Σ duration over requests that recorded a duration; null when none did. */
	tps: number | null;
	/** Number of model requests that recorded a duration. */
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
	for (const req of live?.liveRequests ?? []) push(req.stat);
	return stats;
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
		} else if (item.kind === "assistant") {
			assistantCount++;
		}

		if (item.toolCalls && item.toolCalls.length > 0) {
			toolCallCount += item.toolCalls.length;
		}

		// Token usage accumulation
		if (item.usage) {
			inputTokens += item.usage.input || 0;
			outputTokens += item.usage.output || 0;
			cacheRead += item.usage.cacheRead || 0;
			cacheWrite += item.usage.cacheWrite || 0;
			totalTokens += item.usage.totalTokens || (item.usage.input + item.usage.output);
		}
	}

	// Real per-request timing comes from the messages themselves; live requests
	// of the current turn are folded in until the transcript catches up.
	for (const stat of sessionRequestStats(items, live)) {
		if (stat.durationMs != null && stat.durationMs > 0) {
			modelDurationMs += stat.durationMs;
			timedMs += stat.durationMs;
			timedOutput += stat.usage?.output ?? 0;
			timedRequests++;
		}
		if (stat.ttftMs != null) {
			ttftSum += stat.ttftMs;
			ttftCount++;
		}
	}

	// Incorporate live tool execution times if available
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
	if (!ms || ms <= 0) return "0秒";
	const totalSec = Math.round(ms / 1000);
	if (totalSec < 60) {
		return `${totalSec}秒`;
	}
	const mins = Math.floor(totalSec / 60);
	const secs = totalSec % 60;
	if (mins < 60) {
		return secs > 0 ? `${mins}分${secs}秒` : `${mins}分钟`;
	}
	const hours = Math.floor(mins / 60);
	const remMins = mins % 60;
	return remMins > 0 ? `${hours}小时${remMins}分` : `${hours}小时`;
}

export function formatTokens(tokens: number): string {
	if (!tokens || tokens <= 0) return "0 tok";
	if (tokens >= 1_000_000_000) {
		return `${(tokens / 1_000_000_000).toFixed(1)}B tok`;
	}
	if (tokens >= 1_000_000) {
		return `${(tokens / 1_000_000).toFixed(1)}M tok`;
	}
	if (tokens >= 1_000) {
		return `${(tokens / 1_000).toFixed(1)}k tok`;
	}
	return `${tokens} tok`;
}