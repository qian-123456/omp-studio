/**
 * Transcript buffer: incremental page merge (offset / tailId / reset), cross-page tool results,
 * request stats side table and optimistic-message reconciliation. Pure: never mutates its inputs.
 */
import { appendUnique, normalizeTranscript } from "../../../core/normalize";
import type { Item, ToolItem, TranscriptItem, TranscriptPage } from "../../../core/types";
import { requestStatFromItem, type RequestStat } from "./requestStats";

export interface TranscriptState {
	items: Item[];
	/** Byte offset to resume reading from (`?from=`). */
	offset: number;
	/** Id of the entry ending at `offset`; lets the server detect a rewritten file. */
	tailId: string | null;
	/** Per assistant item id: request stats (duration/ttft are not part of the normalized Item). */
	stats: Record<string, RequestStat>;
}

export const EMPTY_TRANSCRIPT: TranscriptState = { items: [], offset: 0, tailId: null, stats: {} };

export interface MergeResult {
	state: TranscriptState;
	/** Texts of user rows that arrived with this page (for optimistic reconciliation). */
	newUserTexts: string[];
	changed: boolean;
}

/** Query string of the next incremental read. */
export function transcriptQuery(state: Pick<TranscriptState, "offset" | "tailId">): string {
	return `from=${state.offset}${state.tailId ? `&tail=${encodeURIComponent(state.tailId)}` : ""}`;
}

/** Locate the tool a result belongs to in already-buffered rows (a result can land in a later page than its call). */
function ownerIndex(items: readonly Item[], callId: string): number {
	for (let i = items.length - 1; i >= 0; i--) {
		const tools = items[i].tools;
		for (let k = tools.length - 1; k >= 0; k--) if (tools[k].id === callId) return i;
	}
	return -1;
}

/**
 * Tool calls of fresh assistant rows start "running" (= unresolved): core marks every call `done`, but a call
 * without a persisted result is still pending (or was aborted) and must not show a success state.
 */
function markUnresolved(items: Item[], raw: readonly TranscriptItem[]): void {
	const resolved = new Set<string>();
	for (const r of raw) if (r && r.kind === "tool_result" && r.toolResult) resolved.add(r.toolResult.toolCallId);
	for (const it of items) {
		if (it.kind !== "assistant" || !it.tools.length) continue;
		it.tools = it.tools.map((t) => (resolved.has(t.id) ? t : { ...t, status: "running" as const }));
	}
}

export function mergePage(prev: TranscriptState, page: TranscriptPage): MergeResult {
	const base = page.reset ? EMPTY_TRANSCRIPT : prev;
	let items = base.items;
	const stats = { ...base.stats };
	const raw = (page.items ?? []).filter((r): r is TranscriptItem => !!r);
	let patched = false;
	const rest: TranscriptItem[] = [];
	for (const r of raw) {
		if (r.kind === "tool_result" && r.toolResult) {
			const idx = ownerIndex(items, r.toolResult.toolCallId);
			if (idx >= 0) {
				const owner = items[idx];
				const res = r.toolResult;
				const tools: ToolItem[] = owner.tools.map((t) =>
					t.id === res.toolCallId ? { ...t, status: res.isError ? "error" : "done", result: res.text || "" } : t,
				);
				if (items === base.items) items = items.slice();
				items[idx] = { ...owner, tools };
				patched = true;
				continue;
			}
		}
		rest.push(r);
	}
	const fresh = normalizeTranscript(rest);
	markUnresolved(fresh, rest);
	for (const r of rest) {
		if (r.kind !== "assistant") continue;
		const stat = requestStatFromItem(r);
		if (stat) stats[r.id] = stat;
	}
	const merged = appendUnique(items, fresh);
	const newUserTexts = fresh.filter((x) => x.role === "user" && x.text).map((x) => x.text.trim());
	const offset = page.nextOffset || base.offset;
	const tailId = page.tailId ?? null;
	const changed = !!page.reset || patched || merged !== items || offset !== prev.offset || tailId !== prev.tailId;
	return { state: { items: merged, offset, tailId, stats }, newUserTexts, changed };
}

/* ---------------------------------------------------------------- optimistic */

export interface OptimisticMsg {
	/** Local id, stable across renders. */
	id: string;
	/** Prompt text exactly as sent (attachment tokens included). */
	text: string;
	/** Object URLs of attached images, shown in the pending bubble. */
	imageUrls: string[];
	failed?: boolean;
}

/**
 * Drop optimistic bubbles that the transcript now shows. The server may prepend the plan-mode prefix, so the
 * match also accepts a persisted text that ends with the optimistic one.
 */
export function reconcileOptimistic(optimistic: readonly OptimisticMsg[], newUserTexts: readonly string[]): OptimisticMsg[] {
	if (!newUserTexts.length || !optimistic.length) return optimistic as OptimisticMsg[];
	const pool = newUserTexts.slice();
	const keep = optimistic.filter((o) => {
		const want = o.text.trim();
		const k = pool.findIndex((u) => u === want || u.endsWith(want));
		if (k >= 0) {
			pool.splice(k, 1);
			return false;
		}
		return true;
	});
	return keep.length === optimistic.length ? (optimistic as OptimisticMsg[]) : keep;
}
