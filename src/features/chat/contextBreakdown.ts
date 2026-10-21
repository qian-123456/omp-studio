/** Pure helpers for the context-usage popover: split used tokens into categories (Claude Code /context style). */
import type { PromptComposition } from "../../lib/contracts";

export type ContextSegmentId = "system" | "tools" | "mcp" | "rules" | "skills" | "other" | "messages" | "free";

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
};

/** Display order, same idea as Claude Code: fixed overhead first, then messages, then free. */
const ORDER: ContextSegmentId[] = ["system", "tools", "mcp", "rules", "skills", "other", "messages", "free"];

/**
 * Splits `used` of `windowSize` tokens into the fixed prompt categories (estimated by the probe)
 * plus messages (the remainder) and free space. Without a probe everything used counts as messages.
 * When the estimate exceeds what omp reports as used, the categories are scaled down to fit.
 */
export function buildContextSegments(
	used: number,
	windowSize: number,
	comp: PromptComposition | null,
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
	};
	for (const [id, t] of est) tokens[id] = Math.round(t * scale);
	const fixed = Object.values(tokens).reduce((a, b) => a + b, 0);
	tokens.messages = Math.max(0, usedClamped - fixed);
	tokens.free = Math.max(0, windowSize - usedClamped);

	return ORDER.map((id) => ({ id, label: LABEL[id], tokens: tokens[id], color: COLOR[id] }));
}

/**
 * Allocates `cellCount` grid cells to segments in order. Every non-empty used segment gets at
 * least one cell so small categories stay visible; the free segment takes the rest.
 */
export function allocateCells(segments: ContextSegment[], windowSize: number, cellCount: number): ContextSegmentId[] {
	if (windowSize <= 0) return Array(cellCount).fill("free");
	const used = segments.filter((s) => s.id !== "free" && s.tokens > 0);
	const counts = used.map((s) => Math.max(1, Math.round((s.tokens / windowSize) * cellCount)));
	// Trim overshoot from the largest segment so the grid never overflows.
	let total = counts.reduce((a, b) => a + b, 0);
	while (total > cellCount) {
		let big = 0;
		for (let i = 1; i < counts.length; i++) if (counts[i] > counts[big]) big = i;
		if (counts[big] <= 1) break;
		counts[big]--;
		total--;
	}
	const cells: ContextSegmentId[] = [];
	used.forEach((s, i) => {
		for (let n = 0; n < counts[i] && cells.length < cellCount; n++) cells.push(s.id);
	});
	while (cells.length < cellCount) cells.push("free");
	return cells;
}
