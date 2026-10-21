/** Pure helpers for the context-usage popover: split used tokens into categories (Claude Code /context style). */
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

const COLOR: Record<ContextSegmentId, string> = {
	system: "var(--accent)",
	tools: "var(--accent-strong)",
	mcp: "color-mix(in srgb, var(--accent) 45%, var(--text-dim))",
	rules: "var(--status-warning)",
	skills: "var(--status-success)",
	other: "var(--text-dim)",
	messages: "var(--text)",
	free: "var(--bg-selected)",
	buffer: "color-mix(in srgb, var(--status-warning) 28%, var(--bg-selected))",
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

/** Display order, same as Claude Code: fixed overhead, messages, free space, autocompact buffer. */
const ORDER: ContextSegmentId[] = ["system", "tools", "mcp", "rules", "skills", "other", "messages", "free", "buffer"];

/**
 * Tokens between the auto-compaction trigger and the window end: the headroom omp keeps so a
 * turn can finish before compaction runs. 0 when auto-compaction is off or the trigger is unreachable.
 */
export function autocompactBuffer(
	windowSize: number,
	cfg: { enabled: boolean; thresholdTokens: unknown; thresholdPercent: unknown },
): number {
	if (!cfg.enabled || windowSize <= 0) return 0;
	const t = readThreshold(cfg.thresholdTokens, cfg.thresholdPercent);
	const mode = resolveMode(t);
	const trigger =
		mode === "default"
			? Math.max(0, windowSize - DEFAULT_RESERVE_TOKENS)
			: compactionTriggerPoint(windowSize, { mode, value: mode === "percent" ? t.percent : t.tokens }).tokens;
	return Math.min(windowSize, Math.max(0, windowSize - trigger));
}

/**
 * Splits `used` of `windowSize` tokens into the fixed prompt categories (estimated by the probe)
 * plus messages (the remainder), free space and the autocompact buffer. Without a probe everything
 * used counts as messages. When the estimate exceeds what omp reports as used, the categories are
 * scaled down to fit. The buffer only occupies what usage has not already eaten into.
 */
export function buildContextSegments(
	used: number,
	windowSize: number,
	comp: PromptComposition | null,
	bufferTokens = 0,
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
	tokens.buffer = Math.min(remaining, Math.max(0, bufferTokens));
	tokens.free = remaining - tokens.buffer;

	return ORDER.map((id) => ({ id, label: LABEL[id], tokens: tokens[id], color: COLOR[id] }));
}

/**
 * Allocates `cellCount` grid cells to segments in order. Every non-empty used segment gets at
 * least one cell so small categories stay visible. Free space fills the middle and the autocompact
 * buffer sits at the end, as in Claude Code.
 */
export function allocateCells(segments: ContextSegment[], windowSize: number, cellCount: number): ContextSegmentId[] {
	if (windowSize <= 0) return Array(cellCount).fill("free");
	const used = segments.filter((s) => s.id !== "free" && s.id !== "buffer" && s.tokens > 0);
	const counts = used.map((s) => Math.max(1, Math.round((s.tokens / windowSize) * cellCount)));
	const buffer = segments.find((s) => s.id === "buffer")?.tokens ?? 0;
	let bufferCells = buffer > 0 ? Math.max(1, Math.round((buffer / windowSize) * cellCount)) : 0;
	// Trim overshoot from the largest used segment so the grid never overflows.
	let total = counts.reduce((a, b) => a + b, 0) + bufferCells;
	while (total > cellCount) {
		let big = 0;
		for (let i = 1; i < counts.length; i++) if (counts[i] > counts[big]) big = i;
		if (counts.length > 0 && counts[big] > 1) counts[big]--;
		else if (bufferCells > 0) bufferCells--;
		else break;
		total--;
	}
	const cells: ContextSegmentId[] = [];
	used.forEach((s, i) => {
		for (let n = 0; n < counts[i] && cells.length < cellCount; n++) cells.push(s.id);
	});
	while (cells.length < cellCount - bufferCells) cells.push("free");
	while (cells.length < cellCount) cells.push("buffer");
	return cells;
}
