/**
 * Context-usage breakdown for the composer popover. Categories and palette
 * follow Claude Desktop's context meter, wired to the theme's CSS variables.
 * System-prompt parts come from the prompt-composition probe; the rest of the
 * used tokens is split by estimating the live transcript (after the latest
 * compaction) and scaling those estimates to the remainder omp reports.
 */
import type { PromptComposition, TranscriptItem } from "../../lib/contracts";
import { tNow } from "../../stores/language";

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
	/**
	 * Prompt group only: the system-prompt breakdown is not loaded yet (or failed), so this
	 * slice is the unattributed remainder and the legend shows a status instead of numbers.
	 */
	pending?: true;
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

export function getContextSegmentName(id: ContextSegmentId): string {
	switch (id) {
		case "tools": return tNow("chat.context.tools");
		case "system": return tNow("chat.context.system");
		case "mcp": return tNow("chat.context.mcp");
		case "skills": return tNow("chat.context.skills");
		case "rules": return tNow("chat.context.rules");
		case "other": return tNow("chat.context.other");
		case "messages": return tNow("chat.context.messages");
		case "thinking": return tNow("chat.context.thinking");
		case "toolCalls": return tNow("chat.context.toolCalls");
		case "mcpCalls": return tNow("chat.context.mcpCalls");
		case "skillReads": return tNow("chat.context.skillReads");
		case "free": return tNow("chat.context.free");
	}
}

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
 * The entries on the active branch, leaf (last item) back to the root. Dropped
 * entries (`custom` bookkeeping rows, …) are not transcript items, so a missing
 * (or absent) parent falls back to the previous item in file order, which is right for a
 * linear history and only misjudges a fork hanging off a dropped entry.
 */
function activeBranch(items: TranscriptItem[]): TranscriptItem[] {
	const index: Record<string, number> = {};
	items.forEach((it, i) => {
		index[it.id] = i;
	});
	const branch: TranscriptItem[] = [];
	let i = items.length - 1;
	while (i >= 0) {
		const it = items[i];
		branch.push(it);
		const parent = it.parentId == null ? undefined : index[it.parentId];
		// A parent at or after the item cannot be an ancestor; treat it as unknown.
		i = parent !== undefined && parent < i ? parent : i - 1;
	}
	return branch.reverse();
}

/**
 * Transcript items still in the model's context: the active branch only, and
 * after its latest compaction just the summary, the entries it kept
 * (`firstKeptEntryId` onward) and everything after it.
 */
export function liveContextItems(all: TranscriptItem[]): TranscriptItem[] {
	const items = activeBranch(all);
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

/** Provider rule of thumb: width × height / 750, clamped; 1000 when the size is unknown. */
function imageTokens(img: { width?: number | null; height?: number | null }): number {
	if (!img.width || !img.height) return 1000;
	return Math.min(1600, Math.max(85, Math.round((img.width * img.height) / 750)));
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
			totals.messages += (it.images ?? []).reduce((a, img) => a + imageTokens(img), 0);
		} else if (it.kind === "custom") {
			// `skill-prompt` entries without `details.prompt` stay generic custom items whose
			// content is the whole expanded skill.
			const skill = it.text?.match(/^\[IMPORTANT: User invoked the "([^"]+)" skill/)?.[1];
			if (skill) add("skillReads", skill, estimateTokens(it.text), 1);
			else totals.messages += estimateTokens(it.text);
		} else if (it.kind === "bash" || it.kind === "compaction" || it.kind === "branch_summary" || it.kind === "system") {
			totals.messages += estimateTokens(it.text);
		}
	}

	const rows = (m: Map<string, { tokens: number; count: number }>): DetailRow[] =>
		[...m]
			.map(([name, v]) => ({ name: v.count > 1 ? tNow("chat.context.countTimes", { name, count: v.count }) : name, tokens: v.tokens }))
			.sort((a, b) => b.tokens - a.tokens);
	return (Object.keys(totals) as ChatSegmentId[]).map((id) => ({
		id,
		tokens: totals[id],
		details: id === "toolCalls" || id === "mcpCalls" || id === "skillReads" ? rows(by[id]) : undefined,
	}));
}

const scaleRows = (rows: DetailRow[] | undefined, f: number) =>
	rows?.map((r) => ({ name: r.name, tokens: Math.round(r.tokens * f) }));

