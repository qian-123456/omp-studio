/**
 * TranscriptItem → Item normalization (CONTRACT §4 of mobile-skins) plus the pure
 * helpers a transcript view needs: id-deduplicating merges and the live
 * (streaming) row reducer fed by `rpc` SSE frames. `kind` names come from
 * contracts.rs TranscriptKind (snake_case).
 */
import type { ImageRef, Item, ItemRole, RawImage, RpcFrame, ToolItem, TranscriptItem } from "../types";

export function emptyItem(id: string, role: ItemRole, kind: string, parentId: string | null = null): Item {
	return { id, role, kind, parentId, text: "", thinking: "", tools: [], images: [], ts: null, streaming: false };
}

function findTool(list: readonly Item[], callId: string | undefined): ToolItem | null {
	if (!callId) return null;
	for (let i = list.length - 1; i >= 0; i--) {
		const tools = list[i].tools;
		for (let k = tools.length - 1; k >= 0; k--) if (tools[k].id === callId) return tools[k];
	}
	return null;
}

function lastAssistant(list: readonly Item[]): Item | null {
	for (let i = list.length - 1; i >= 0; i--) if (list[i].role === "assistant") return list[i];
	return null;
}

/** ImageAttachment[] → references. No bytes exist on this API, so `data`/`url` are never invented. */
export function transcriptImages(raw: readonly (RawImage | null | undefined)[] | undefined): ImageRef[] {
	const out: ImageRef[] = [];
	for (const img of raw ?? []) {
		if (!img) continue;
		out.push({
			id: img.id || "",
			mime: img.mimeType || "",
			path: img.path || "",
			marker: img.marker || "",
			width: typeof img.width === "number" ? img.width : null,
			height: typeof img.height === "number" ? img.height : null,
		});
	}
	return out;
}

/** Convert a transcript page into chat rows; hidden entries are dropped, tool results attach to their call. */
export function normalizeTranscript(raw: readonly (TranscriptItem | null | undefined)[] | null | undefined): Item[] {
	const out: Item[] = [];
	for (const it of raw ?? []) {
		if (!it || it.hidden) continue;
		const kind = it.kind || "unknown";
		if (kind === "user") {
			const item = emptyItem(it.id, "user", kind, it.parentId ?? null);
			item.text = it.text || "";
			item.images = transcriptImages(it.images);
			item.ts = it.ts || null;
			out.push(item);
		} else if (kind === "assistant") {
			const item = emptyItem(it.id, "assistant", kind, it.parentId ?? null);
			item.text = it.text || "";
			item.thinking = it.thinking || "";
			item.ts = it.ts || null;
			item.usage = it.usage ?? null;
			item.model = it.model ?? null;
			item.tools = (it.toolCalls ?? []).map((c) => ({
				id: c.id,
				name: c.name,
				args: c.args,
				intent: c.intent || null,
				status: "done" as const,
				result: "",
			}));
			if (it.images && it.images.length) item.images = transcriptImages(it.images);
			out.push(item);
		} else if (kind === "tool_result") {
			const r = it.toolResult;
			if (!r) continue;
			const owner = findTool(out, r.toolCallId);
			if (owner) {
				owner.status = r.isError ? "error" : "done";
				owner.result = r.text || "";
				continue;
			}
			const orphan: ToolItem = {
				id: r.toolCallId,
				name: r.toolName || "tool",
				args: null,
				status: r.isError ? "error" : "done",
				result: r.text || "",
			};
			const host = lastAssistant(out);
			if (host) host.tools.push(orphan);
			else {
				const item = emptyItem(it.id, "system", kind);
				item.text = r.text || "";
				item.ts = it.ts || null;
				item.tools = [{ ...orphan, status: "done" }];
				out.push(item);
			}
		} else if (kind === "bash") {
			const item = emptyItem(it.id, "assistant", kind, it.parentId ?? null);
			item.text = it.text || "";
			item.ts = it.ts || null;
			item.tools = [{ id: it.id, name: "bash", args: null, status: "done", result: it.text || "" }];
			out.push(item);
		} else {
			// compaction, branch_summary, model_change, custom, system, unknown
			const item = emptyItem(it.id, "system", kind, it.parentId ?? null);
			item.text = it.text || "";
			item.ts = it.ts || null;
			out.push(item);
		}
	}
	return out;
}

/**
 * Append `added` rows whose ids are not known yet. omp's cursor normally prevents
 * overlapping pages, but a rewritten file can re-deliver an entry and a duplicated
 * row is worse than a dropped duplicate. Returns `known` itself when nothing is new.
 */
export function appendUnique(known: readonly Item[], added: readonly Item[]): Item[] {
	if (!added.length) return known as Item[];
	const ids = new Set(known.map((i) => i.id));
	const fresh = added.filter((i) => !ids.has(i.id));
	return fresh.length ? [...known, ...fresh] : (known as Item[]);
}

/** Prepend older rows (loaded by re-reading from byte 0) that the buffer does not hold yet. */
export function prependUnique(known: readonly Item[], older: readonly Item[]): Item[] {
	const ids = new Set(known.map((i) => i.id));
	const fresh = older.filter((i) => i.id && !ids.has(i.id));
	return fresh.length ? [...fresh, ...known] : (known as Item[]);
}

/* ---------------------------------------------------------------- live frames */

export const LIVE_ID = "__live";

export function newLiveItem(now: string = new Date().toISOString()): Item {
	const item = emptyItem(LIVE_ID, "assistant", "assistant");
	item.streaming = true;
	item.ts = now;
	return item;
}

