/**
 * Port of Claude Code 2.1.300's `/context` panel (`mHn` + the `G` renderer in its bundle):
 * category order, grid allocation, and labels. Claude renders the grid with terminal glyphs
 * (⛀ partly filled, ⛁ filled, ⛶ free, ⛝ autocompact buffer); here each glyph is a cell with a
 * fullness value instead, so the GUI can draw the same block.
 */
import type { PromptComposition } from "../../lib/contracts";
import { DEFAULT_RESERVE_TOKENS, readThreshold, resolveMode } from "../settings/autoCompactionLogic";
import { compactionTriggerPoint } from "../settings/contextWindow/core";

export type ContextSegmentId =
	| "system"
	| "tools"
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

/** Claude's hues: prompt=blue, tools/buffer=grey, MCP=cyan, memory=orange, skills=green, messages=purple. */
const COLOR: Record<ContextSegmentId, string> = {
	system: "var(--accent)",
	tools: "var(--text-dim)",
	mcp: "var(--status-renamed)",
	rules: "var(--status-warning)",
	skills: "var(--status-success)",
	other: "color-mix(in srgb, var(--text-dim) 55%, var(--bg))",
	messages: "var(--accent-strong)",
	free: "var(--bg-selected)",
	buffer: "color-mix(in srgb, var(--text-dim) 45%, var(--bg-selected))",
};

const LABEL: Record<ContextSegmentId, string> = {
	system: "系统提示词",
	tools: "系统工具",
	mcp: "MCP 工具",
	rules: "规则文件",
	skills: "Skills",
	other: "其他",
	messages: "对话消息",
	free: "剩余空间",
	buffer: "自动压缩缓冲",
};

/** Same order as Claude: fixed prompt parts, messages, free space, then the compaction buffer. */
const ORDER: ContextSegmentId[] = ["system", "tools", "mcp", "rules", "skills", "other", "messages", "free", "buffer"];

/** Claude keeps this much free when autocompaction is off ("Compact buffer"). */
const COMPACT_BUFFER_TOKENS = 3000;

/** Claude's grid: 10×10 cells, or 20×10 once the window reaches 1M tokens. */
export function gridShape(windowSize: number): { cols: number; rows: number } {
	return { cols: windowSize >= 1_000_000 ? 20 : 10, rows: 10 };
}

export interface CompactionBuffer {
	tokens: number;
	label: string;
}

/**
 * Tokens between the auto-compaction trigger and the end of the window: the headroom the agent
 * keeps so a turn can finish before compaction runs. Falls back to Claude's fixed 3k "compact
 * buffer" when auto-compaction is off, and to omp's default reserve when no threshold is set.
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
		system: 0,
		tools: 0,
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

export interface GridCell {
	id: ContextSegmentId;
	/** 0–1; Claude picks ⛀ below 0.7 and ⛁ at or above it. */
	fullness: number;
}

/**
 * Port of Claude's grid filler: every non-empty category gets at least one cell, free space fills
 * the middle, and the compaction buffer closes the block. A partially filled trailing cell keeps
 * its fraction so rounded-up categories still read as smaller than full ones.
 */
export function allocateCells(
	segments: ContextSegment[],
	windowSize: number,
	shape: { cols: number; rows: number },
): GridCell[] {
	const total = shape.cols * shape.rows;
	if (windowSize <= 0) return Array.from({ length: total }, () => ({ id: "free", fullness: 1 }));
	const buffer = segments.find((s) => s.id === "buffer")?.tokens ?? 0;
	const bufferCells = buffer > 0 ? Math.min(total, Math.max(1, Math.round((buffer / windowSize) * total))) : 0;
	const cells: GridCell[] = [];
	for (const s of segments) {
		if (s.id === "free" || s.id === "buffer" || s.tokens <= 0) continue;
		const raw = (s.tokens / windowSize) * total;
		const whole = Math.floor(raw);
		const count = Math.max(1, Math.round(raw));
		for (let i = 0; i < count && cells.length < total - bufferCells; i++) {
			cells.push({ id: s.id, fullness: i === whole && raw - whole > 0 ? raw - whole : 1 });
		}
	}
	while (cells.length < total - bufferCells) cells.push({ id: "free", fullness: 1 });
	while (cells.length < total) cells.push({ id: "buffer", fullness: 1 });
	return cells;
}