/** Integer shares of `total` proportional to `weights` (largest remainder), summing to `total` exactly. */
function apportion(weights: number[], total: number): number[] {
	const sum = weights.reduce((a, w) => a + w, 0);
	if (sum <= 0 || total <= 0) return weights.map(() => 0);
	const exact = weights.map((w) => (w * total) / sum);
	const out = exact.map(Math.floor);
	let left = total - out.reduce((a, n) => a + n, 0);
	const order = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac);
	for (const { i } of order) {
		if (left <= 0) break;
		out[i]++;
		left--;
	}
	return out;
}

/**
 * Ring/legend segments; the used segments always sum to `used` exactly.
 * - Probe loaded: prompt parts keep their estimates and the conversation
 *   estimates are scaled to fill the rest. When both together overshoot
 *   `used`, both are scaled down proportionally (all are estimates).
 * - Probe missing (loading or failed): the conversation keeps its raw
 *   estimates (capped at `used`) and the unattributed remainder becomes one
 *   `pending` 系统提示词 slice.
 * - `sessionBlank` (no user activity yet): there is no conversation, so the
 *   gap between the prompt estimate and `used` is prompt-side too — the prompt
 *   parts are scaled up to fill `used` instead of becoming a 对话消息 fill row.
 * Groups are ordered by total, parts within a group by size; free space last.
 */
export function buildContextSegments(
	used: number,
	windowSize: number,
	comp: PromptComposition | null,
	chat: ChatEstimate[] | null = null,
	sessionBlank = false,
): ContextSegment[] {
	const usedClamped = Math.round(Math.min(Math.max(0, used), windowSize));

	const cats: Partial<Record<PromptSegmentId, PromptComposition["categories"][number]>> = {};
	for (const c of comp?.categories ?? []) cats[c.id as PromptSegmentId] = c;
	const promptW = PROMPT_IDS.map((id) => Math.max(0, cats[id]?.tokens ?? 0));
	const promptRaw = promptW.reduce((a, w) => a + w, 0);
	const chatIn = (chat ?? []).filter((c) => c.tokens > 0);
	const chatW = chatIn.map((c) => c.tokens);
	const chatRaw = chatW.reduce((a, w) => a + w, 0);

	let promptTokens = promptW.map(() => 0);
	let chatTokens = chatW.map(() => 0);
	let fillMessages = 0;
	let pendingTokens = 0;
	if (!comp) {
		chatTokens = apportion(chatW, Math.min(Math.round(chatRaw), usedClamped));
		pendingTokens = usedClamped - chatTokens.reduce((a, n) => a + n, 0);
	} else if (chatRaw > 0 && promptRaw + chatRaw > usedClamped) {
		const all = apportion([...promptW, ...chatW], usedClamped);
		promptTokens = all.slice(0, promptW.length);
		chatTokens = all.slice(promptW.length);
	} else {
		// Blank session: the reported usage is all prompt-side (estimate error,
		// real tools/AGENTS.md differing from the probe), so scale up to fill it.
		const promptTotal = sessionBlank ? usedClamped : Math.min(Math.round(promptRaw), usedClamped);
		promptTokens = apportion(promptW, promptTotal);
		const budget = usedClamped - promptTotal;
		if (chatRaw > 0) chatTokens = apportion(chatW, budget);
		else if (!sessionBlank) fillMessages = budget;
	}

	const prompt: ContextSegment[] = [];
	PROMPT_IDS.forEach((id, i) => {
		const cat = cats[id];
		const tokens = promptTokens[i];
		if (!cat || tokens <= 0) return;
		const details = DETAIL_PROMPT_IDS[id]
			? scaleRows(
					cat.items.map((it) => ({ name: it.detail ? `${it.detail} · ${it.title}` : it.title, tokens: it.tokens })),
					tokens / promptW[i],
				)
			: undefined;
		prompt.push({ id, group: "prompt", name: getContextSegmentName(id), tokens, color: THEME_COLORS[id], details });
	});
	if (pendingTokens > 0) {
		prompt.push({
			id: "system",
			group: "prompt",
			name: tNow("chat.context.systemPrompt"),
			tokens: pendingTokens,
			color: THEME_COLORS.system,
			pending: true,
		});
	}

	const conversation: ContextSegment[] = [];
	chatIn.forEach((c, i) => {
		const tokens = chatTokens[i];
		if (tokens <= 0) return;
		conversation.push({
			id: c.id,
			group: "chat",
			name: c.id === "messages" ? tNow("chat.context.chatText") : getContextSegmentName(c.id),
			tokens,
			color: THEME_COLORS[c.id],
			details: c.details?.length ? scaleRows(c.details, tokens / c.tokens) : undefined,
		});
	});
	if (fillMessages > 0) {
		conversation.push({
			id: "messages",
			group: "chat",
			name: getContextSegmentName("messages"),
			tokens: fillMessages,
			color: THEME_COLORS.messages,
		});
	}

	const bySize = (a: ContextSegment, b: ContextSegment) => b.tokens - a.tokens;
	const sum = (xs: ContextSegment[]) => xs.reduce((a, s) => a + s.tokens, 0);
	prompt.sort(bySize);
	conversation.sort(bySize);
	const segments = sum(conversation) >= sum(prompt) ? [...conversation, ...prompt] : [...prompt, ...conversation];

	const freeTokens = Math.max(0, windowSize - usedClamped);
	if (freeTokens > 0) {
		segments.push({ id: "free", group: "free", name: getContextSegmentName("free"), tokens: freeTokens, color: THEME_COLORS.free });
	}
	return segments;
}

