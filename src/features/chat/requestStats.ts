import type { TranscriptItem, Usage } from "../../lib/contracts";
import {
	REQUEST_STAT_FIELD_IDS,
	type RequestStatField,
	type RequestStatFieldPrefs,
} from "../../stores/displayPrefs";

/** Stats of one model request (= one assistant message), as recorded by omp. */
export interface RequestStat {
	/** Request start, epoch ms (completion − duration); null when unknown. */
	startedAt: number | null;
	/** Completion time, epoch ms. */
	completedAt: number | null;
	/** Total request duration in ms. */
	durationMs: number | null;
	/** Time to first token in ms. */
	ttftMs: number | null;
	usage: Usage | null;
	/** Failure reason when the request ended with stopReason "error"; null otherwise
	 * (a user abort is not a failure). Failed requests carry no usable speed/ttft. */
	error: string | null;
}

/** Field metadata: TUI glyph plus the Chinese explanation shown in the hover/tap card. */
export const REQUEST_STAT_FIELDS: Record<
	RequestStatField,
	{ glyph: string; label: string; description: string }
> = {
	time: { glyph: "", label: "开始时间", description: "这次请求发出的时间" },
	input: { glyph: "↘", label: "输入", description: "发给模型的新内容，含写入缓存的部分" },
	output: { glyph: "↗", label: "输出", description: "模型生成的内容（含思考）" },
	cache: { glyph: "💾", label: "缓存命中", description: "直接从缓存读取的内容，更快更便宜" },
	ttft: { glyph: "⏱", label: "首字延迟", description: "从发出请求到收到第一个字的时间" },
	tps: { glyph: "⚡", label: "输出速度", description: "每秒生成的 token 数（输出 ÷ 总耗时）" },
	duration: { glyph: "⌛", label: "总耗时", description: "这次请求从发出到结束的时间" },
	cost: { glyph: "$", label: "费用", description: "这次请求的费用（美元）" },
};

const MISSING = "—";

const finiteOrNull = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

const FALLBACK_ERROR = "请求失败，未返回原因";

function buildStat(
	completedAt: number | null,
	durationMs: number | null,
	ttftMs: number | null,
	usage: Usage | null,
	error: string | null,
): RequestStat {
	return {
		startedAt:
			completedAt != null && durationMs != null ? completedAt - durationMs : completedAt,
		completedAt,
		durationMs,
		ttftMs: error ? null : ttftMs,
		usage,
		error,
	};
}

/** Stats for an assistant transcript item; null for every other kind. */
export function requestStatFromItem(item: TranscriptItem): RequestStat | null {
	if (item.kind !== "assistant") return null;
	const parsedTs = Date.parse(item.ts);
	return buildStat(
		item.completedAt ?? (Number.isNaN(parsedTs) ? null : parsedTs),
		item.duration ?? null,
		item.ttft ?? null,
		item.usage,
		item.stopReason === "error" ? item.text?.trim() || FALLBACK_ERROR : null,
	);
}

/** Stats from a raw omp assistant message object (rpc `message_end.message`). */
export function requestStatFromMessage(
	msg: Record<string, unknown>,
	fallbackTs: number,
): RequestStat {
	const u = msg.usage && typeof msg.usage === "object" ? (msg.usage as Record<string, unknown>) : null;
	const cost = u?.cost;
	const usage: Usage | null = u
		? {
				input: finiteOrNull(u.input) ?? 0,
				output: finiteOrNull(u.output) ?? 0,
				cacheRead: finiteOrNull(u.cacheRead) ?? 0,
				cacheWrite: finiteOrNull(u.cacheWrite) ?? 0,
				totalTokens: finiteOrNull(u.totalTokens) ?? 0,
				cost:
					finiteOrNull(cost) ??
					(cost && typeof cost === "object"
						? (finiteOrNull((cost as Record<string, unknown>).total) ?? 0)
						: 0),
			}
		: null;
	const errText = typeof msg.errorMessage === "string" ? msg.errorMessage.trim() : "";
	return buildStat(
		finiteOrNull(msg.completedAt) ?? finiteOrNull(msg.timestamp) ?? fallbackTs,
		finiteOrNull(msg.duration),
		finiteOrNull(msg.ttft),
		usage,
		msg.stopReason === "error" ? errText || FALLBACK_ERROR : null,
	);
}

