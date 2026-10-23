/**
 * Exact context categories and colors adapted from Claude Desktop App,
 * wired to omp-workspace's semantic design system CSS variables so the
 * popover follows the system theme (dark, light, dracula, nord, etc.).
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
	name: string;
	tokens: number;
	color: string;
}

/**
 * Maps Claude's categorical palette to the active theme's semantic CSS tokens:
 * - categorical-1 (tools, blue): var(--status-renamed)
 * - categorical-2 (system prompt, orange): var(--status-warning)
 * - categorical-3 (MCP tools, green): var(--status-success)
 * - categorical-4 (skills, yellow): warm amber/yellow blend
 * - categorical-7 (rules, violet): var(--accent-strong)
 * - categorical-5 (messages, magenta): magenta/purple blend
 * - other: var(--text-dim)
 * - reference / free / track: var(--bg-selected)
 */
export const THEME_COLORS: Record<ContextSegmentId, string> = {
	tools: "var(--status-renamed)",
	system: "var(--status-warning)",
	mcp: "var(--status-success)",
	skills: "color-mix(in srgb, var(--status-warning) 70%, var(--status-success))",
	rules: "var(--accent-strong)",
	messages: "color-mix(in srgb, var(--status-error) 40%, var(--accent-strong))",
	other: "var(--text-dim)",
	free: "var(--bg-selected)",
};

export const CLAUDE_NAMES_ZH: Record<ContextSegmentId, string> = {
	tools: "系统工具",
	system: "系统提示词",
	mcp: "MCP 工具",
	skills: "Skills",
	rules: "规则文件",
	messages: "对话消息",
	other: "其他",
	free: "剩余空间",
};

/**
 * Conversion logic directly adapted from Claude's toContextUsagePayload:
 * filters non-empty categories, sorts by tokens descending, adds Free space as remainder.
 */
export function buildContextSegments(
	used: number,
	windowSize: number,
	comp: PromptComposition | null,
): ContextSegment[] {
	const usedClamped = Math.min(Math.max(0, used), windowSize);

	const est = new Map<ContextSegmentId, number>();
	for (const c of comp?.categories ?? []) {
		est.set(c.id as ContextSegmentId, (est.get(c.id as ContextSegmentId) ?? 0) + c.tokens);
	}
	const estTotal = [...est.values()].reduce((a, b) => a + b, 0);
	const scale = estTotal > usedClamped && estTotal > 0 ? usedClamped / estTotal : 1;

	const fixedCategories: ContextSegmentId[] = ["tools", "system", "mcp", "skills", "rules", "other"];
	const segments: ContextSegment[] = [];

	for (const id of fixedCategories) {
		const raw = est.get(id) ?? 0;
		const tokens = Math.round(raw * scale);
		if (tokens > 0) {
			segments.push({ id, name: CLAUDE_NAMES_ZH[id], tokens, color: THEME_COLORS[id] });
		}
	}

	const fixedSum = segments.reduce((acc, s) => acc + s.tokens, 0);
	const messagesTokens = Math.max(0, usedClamped - fixedSum);
	if (messagesTokens > 0) {
		segments.push({
			id: "messages",
			name: CLAUDE_NAMES_ZH.messages,
			tokens: messagesTokens,
			color: THEME_COLORS.messages,
		});
	}

	// Sort used categories by tokens descending (Claude's exact sort order)
	segments.sort((a, b) => b.tokens - a.tokens);

	// Free space is appended at the end
	const freeTokens = Math.max(0, windowSize - usedClamped);
	if (freeTokens > 0) {
		segments.push({
			id: "free",
			name: CLAUDE_NAMES_ZH.free,
			tokens: freeTokens,
			color: THEME_COLORS.free,
		});
	}

	return segments;
}

export interface RingArc {
	id: ContextSegmentId;
	name: string;
	tokens: number;
	color: string;
	/** Distance along the circle (px) where the arc starts, measured from 12 o'clock clockwise. */
	offset: number;
	/** Visible arc length (px), already shortened by the seam gap. */
	length: number;
}

/**
 * Donut geometry for the used categories (free space is the ring's track).
 * Each used category gets at least `minLength` px so tiny ones keep a visible
 * color; consecutive arcs are separated by a `gap` px seam.
 */
export function computeRingArcs(
	segments: ContextSegment[],
	windowSize: number,
	circumference: number,
	{ gap = 1.5, minLength = 3 }: { gap?: number; minLength?: number } = {},
): RingArc[] {
	if (windowSize <= 0 || circumference <= 0) return [];
	const used = segments.filter((s) => s.id !== "free" && s.tokens > 0);
	const seam = used.length > 1 ? gap : 0;
	const result: RingArc[] = [];
	let cursor = 0;
	for (const s of used) {
		if (cursor >= circumference) break;
		const span = Math.min(
			circumference - cursor,
			Math.max(minLength + seam, (Math.min(s.tokens, windowSize) / windowSize) * circumference),
		);
		result.push({
			id: s.id,
			name: s.name,
			tokens: s.tokens,
			color: s.color,
			offset: cursor,
			length: Math.max(0, span - seam),
		});
		cursor += span;
	}
	return result;
}
