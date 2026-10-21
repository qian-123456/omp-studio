/**
 * Category split for the context-window popover, mirroring the Claude app's "Context window"
 * panel: a segmented bar plus one row per category (tokens and share of the window).
 */
import type { PromptComposition } from "../../lib/contracts";
import { DEFAULT_RESERVE_TOKENS, readThreshold, resolveMode } from "../settings/autoCompactionLogic";
import { compactionTriggerPoint } from "../settings/contextWindow/core";

export type ContextSegmentId =
	| "tools"
	| "system"
	| "mcp"
	| "rules"
	| "skills"
	| "other"
	| "messages"
	| "free"
	| "buffer";

export interface ContextSegment {
	id: ContextSegmentId;
	label: string;
	tokens: number;
	/** CSS colour (theme tokens only). */
	color: string;
}

/** Claude app palette: tools blue, prompt orange, MCP green, skills yellow-green, free grey. */
const COLOR: Record<ContextSegmentId, string> = {
	tools: "var(--status-renamed)",
	system: "var(--status-warning)",
	mcp: "var(--status-success)",
	rules: "color-mix(in srgb, var(--status-renamed) 55%, var(--status-success))",
	skills: "color-mix(in srgb, var(--status-warning) 55%, var(--status-success))",
	other: "var(--text-dim)",
	messages: "var(--accent-strong)",
	free: "var(--bg-selected)",
	buffer: "color-mix(in srgb, var(--text-dim) 55%, var(--bg-selected))",
};

const LABEL: Record<ContextSegmentId, string> = {
	tools: "系统工具",
	system: "系统提示词",
	mcp: "MCP 工具",
	rules: "规则文件",
	skills: "Skills",
	other: "其他",
	messages: "对话消息",
	free: "剩余空间",
	buffer: "自动压缩缓冲",
};

/** Same order as the Claude app: fixed parts, messages, free space, then the compaction buffer. */
const ORDER: ContextSegmentId[] = ["tools", "system", "mcp", "rules", "skills", "other", "messages", "free", "buffer"];

/** Claude keeps this much free when autocompaction is off ("Compact buffer"). */
const COMPACT_BUFFER_TOKENS = 3000;

export interface CompactionBuffer {
	tokens: number;
	label: string;
}

/**
 * Headroom between the auto-compaction trigger and the end of the window. Falls back to Claude's
 * fixed 3k compact buffer when auto-compaction is off, and to omp's default reserve otherwise.
 */
export function compactionBuffer(
	windowSize: number,
	cfg: { enabled: boolean; thresholdTokens: unknown; thresholdPercent: unknown },
): CompactionBuffer {
	if (windowSize <= 0) return { tokens: 0, label: LABEL.buffer };
	if (!cfg.enabled) return { tokens: Math.min(windowSize, COMPACT_BUFFER_TOKENS), label: "压缩缓冲" };
	const t = readThreshold(cfg.thresholdTokens, cfg.thresholdPercent);
	const mode = resolveMode(t);
	const trigger =
		mode === "default"
			? Math.max(0, windowSize - DEFAULT_RESERVE_TOKENS)
			: compactionTriggerPoint(windowSize, { mode, value: mode === "percent" ? t.percent : t.tokens }).tokens;
	return { tokens: Math.max(0, windowSize - trigger), label: LABEL.buffer };
}

/**
 * Splits `used` of `windowSize` tokens into the fixed prompt categories (estimated by the probe)
 * plus messages (the remainder), free space and the compaction buffer. Without a probe everything
 * used counts as messages. When the estimate exceeds what omp reports as used, the categories are
 * scaled down to fit. The buffer only occupies what usage has not already eaten into.
 */
export function buildContextSegments(
	used: number,
	windowSize: number,
	comp: PromptComposition | null,
	buffer: CompactionBuffer = { tokens: 0, label: LABEL.buffer },
): ContextSegment[] {
	const usedClamped = Math.min(Math.max(0, used), windowSize);
	const est = new Map<ContextSegmentId, number>();
	for (const c of comp?.categories ?? []) est.set(c.id, (est.get(c.id) ?? 0) + c.tokens);
	const estTotal = [...est.values()].reduce((a, b) => a + b, 0);
	const scale = estTotal > usedClamped && estTotal > 0 ? usedClamped / estTotal : 1;

	const tokens: Record<ContextSegmentId, number> = {
		tools: 0,
		system: 0,
		mcp: 0,
		rules: 0,
		skills: 0,
		other: 0,
		messages: 0,
		free: 0,
		buffer: 0,
	};
	for (const [id, t] of est) tokens[id] = Math.round(t * scale);
	const fixed = Object.values(tokens).reduce((a, b) => a + b, 0);
	tokens.messages = Math.max(0, usedClamped - fixed);
	const remaining = Math.max(0, windowSize - usedClamped);
	tokens.buffer = Math.min(remaining, Math.max(0, buffer.tokens));
	tokens.free = remaining - tokens.buffer;

	return ORDER.map((id) => ({
		id,
		label: id === "buffer" ? buffer.label : LABEL[id],
		tokens: tokens[id],
		color: COLOR[id],
	}));
}
