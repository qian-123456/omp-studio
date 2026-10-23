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

export interface MeterSegment {
	id: ContextSegmentId;
	color: string;
	startPct: number;
	widthPct: number;
	seam: number;
	radiusStart: number;
	radiusEnd: number;
}

/**
 * Port of Claude App's StackedMeter segment geometry calculation (`x` in c91b6e9db):
 * calculates seams (1px gap), radiusStart (2px or 1px), radiusEnd (2px or 1px), and percentages.
 */
export function computeMeterSegments(
	segments: ContextSegment[],
	windowSize: number,
	thickness = 4,
): MeterSegment[] {
	if (windowSize <= 0) return [];
	const used = segments.filter((s) => s.id !== "free" && s.tokens > 0);
	if (used.length === 0) return [];

	const cornerRadius = Math.min(4, thickness / 4); // 1px
	const pillRadius = thickness / 2; // 2px
	const result: MeterSegment[] = [];
	let currentPct = 0;

	for (let i = 0; i < used.length; i++) {
		const s = used[i];
		const widthPct = (s.tokens / windowSize) * 100;
		if (widthPct <= 0) continue;

		const seam = result.length === 0 ? 0 : 1;
		result.push({
			id: s.id,
			color: s.color,
			startPct: currentPct,
			widthPct,
			seam,
			radiusStart: seam === 0 ? pillRadius : cornerRadius,
			radiusEnd: cornerRadius,
		});
		currentPct += widthPct;
	}

	if (result.length > 0) {
		result[result.length - 1].radiusEnd = pillRadius;
	}

	return result;
}
