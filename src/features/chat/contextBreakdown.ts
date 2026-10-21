/**
 * Exact context categories and colors extracted from Claude Desktop App:
 * /Applications/Claude.app/Contents/Resources/ion-dist/assets/v1/c3c678d5f-Oker_KNW.js
 * /Applications/Claude.app/Contents/Resources/ion-dist/assets/v1/ce96f5751-_HRR9gXu.js
 * /Applications/Claude.app/Contents/Resources/ion-dist/assets/v1/c91b6e9db-Bl-Lrczo.js
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
 * Exact CSS color tokens from Claude App's design system:
 * - categorical-1 (blue-400): #3987e5
 * - categorical-2 (orange-400): #d95926
 * - categorical-3 (aqua-400): #199e70
 * - categorical-4 (yellow-350): #c98500
 * - categorical-5 (magenta-400): #d55181
 * - categorical-7 (violet-350): #9085e9
 * - reference/tint (track / free): #32312f
 */
export const CLAUDE_COLORS: Record<ContextSegmentId, string> = {
	tools: "#3987e5",
	system: "#d95926",
	mcp: "#199e70",
	skills: "#c98500",
	rules: "#9085e9",
	messages: "#d55181",
	other: "#6b7280",
	free: "#32312f",
};

export const CLAUDE_NAMES: Record<ContextSegmentId, string> = {
	tools: "System tools",
	system: "System prompt",
	mcp: "MCP tools",
	skills: "Skills",
	rules: "Rules",
	messages: "Messages",
	other: "Other",
	free: "Free space",
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
 * Conversion logic directly adapted from Claude's toContextUsagePayload (`s` in c3c678d5f):
 * filters non-empty categories, sorts by tokens descending, adds Free space as remainder.
 */
export function buildContextSegments(
	used: number,
	windowSize: number,
	comp: PromptComposition | null,
	lang: "zh" | "en" = "zh",
): ContextSegment[] {
	const labels = lang === "zh" ? CLAUDE_NAMES_ZH : CLAUDE_NAMES;
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
			segments.push({ id, name: labels[id], tokens, color: CLAUDE_COLORS[id] });
		}
	}

	const fixedSum = segments.reduce((acc, s) => acc + s.tokens, 0);
	const messagesTokens = Math.max(0, usedClamped - fixedSum);
	if (messagesTokens > 0) {
		segments.push({
			id: "messages",
			name: labels.messages,
			tokens: messagesTokens,
			color: CLAUDE_COLORS.messages,
		});
	}

	// Sort used categories by tokens descending (Claude's exact sort order)
	segments.sort((a, b) => b.tokens - a.tokens);

	// Free space is appended at the end
	const freeTokens = Math.max(0, windowSize - usedClamped);
	if (freeTokens > 0) {
		segments.push({
			id: "free",
			name: labels.free,
			tokens: freeTokens,
			color: CLAUDE_COLORS.free,
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