/** Text/thinking of a streamed assistant `message` frame. */
export function extractLive(message: NonNullable<RpcFrame["message"]>): { text: string; thinking: string } {
	const blocks = Array.isArray(message.content) ? (message.content as unknown[]) : [];
	let text = "";
	let thinking = "";
	for (const b of blocks) {
		const block = b as { type?: string; text?: unknown; thinking?: unknown } | null;
		if (!block) continue;
		if (block.type === "text" && typeof block.text === "string") text += block.text;
		else if (block.type === "thinking" || block.type === "thought") {
			const t = block.thinking != null ? block.thinking : block.text;
			if (typeof t === "string") thinking += t;
		}
	}
	if (!blocks.length && typeof message.text === "string") text = message.text;
	return { text, thinking };
}

export interface LiveUpdate {
	/** New live row (a fresh object when changed, same reference when untouched); null = no live row. */
	live: Item | null;
	/** True while the agent is streaming according to this frame. */
	streaming: boolean | null;
	/** The persisted transcript should be re-fetched (debounce ~200 ms). */
	refetch: boolean;
	/** Frame was understood (false for unknown frame types: ignore). */
	handled: boolean;
}

/** Text parts of a tool `result` / `partialResult` block, joined and capped like the transcript API. */
function resultText(r: { content?: { type?: string; text?: string }[] } | null | undefined): string {
	const content = r && Array.isArray(r.content) ? r.content : [];
	return content
		.filter((p) => p && p.type === "text" && typeof p.text === "string")
		.map((p) => p.text as string)
		.join("\n")
		.slice(0, 4000);
}

/**
 * Apply one `rpc` frame to the live row. Pure: never mutates `live`.
 * `agent_end` with `isTerminal === false` (scheduled continuation or
 * `awaitingAsyncWork`) keeps the row, a terminal end clears it.
 */
export function applyLiveFrame(live: Item | null, frame: RpcFrame, now?: string): LiveUpdate {
	const keep = (streaming: boolean | null, refetch = false): LiveUpdate => ({ live, streaming, refetch, handled: true });
	switch (frame.type) {
		case "agent_start":
		case "turn_start":
			return { live: live ?? newLiveItem(now), streaming: true, refetch: false, handled: true };
		case "message_update": {
			const m = frame.message;
			if (!m || (m.role && m.role !== "assistant")) return keep(null);
			const { text, thinking } = extractLive(m);
			const base = live ?? newLiveItem(now);
			if (base === live && base.text === text && base.thinking === thinking) return keep(true);
			return { live: { ...base, text, thinking }, streaming: true, refetch: false, handled: true };
		}
		case "message_end":
			return keep(null, true);
		case "tool_execution_start": {
			const base = live ?? newLiveItem(now);
			const tool: ToolItem = {
				id: String(frame.toolCallId ?? ""),
				name: frame.toolName || "tool",
				args: frame.args,
				status: "running",
				result: "",
			};
			// A row restored from the pre-reload snapshot already carries this tool: same-id frames
			// must update it in place instead of appending a duplicate card.
			const known = tool.id !== "" && base.tools.some((t) => t.id === tool.id);
			const tools = known
				? base.tools.map((t) => (t.id === tool.id ? { ...t, status: "running" as const, result: "" } : t))
				: [...base.tools, tool];
			return { live: { ...base, tools }, streaming: null, refetch: false, handled: true };
		}
		case "tool_execution_update": {
			if (!live) return keep(null);
			const result = resultText(frame.partialResult);
			let changed = false;
			const tools = live.tools.map((t) => {
				if (t.id !== frame.toolCallId) return t;
				if (t.result === result) return t;
				changed = true;
				return { ...t, result };
			});
			if (!changed) return keep(null);
			return { live: { ...live, tools }, streaming: null, refetch: false, handled: true };
		}
		case "tool_execution_end": {
			if (!live) return keep(null, true);
			const result = resultText(frame.result);
			const status = frame.isError === true ? ("error" as const) : ("done" as const);
			const tools = live.tools.map((t) => (t.id === frame.toolCallId ? { ...t, status, result } : t));
			return { live: { ...live, tools }, streaming: null, refetch: true, handled: true };
		}
		case "turn_end":
			if (frame.isTerminal === true) return { live: null, streaming: false, refetch: true, handled: true };
			return keep(null, true);
		case "agent_end":
			if (frame.isTerminal !== false) return { live: null, streaming: false, refetch: true, handled: true };
			// Non-terminal end: awaitingAsyncWork means idle until a background job wakes the agent.
			return frame.awaitingAsyncWork === true
				? { live: null, streaming: false, refetch: true, handled: true }
				: keep(null, true);
		default:
			return { live, streaming: null, refetch: false, handled: false };
	}
}

/**
 * The persisted transcript eventually contains the streamed message; keep the live row
 * only until the tail reaches a newer assistant row with the same text — or, for a
 * thinking-only message, the same thinking. Single source of truth shared with the
 * chat feature (re-exported there as `livePersisted`).
 */
export function liveIsPersisted(items: readonly Item[], live: Item | null): boolean {
	if (!live) return false;
	const tail = items[items.length - 1];
	if (!tail || tail.role !== "assistant") return false;
	const liveText = live.text.trim();
	if (liveText) {
		const tailText = tail.text.trim();
		return !!tailText && (tailText === liveText || tailText.endsWith(liveText));
	}
	const liveThinking = live.thinking.trim();
	return !!liveThinking && tail.thinking.trim() === liveThinking;
}