/** Output tokens per second over the whole request (TUI ⚡); null without duration. */
export function tokensPerSecond(stat: RequestStat): number | null {
	if (stat.error || !stat.usage || !stat.durationMs || stat.durationMs <= 0) return null;
	return stat.usage.output / (stat.durationMs / 1000);
}

/** TUI-style compact token count: 235, 1.3K, 16K, 1.2M. */
export function formatStatTokens(n: number): string {
	if (n < 1_000) return String(Math.round(n));
	if (n < 10_000) return `${(n / 1_000).toFixed(1)}K`;
	if (n < 1_000_000) return `${Math.round(n / 1_000)}K`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local HH:MM:SS. */
export function formatStatClock(epochMs: number): string {
	const d = new Date(epochMs);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export interface StatPart {
	field: RequestStatField;
	glyph: string;
	/** Formatted value, or "—" when the request did not record it. */
	text: string;
}

function fieldText(stat: RequestStat, field: RequestStatField): string | null {
	const u = stat.usage;
	switch (field) {
		case "time":
			return stat.startedAt == null ? null : formatStatClock(stat.startedAt);
		case "input":
			return u ? formatStatTokens(u.input + u.cacheWrite) : null;
		case "output":
			return u ? formatStatTokens(u.output) : null;
		case "cache":
			return u ? formatStatTokens(u.cacheRead) : null;
		case "ttft":
			return stat.ttftMs == null ? null : `${(stat.ttftMs / 1000).toFixed(1)}s`;
		case "tps": {
			const tps = tokensPerSecond(stat);
			return tps == null ? null : `${tps.toFixed(1)}/s`;
		}
		case "duration":
			return stat.durationMs == null ? null : `${(stat.durationMs / 1000).toFixed(1)}s`;
		case "cost":
			return u ? u.cost.toFixed(u.cost < 1 ? 3 : 2) : null;
	}
}

/** Enabled fields in display order, each formatted ("—" when missing). */
export function formatRequestStat(
	stat: RequestStat,
	fields: RequestStatFieldPrefs,
): StatPart[] {
	return REQUEST_STAT_FIELD_IDS.filter((f) => fields[f]).map((field) => ({
		field,
		glyph: REQUEST_STAT_FIELDS[field].glyph,
		text: fieldText(stat, field) ?? MISSING,
	}));
}

/** Text pieces of a failed request's line: no token / speed fields, full reason. */
export interface FailedRequestText {
	/** Local HH:MM:SS the request started, or null when unknown. */
	time: string | null;
	label: string;
	/** 「等待 61.2s」, or null when no duration was recorded. */
	wait: string | null;
	/** The complete failure reason, never shortened. */
	reason: string;
}

export function formatFailedRequest(stat: RequestStat): FailedRequestText | null {
	if (!stat.error) return null;
	return {
		time: stat.startedAt == null ? null : formatStatClock(stat.startedAt),
		label: "请求失败",
		wait: stat.durationMs == null ? null : `等待 ${(stat.durationMs / 1000).toFixed(1)}s`,
		reason: stat.error,
	};
}

export interface TurnStatTotals {
	/** Number of requests in the turn. */
	count: number;
	/** How many of them failed (stopReason "error"); excluded from avgTps. */
	failed: number;
	/** Σ (input + cacheWrite). */
	input: number;
	output: number;
	cacheRead: number;
	cost: number;
	/** Σ output ÷ Σ duration over requests that recorded a duration. */
	avgTps: number | null;
}

/** Whole-turn totals for the 「已处理 xx 秒」 hover. */
export function aggregateRequestStats(stats: RequestStat[]): TurnStatTotals {
	let input = 0;
	let output = 0;
	let cacheRead = 0;
	let cost = 0;
	let timedOutput = 0;
	let timedMs = 0;
	let failed = 0;
	for (const s of stats) {
		if (s.error) failed++;
		const u = s.usage;
		if (!u) continue;
		input += u.input + u.cacheWrite;
		output += u.output;
		cacheRead += u.cacheRead;
		cost += u.cost;
		if (!s.error && s.durationMs && s.durationMs > 0) {
			timedOutput += u.output;
			timedMs += s.durationMs;
		}
	}
	return {
		count: stats.length,
		failed,
		input,
		output,
		cacheRead,
		cost,
		avgTps: timedMs > 0 ? timedOutput / (timedMs / 1000) : null,
	};
}
