/**
 * Context-usage breakdown for the composer popover. Categories and palette
 * follow Claude Desktop's context meter, wired to the theme's CSS variables.
 * System-prompt parts come from the prompt-composition probe; the rest of the
 * used tokens is split by estimating the live transcript (after the latest
 * compaction) and scaling those estimates to the remainder omp reports.
 */
import type { PromptComposition, TranscriptItem } from "../../lib/contracts";

export type PromptSegmentId = "tools" | "system" | "mcp" | "skills" | "rules" | "other";
export type ChatSegmentId = "messages" | "thinking" | "toolCalls" | "mcpCalls" | "skillReads";
export type ContextSegmentId = PromptSegmentId | ChatSegmentId | "free";

export interface DetailRow {
	name: string;
	tokens: number;
}

export interface ContextSegment {
	id: ContextSegmentId;
	group: "prompt" | "chat" | "free";
	name: string;
	tokens: number;
	color: string;
	/** Per-item breakdown (rule files, skills, tools …), scaled like `tokens`. */
	details?: DetailRow[];
}

export const THEME_COLORS: Record<ContextSegmentId, string> = {
	tools: "var(--status-renamed)",
	system: "var(--status-warning)",
	mcp: "var(--status-success)",
	skills: "color-mix(in srgb, var(--status-warning) 70%, var(--status-success))",
	rules: "var(--accent-strong)",
	other: "var(--text-dim)",
	messages: "color-mix(in srgb, var(--status-error) 40%, var(--accent-strong))",
	thinking: "color-mix(in srgb, var(--status-renamed) 45%, var(--accent-strong))",
	toolCalls: "color-mix(in srgb, var(--status-error) 75%, var(--status-warning))",
	mcpCalls: "color-mix(in srgb, var(--status-success) 55%, var(--status-renamed))",
	skillReads: "color-mix(in srgb, var(--status-warning) 55%, var(--status-error))",
	free: "var(--bg-selected)",
};

export const CLAUDE_NAMES_ZH: Record<ContextSegmentId, string> = {
	tools: "系统工具",
	system: "基础指令",
	mcp: "MCP 工具",
	skills: "Skills",
	rules: "规则文件",
	other: "其他",
	messages: "对话消息",
	thinking: "思考",
	toolCalls: "工具调用",
	mcpCalls: "MCP 调用",
	skillReads: "读取的 Skills",
	free: "剩余空间",
};

const PROMPT_IDS: PromptSegmentId[] = ["tools", "system", "mcp", "skills", "rules", "other"];
const DETAIL_PROMPT_IDS: Partial<Record<PromptSegmentId, true>> = { mcp: true, skills: true, rules: true };

/** Same rule as `prompt_composition.rs::estimate_tokens`: CJK 1 token each, others ~3 chars per token. */
export function estimateTokens(text: string | null | undefined): number {
	if (!text) return 0;
	let cjk = 0;
	let other = 0;
	for (const ch of text) {
		const c = ch.codePointAt(0) ?? 0;
		if ((c >= 0x2e80 && c <= 0x9fff) || (c >= 0xac00 && c <= 0xd7af) || (c >= 0xff00 && c <= 0xffef)) cjk++;
		else other++;
	}
	return cjk + Math.ceil(other / 3);
}

/**
 * Transcript items still in the model's context: after the latest compaction
 * only its summary, the entries it kept (`firstKeptEntryId` onward) and
 * everything after it remain. File order; branches are not resolved.
 */
export function liveContextItems(items: TranscriptItem[]): TranscriptItem[] {
	for (let i = items.length - 1; i >= 0; i--) {
		const c = items[i];
		if (c.kind !== "compaction") continue;
		const keepIdx = c.firstKeptEntryId ? items.findIndex((x) => x.id === c.firstKeptEntryId) : -1;
		const kept = keepIdx >= 0 && keepIdx < i ? items.slice(keepIdx, i) : [];
		return [c, ...kept, ...items.slice(i + 1)];
	}
	return items;
}

export interface ChatEstimate {
	id: ChatSegmentId;
	tokens: number;
	details?: DetailRow[];
}

function skillOfPath(args: unknown): string | null {
	if (!args || typeof args !== "object" || !("path" in args)) return null;
	const path = args.path;
	if (typeof path !== "string" || !path.startsWith("skill://")) return null;
	return path.slice("skill://".length).split(/[/:]/)[0] || null;
}

