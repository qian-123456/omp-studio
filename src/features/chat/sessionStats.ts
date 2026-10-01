import type { TranscriptItem } from "../../lib/contracts";
import type { SessionLive } from "../../stores/live";

export interface ComputedSessionStats {
	rounds: number;
	steps: number;
	totalTokens: number;
	inputTokens: number;
	outputTokens: number;
	cacheRead: number;
	cacheWrite: number;
	cacheHitRate: number; // 0 - 100
	modelDurationMs: number;
	toolDurationMs: number;
	avgTtftMs: number;
	tps: number;
	hasData: boolean;
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
	const ttftList: number[] = [];

	let prevItem: TranscriptItem | null = null;

	for (let i = 0; i < items.length; i++) {
		const item = items[i];

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

		// Calculate approximate TTFT: time between user message and first assistant item
		if (
			prevItem &&
			prevItem.kind === "user" &&
			(item.kind === "assistant" || item.toolCalls?.length > 0)
		) {
			const userTs = new Date(prevItem.ts).getTime();
			const astTs = new Date(item.ts).getTime();
			if (!Number.isNaN(userTs) && !Number.isNaN(astTs) && astTs >= userTs) {
				const diff = astTs - userTs;
				if (diff < 60_000) {
					// exclude idle pauses
					ttftList.push(diff);
				}
			}
		}

		// Approximate duration between consecutive events
		if (prevItem) {
			const prevTs = new Date(prevItem.ts).getTime();
			const curTs = new Date(item.ts).getTime();
			if (!Number.isNaN(prevTs) && !Number.isNaN(curTs) && curTs >= prevTs) {
				const delta = curTs - prevTs;
				if (delta < 300_000) {
					// exclude long pauses (> 5 min)
					if (item.kind === "tool_result" || prevItem.toolCalls?.length > 0) {
						toolDurationMs += delta;
					} else if (item.kind === "assistant") {
						modelDurationMs += delta;
					}
				}
			}
		}

		prevItem = item;
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

	// Average TTFT
	const avgTtftMs =
		ttftList.length > 0
			? ttftList.reduce((a, b) => a + b, 0) / ttftList.length
			: 0;

	// TPS (tokens per second)
	let tps = 0;
	if (modelDurationMs > 0 && outputTokens > 0) {
		tps = Math.round((outputTokens / (modelDurationMs / 1000)) * 10) / 10;
	}

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
		avgTtftMs,
		tps,
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
