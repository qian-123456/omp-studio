/** Context-window usage formatting for the composer/header chip. */

export interface ContextUsage {
	contextTokens?: number | null;
	contextWindow?: number | null;
	contextPercent?: number | null;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Clamped integer percent text; `<1%` for tiny non-zero usage; null when unknown. */
export function formatContextPercent(p: number | null | undefined): string | null {
	if (!num(p)) return null;
	if (p <= 0) return "0%";
	if (p < 1) return "<1%";
	return `${Math.min(100, Math.round(p))}%`;
}

export type ContextTone = "neutral" | "warn" | "danger";

export function contextTone(p: number | null | undefined): ContextTone {
	if (!num(p)) return "neutral";
	if (p >= 90) return "danger";
	if (p >= 70) return "warn";
	return "neutral";
}

/** 12_300 → 「12.3K」, 1_200_000 → 「1.2M」. */
export function formatTokens(n: number): string {
	if (n < 1000) return String(Math.round(n));
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0).replace(/\.0$/, "")}K`;
	return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** 「已用 12.3K / 200K」, or just the used part when the window is unknown. */
export function formatContextDetail(u: ContextUsage): string | null {
	const t = u.contextTokens;
	const w = u.contextWindow;
	if (num(t) && num(w) && w > 0) return `已用 ${formatTokens(t)} / ${formatTokens(w)}`;
	if (num(t)) return `已用 ${formatTokens(t)}`;
	return null;
}

/** Percent to show: the server value, else derived from tokens/window. */
export function resolveContextPercent(u: ContextUsage): number | null {
	if (num(u.contextPercent)) return u.contextPercent;
	if (num(u.contextTokens) && num(u.contextWindow) && u.contextWindow > 0) return (u.contextTokens / u.contextWindow) * 100;
	return null;
}

/** omp's queued user messages (`composer-state.queue`, from `get_state.queuedMessages`). */
export interface QueueSnapshot {
	steering?: string[];
	followUp?: string[];
	/** Leading steering entries omp already sent into the streaming response. */
	liveSteered?: number;
}

/** Chip text for the queued messages: 「排队 3 条 · 插话 1 · 后续 2」; non-zero parts only. */
export function queueChipText(q: QueueSnapshot | null | undefined): string | null {
	const liveSteered = q?.liveSteered;
	const steering = Math.max(0, (q?.steering?.length ?? 0) - (num(liveSteered) ? liveSteered : 0));
	const followUp = q?.followUp?.length ?? 0;
	const total = steering + followUp;
	if (total <= 0) return null;
	const parts = [`排队 ${total} 条`];
	if (steering > 0) parts.push(`插话 ${steering}`);
	if (followUp > 0) parts.push(`后续 ${followUp}`);
	return parts.join(" · ");
}