/** Raw (unscaled) token estimates of the conversation part, by category. */
export function estimateConversation(items: TranscriptItem[]): ChatEstimate[] {
	const totals: Record<ChatSegmentId, number> = { messages: 0, thinking: 0, toolCalls: 0, mcpCalls: 0, skillReads: 0 };
	const by: Record<"toolCalls" | "mcpCalls" | "skillReads", Map<string, { tokens: number; count: number }>> = {
		toolCalls: new Map(),
		mcpCalls: new Map(),
		skillReads: new Map(),
	};
	const add = (cat: "toolCalls" | "mcpCalls" | "skillReads", key: string, tokens: number, count: number) => {
		totals[cat] += tokens;
		const row = by[cat].get(key) ?? { tokens: 0, count: 0 };
		row.tokens += tokens;
		row.count += count;
		by[cat].set(key, row);
	};
	// toolCallId → where its result is counted.
	const callBucket = new Map<string, { cat: "toolCalls" | "mcpCalls" | "skillReads"; key: string }>();

	for (const it of items) {
		if (it.kind === "assistant") {
			totals.messages += estimateTokens(it.text);
			totals.thinking += estimateTokens(it.thinking);
			for (const call of it.toolCalls) {
				const skill = call.name === "read" ? skillOfPath(call.args) : null;
				const bucket = skill
					? { cat: "skillReads" as const, key: skill }
					: call.name.startsWith("mcp__")
						? { cat: "mcpCalls" as const, key: call.name.replace(/^mcp__/, "") }
						: { cat: "toolCalls" as const, key: call.name };
				callBucket.set(call.id, bucket);
				add(bucket.cat, bucket.key, estimateTokens(call.name) + estimateTokens(JSON.stringify(call.args ?? null)), 1);
			}
		} else if (it.kind === "tool_result" && it.toolResult) {
			const r = it.toolResult;
			const bucket =
				callBucket.get(r.toolCallId) ??
				(r.toolName.startsWith("mcp__")
					? { cat: "mcpCalls" as const, key: r.toolName.replace(/^mcp__/, "") }
					: { cat: "toolCalls" as const, key: r.toolName });
			add(bucket.cat, bucket.key, estimateTokens(r.text), 0);
		} else if (it.kind === "user") {
			const skill = it.text?.match(/^\/skill:([\w.-]+)/)?.[1];
			if (skill) add("skillReads", skill, estimateTokens(it.text), 1);
			else totals.messages += estimateTokens(it.text);
		} else if (it.kind === "bash" || it.kind === "custom" || it.kind === "compaction" || it.kind === "branch_summary" || it.kind === "system") {
			totals.messages += estimateTokens(it.text);
		}
	}

	const rows = (m: Map<string, { tokens: number; count: number }>): DetailRow[] =>
		[...m]
			.map(([name, v]) => ({ name: v.count > 1 ? `${name} · ${v.count} 次` : name, tokens: v.tokens }))
			.sort((a, b) => b.tokens - a.tokens);
	return (Object.keys(totals) as ChatSegmentId[]).map((id) => ({
		id,
		tokens: totals[id],
		details: id === "toolCalls" || id === "mcpCalls" || id === "skillReads" ? rows(by[id]) : undefined,
	}));
}

const scaleRows = (rows: DetailRow[] | undefined, f: number) =>
	rows?.map((r) => ({ name: r.name, tokens: Math.round(r.tokens * f) }));

/**
 * Ring/legend segments: prompt parts (probe estimates, scaled down if they
 * exceed usage), the conversation remainder split by `chat` estimates (scaled
 * to fill it exactly; one 对话消息 slice without estimates), then free space.
 * Groups are ordered by total, parts within a group by size.
 */
export function buildContextSegments(
	used: number,
	windowSize: number,
	comp: PromptComposition | null,
	chat: ChatEstimate[] | null = null,
): ContextSegment[] {
	const usedClamped = Math.min(Math.max(0, used), windowSize);

	const cats = new Map((comp?.categories ?? []).map((c) => [c.id as PromptSegmentId, c]));
	const estTotal = PROMPT_IDS.reduce((a, id) => a + (cats.get(id)?.tokens ?? 0), 0);
	const promptScale = estTotal > usedClamped && estTotal > 0 ? usedClamped / estTotal : 1;
	const prompt: ContextSegment[] = [];
	for (const id of PROMPT_IDS) {
		const cat = cats.get(id);
		const tokens = Math.round((cat?.tokens ?? 0) * promptScale);
		if (!cat || tokens <= 0) continue;
		const details = DETAIL_PROMPT_IDS[id]
			? scaleRows(
					cat.items.map((it) => ({ name: it.detail ? `${it.detail} · ${it.title}` : it.title, tokens: it.tokens })),
					promptScale,
				)
			: undefined;
		prompt.push({ id, group: "prompt", name: CLAUDE_NAMES_ZH[id], tokens, color: THEME_COLORS[id], details });
	}

	const budget = Math.max(0, usedClamped - prompt.reduce((a, s) => a + s.tokens, 0));
	const rawChat = (chat ?? []).reduce((a, c) => a + c.tokens, 0);
	const conversation: ContextSegment[] = [];
	if (budget > 0 && rawChat > 0) {
		const f = budget / rawChat;
		for (const c of chat ?? []) {
			const tokens = Math.round(c.tokens * f);
			if (tokens <= 0) continue;
			conversation.push({
				id: c.id,
				group: "chat",
				name: c.id === "messages" ? "对话文字" : CLAUDE_NAMES_ZH[c.id],
				tokens,
				color: THEME_COLORS[c.id],
				details: c.details?.length ? scaleRows(c.details, f) : undefined,
			});
		}
	} else if (budget > 0) {
		conversation.push({ id: "messages", group: "chat", name: CLAUDE_NAMES_ZH.messages, tokens: budget, color: THEME_COLORS.messages });
	}

	const bySize = (a: ContextSegment, b: ContextSegment) => b.tokens - a.tokens;
	const sum = (xs: ContextSegment[]) => xs.reduce((a, s) => a + s.tokens, 0);
	prompt.sort(bySize);
	conversation.sort(bySize);
	const segments = sum(conversation) >= sum(prompt) ? [...conversation, ...prompt] : [...prompt, ...conversation];

	const freeTokens = Math.max(0, windowSize - usedClamped);
	if (freeTokens > 0) {
		segments.push({ id: "free", group: "free", name: CLAUDE_NAMES_ZH.free, tokens: freeTokens, color: THEME_COLORS.free });
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
