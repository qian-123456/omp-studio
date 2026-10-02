/** Pure logic for the auto-compaction threshold card (no React / IPC). */

export type ThresholdMode = "default" | "tokens" | "percent";

export const TOKEN_PRESETS = [100_000, 150_000, 200_000, 250_000, 300_000, 500_000] as const;
export const PERCENT_PRESETS = [60, 70, 75, 80, 85, 90] as const;
export const PERCENT_MIN = 10;
export const PERCENT_MAX = 95;
/** Approximate reserve omp keeps when no explicit threshold is configured. */
export const DEFAULT_RESERVE_TOKENS = 20_000;

export interface CompactionThreshold {
	tokens: number;
	percent: number;
}

const UNITS: Record<string, number> = {
	"": 1,
	k: 1_000,
	千: 1_000,
	w: 10_000,
	万: 10_000,
	m: 1_000_000,
	百万: 1_000_000,
};

/**
 * Parse natural token expressions: `200k`, `30万`, `1.5M`, `250,000`, `200000`.
 * Returns a positive integer, or null when unparseable / non-positive.
 */
export function parseTokenInput(raw: string): number | null {
	const s = raw.trim().toLowerCase().replace(/[,_\s，]/g, "").replace(/tokens?$/, "");
	const m = /^(\d+(?:\.\d+)?)(k|千|w|万|m|百万)?$/.exec(s);
	if (!m) return null;
	const n = Math.round(Number(m[1]) * UNITS[m[2] ?? ""]);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** Parse `80`, `80%`, `0.8`-style is not supported (ambiguous); clamps to [10, 95]. */
export function parsePercentInput(raw: string): number | null {
	const s = raw.trim().replace(/[%％\s]/g, "");
	if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
	const n = Number(s);
	if (!Number.isFinite(n) || n <= 0) return null;
	return clampPercent(n);
}

export function clampPercent(n: number): number {
	return Math.min(PERCENT_MAX, Math.max(PERCENT_MIN, Math.round(n)));
}

function toNum(v: unknown): number {
	if (typeof v === "number") return v;
	if (typeof v === "string" && v.trim() !== "") {
		const n = Number(v);
		if (Number.isFinite(n)) return n;
	}
	return -1;
}

/** Normalize raw config values (number/string/undefined) into a threshold pair. */
export function readThreshold(tokens: unknown, percent: unknown): CompactionThreshold {
	return { tokens: toNum(tokens), percent: toNum(percent) };
}

/** Explicit token count wins over percent; both unset (≤0) = system default. */
export function resolveMode(t: CompactionThreshold): ThresholdMode {
	if (t.tokens > 0) return "tokens";
	if (t.percent > 0) return "percent";
	return "default";
}

/** Config writes for a mode switch / commit. Value -1 means "unset". */
export function thresholdWrites(mode: ThresholdMode, value?: number): [string, string][] {
	if (mode === "tokens" && value && value > 0) {
		return [
			["compaction.thresholdTokens", String(Math.round(value))],
			["compaction.thresholdPercent", "-1"],
		];
	}
	if (mode === "percent" && value && value > 0) {
		return [
			["compaction.thresholdPercent", String(clampPercent(value))],
			["compaction.thresholdTokens", "-1"],
		];
	}
	return [
		["compaction.thresholdTokens", "-1"],
		["compaction.thresholdPercent", "-1"],
	];
}

export function formatTokens(n: number): string {
	return n.toLocaleString("en-US");
}

/** Compact preset label: 100000 → `100K`, 1500000 → `1.5M`. */
export function formatTokenShort(n: number): string {
	if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(2)}M`;
	if (n >= 1_000) return `${+(n / 1_000).toFixed(1)}K`;
	return String(n);
}

export function describeStrategy(t: CompactionThreshold, enabled = true): string {
	if (!enabled) return "当前策略：自动压缩已关闭，上下文满时需手动压缩";
	switch (resolveMode(t)) {
		case "tokens":
			return `当前策略：当会话达到 ${formatTokens(t.tokens)} Token 时自动在后台生成摘要并压缩`;
		case "percent":
			return `当前策略：当会话上下文达到模型窗口的 ${t.percent}% 时自动压缩`;
		default:
			return `当前策略：使用系统默认（预留约 ${formatTokens(DEFAULT_RESERVE_TOKENS)} Token 时压缩）`;
	}
}
