/**
 * Category split for the context-window popover, mirroring the Claude app's "Context window" panel:
 * a slim 4px segmented progress bar, high-contrast category labels, right-aligned numbers, and
 * collapsible sub-item trees.
 */
import type { PromptComposition } from "../../lib/contracts";

export type ContextSegmentId =
	| "tools"
	| "system"
	| "mcp"
	| "skills"
	| "rules"
	| "other"
	| "messages"
	| "free";

export interface ContextSegment {
	id: ContextSegmentId;
	label: string;
	tokens: number;
	/** Hex color directly sampled from Claude desktop app. */
	color: string;
}

/**
 * Exact palette sampled from Claude App (Image #2):
 * - System tools: #3987e5 (vibrant blue)
 * - System prompt: #d95926 (terracotta orange)
 * - MCP tools: #189e71 (emerald green)
 * - Skills: #c98502 (warm amber)
 * - Rules: #8b5cf6 (violet)
 * - Dialog messages: #ec4899 (magenta/pink)
 * - Other: #6b7280 (neutral grey)
 * - Free space / Track: #32312f (dark charcoal track)
 */
export const CLAUDE_COLORS: Record<ContextSegmentId, string> = {
	tools: "#3987e5",
	system: "#d95926",
	mcp: "#189e71",
	skills: "#c98502",
	rules: "#8b5cf6",
	other: "#6b7280",
	messages: "#ec4899",
	free: "#32312f",
};

export const CLAUDE_LABELS: Record<ContextSegmentId, string> = {
	tools: "系统工具",
	system: "系统提示词",
	mcp: "MCP 工具",
	skills: "Skills",
	rules: "规则文件",
	other: "其他",
	messages: "对话消息",
	free: "剩余空间",
};

/** Same display order as Claude App (Image #2). */
const ORDER: ContextSegmentId[] = ["tools", "system", "mcp", "skills", "rules", "other", "messages", "free"];

/**
 * Splits `used` of `windowSize` tokens into the fixed prompt categories (estimated by probe)
 * plus messages and free space.
 */
export function buildContextSegments(
	used: number,
	windowSize: number,
	comp: PromptComposition | null,
): ContextSegment[] {
	const usedClamped = Math.min(Math.max(0, used), windowSize);
	const est = new Map<ContextSegmentId, number>();
	for (const c of comp?.categories ?? []) est.set(c.id as ContextSegmentId, (est.get(c.id as ContextSegmentId) ?? 0) + c.tokens);
	const estTotal = [...est.values()].reduce((a, b) => a + b, 0);
	const scale = estTotal > usedClamped && estTotal > 0 ? usedClamped / estTotal : 1;

	const tokens: Record<ContextSegmentId, number> = {
		tools: 0,
		system: 0,
		mcp: 0,
		skills: 0,
		rules: 0,
		other: 0,
		messages: 0,
		free: 0,
	};
	for (const [id, t] of est) tokens[id] = Math.round(t * scale);
	const fixed = Object.values(tokens).reduce((a, b) => a + b, 0);
	tokens.messages = Math.max(0, usedClamped - fixed);
	tokens.free = Math.max(0, windowSize - usedClamped);

	return ORDER.map((id) => ({
		id,
		label: CLAUDE_LABELS[id],
		tokens: tokens[id],
		color: CLAUDE_COLORS[id],
	}));
}
