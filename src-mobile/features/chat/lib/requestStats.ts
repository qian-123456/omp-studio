/* Per-request model stats, TUI-style glyphs. Typed port of the legacy
   request-stats.js (same math and formatting). The phone always shows the six
   LINE_FIELDS; duration/cost stay card-only. */

export type StatField = "time" | "input" | "output" | "cache" | "ttft" | "tps" | "duration" | "cost";

export interface RequestUsage {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
	cost: number;
}

export interface RequestStat {
	startedAt: number | null;
	completedAt: number | null;
	durationMs: number | null;
	ttftMs: number | null;
	usage: RequestUsage | null;
}

/** Field metadata: TUI glyph plus the Chinese explanation shown in the tap card. */
export const FIELDS: Record<StatField, { glyph: string; label: string; description: string }> = {
	time: { glyph: "", label: "开始时间", description: "这次请求发出的时间" },
	input: { glyph: "↘", label: "输入", description: "发给模型的新内容，含写入缓存的部分" },
	output: { glyph: "↗", label: "输出", description: "模型生成的内容（含思考）" },
	cache: { glyph: "💾", label: "缓存命中", description: "直接从缓存读取的内容，更快更便宜" },
	ttft: { glyph: "⏱", label: "首字延迟", description: "从发出请求到收到第一个字的时间" },
	tps: { glyph: "⚡", label: "输出速度", description: "每秒生成的 token 数（输出 ÷ 总耗时）" },
	duration: { glyph: "⌛", label: "总耗时", description: "这次请求从发出到结束的时间" },
	cost: { glyph: "$", label: "费用", description: "这次请求的费用（美元）" },
};

/** Display order of every field. */
export const FIELD_IDS: readonly StatField[] = ["time", "input", "output", "cache", "ttft", "tps", "duration", "cost"];
/** What the phone always renders on the stats line. */
export const LINE_FIELDS: readonly StatField[] = ["time", "input", "output", "cache", "ttft", "tps"];

export const MISSING = "—";

const finiteOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function buildStat(
	completedAt: number | null,
	durationMs: number | null,
	ttftMs: number | null,
	usage: RequestUsage | null,
): RequestStat {
	return {
		startedAt: completedAt != null && durationMs != null ? completedAt - durationMs : completedAt,
		completedAt,
		durationMs,
		ttftMs,
		usage,
	};
}

function usageOf(u: unknown): RequestUsage | null {
	if (!u || typeof u !== "object") return null;
	const r = u as Record<string, unknown>;
	const cost = r.cost;
	return {
		input: finiteOrNull(r.input) ?? 0,
		output: finiteOrNull(r.output) ?? 0,
		cacheRead: finiteOrNull(r.cacheRead) ?? 0,
		cacheWrite: finiteOrNull(r.cacheWrite) ?? 0,
		totalTokens: finiteOrNull(r.totalTokens) ?? 0,
		cost:
			finiteOrNull(cost) ??
			(cost && typeof cost === "object" ? (finiteOrNull((cost as Record<string, unknown>).total) ?? 0) : 0),
	};
}

export interface StatItemLike {
	kind?: string;
	ts?: string | null;
	completedAt?: number | null;
	duration?: number | null;
	ttft?: number | null;
	usage?: unknown;
}

/** Stats for an assistant transcript item; null for every other kind. */
export function requestStatFromItem(item: StatItemLike | null | undefined): RequestStat | null {
	if (!item || item.kind !== "assistant") return null;
	const parsedTs = item.ts ? Date.parse(item.ts) : Number.NaN;
	return buildStat(
		finiteOrNull(item.completedAt) ?? (Number.isNaN(parsedTs) ? null : parsedTs),
		finiteOrNull(item.duration),
		finiteOrNull(item.ttft),
		usageOf(item.usage),
	);
}

/** Stats from a raw omp assistant message object (rpc `message_end.message`). */
export function requestStatFromMessage(msg: Record<string, unknown>, fallbackTs?: number | null): RequestStat {
	return buildStat(
		finiteOrNull(msg.completedAt) ?? finiteOrNull(msg.timestamp) ?? fallbackTs ?? null,
		finiteOrNull(msg.duration),
		finiteOrNull(msg.ttft),
		usageOf(msg.usage),
	);
}

/** Output tokens per second over the whole request (TUI ⚡); null without duration. */
export function tokensPerSecond(stat: RequestStat | null | undefined): number | null {
	if (!stat || !stat.usage || !stat.durationMs || stat.durationMs <= 0) return null;
	return stat.usage.output / (stat.durationMs / 1000);
}

/** TUI-style compact token count: 235, 1.3K, 16K, 1.2M. */
export function formatStatTokens(n: number | null | undefined): string {
	if (typeof n !== "number" || !Number.isFinite(n)) return MISSING;
	if (n < 1000) return String(Math.round(n));
	if (n < 10000) return `${(n / 1000).toFixed(1)}K`;
	if (n < 1000000) return `${Math.round(n / 1000)}K`;
	return `${(n / 1000000).toFixed(1)}M`;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local HH:MM:SS. */
export function formatStatClock(epochMs: number): string {
	const d = new Date(epochMs);
	return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

/** Seconds with one decimal: 2400 -> "2.4s". */
export function formatStatSeconds(ms: number | null | undefined): string {
	if (typeof ms !== "number" || !Number.isFinite(ms)) return MISSING;
	return `${(ms / 1000).toFixed(1)}s`;
}

/** Local `2026年10月16日 12:47:23`. */
export function formatStatDateTime(epochMs: number): string {
	const d = new Date(epochMs);
	return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${formatStatClock(epochMs)}`;
}

export function isToday(epochMs: number): boolean {
	const d = new Date(epochMs);
	const n = new Date();
	return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

/** Formatted value of one field, or null when the request did not record it. */
export function fieldText(stat: RequestStat, field: StatField): string | null {
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
			return stat.ttftMs == null ? null : formatStatSeconds(stat.ttftMs);
		case "tps": {
			const tps = tokensPerSecond(stat);
			return tps == null ? null : `${tps.toFixed(1)}/s`;
		}
		case "duration":
			return stat.durationMs == null ? null : formatStatSeconds(stat.durationMs);
		case "cost":
			return u ? u.cost.toFixed(u.cost < 1 ? 3 : 2) : null;
	}
}

/** The six always-on fields of one request, each formatted ("—" when missing). */
export function formatRequestStat(stat: RequestStat): { field: StatField; glyph: string; text: string }[] {
	return LINE_FIELDS.map((field) => ({
		field,
		glyph: FIELDS[field].glyph,
		text: fieldText(stat, field) ?? MISSING,
	}));
}

/** Waiting-for-first-token vs generation split for the card bar; null when it cannot be drawn. */
export function ttftSplit(
	stat: RequestStat,
): { ttftMs: number; generationMs: number; waitPercent: number } | null {
	const dur = stat.durationMs;
	const ttft = stat.ttftMs;
	if (dur == null || !(dur > 0) || ttft == null) return null;
	return {
		ttftMs: ttft,
		generationMs: Math.max(0, dur - ttft),
		waitPercent: Math.min(98, Math.max(2, (ttft / dur) * 100)),
	};
}