/**
 * Ring view of the segments: the prompt group collapses into one 系统提示词 arc
 * in the system color — the legend shows that group as a single row too, so the
 * ring must not paint its per-category colors. Chat parts keep their own colors
 * (one legend row each); free space stays in and is skipped by `computeRingArcs`.
 */
export function ringSegments(segments: ContextSegment[]): ContextSegment[] {
	const out: ContextSegment[] = [];
	let prompt: ContextSegment | null = null;
	for (const s of segments) {
		if (s.group !== "prompt") {
			out.push(s);
			continue;
		}
		if (!prompt) {
			prompt = { id: "system", group: "prompt", name: tNow("chat.context.systemPrompt"), tokens: 0, color: THEME_COLORS.system };
			out.push(prompt);
		}
		prompt.tokens += s.tokens;
	}
	return out;
}

export interface RingArc {
	id: ContextSegmentId;
	name: string;
	tokens: number;
	color: string;
	/** Distance along the circle (px) where the arc starts, measured from 12 o'clock clockwise. */
	offset: number;
	/** Arc length (px); each arc starts exactly where the previous one ends (minus `gap`, 0 by default). */
	length: number;
}

/**
 * Donut geometry for the used categories (free space is the ring's track).
 * Arcs tile the used portion end to end without seams. Categories shorter than
 * `minLength` px are widened to it and the larger arcs shrink to compensate, so
 * the total span still equals the used fraction of the circle.
 */
export function computeRingArcs(
	segments: ContextSegment[],
	windowSize: number,
	circumference: number,
	{ gap = 0, minLength = 3 }: { gap?: number; minLength?: number } = {},
): RingArc[] {
	if (windowSize <= 0 || circumference <= 0) return [];
	const used = segments.filter((s) => s.id !== "free" && s.tokens > 0);
	if (used.length === 0) return [];
	const seam = used.length > 1 ? gap : 0;
	const usedTokens = used.reduce((a, s) => a + s.tokens, 0);
	const total = (Math.min(usedTokens, windowSize) / windowSize) * circumference;
	const floor = Math.min(minLength + seam, total / used.length);
	const ideal = used.map((s) => (s.tokens / usedTokens) * total);

	// Widen the tiny arcs to `floor`, taking the extra length from the larger ones.
	const small = ideal.map((l) => l < floor);
	const extra = ideal.reduce((a, l, i) => (small[i] ? a + (floor - l) : a), 0);
	const bigSum = ideal.reduce((a, l, i) => (small[i] ? a : a + l), 0);
	const shrink = bigSum > extra ? (bigSum - extra) / bigSum : 1;
	const spans = ideal.map((l, i) => (small[i] ? floor : l * shrink));

	let cursor = 0;
	return used.map((s, i) => {
		const arc: RingArc = {
			id: s.id,
			name: s.name,
			tokens: s.tokens,
			color: s.color,
			offset: cursor,
			length: Math.max(0, spans[i] - seam),
		};
		cursor += spans[i];
		return arc;
	});
}
