/**
 * [B] Crash-safe half-answer retention (未完成半句恢复). omp only writes an
 * assistant message to the transcript once it completes, so the in-flight
 * answer exists nowhere on disk: an app restart used to lose it for good.
 *
 * While a turn streams, the live store therefore snapshots the current state
 * (streaming message, completed requests, tool activity, thinking spans and
 * timing) into localStorage under `ompws:stream-snapshot:<sessionId>`,
 * throttled and size-capped; every write and read degrades silently when
 * storage is unavailable. On the next app start / session open:
 * - the process is still streaming (confirmed by get_state): the snapshot is
 *   merged back into the live state — it is the same source the frames feed,
 *   so incoming frames simply overwrite it;
 * - the backend is idle and the transcript lacks the content: it is shown as
 *   an "未完成回答（上次中断）" row with a one-click remove; any later data
 *   source carrying the same content dedupes it away.
 *
 * The retention is cleared when the turn ends normally, when the content
 * shows up from a real source, or when its session is removed. Nothing is
 * fabricated: timestamps / model / usage metadata are never restored.
 */

import type { TranscriptItem } from "../../lib/contracts";
import type {
	AgentMessage,
	LiveRequest,
	LiveTool,
	SessionLive,
} from "../../stores/live";

export interface StreamSnapshot {
	v: 1;
	/** When the snapshot was taken (real observation time, never faked). */
	savedAt: number;
	/** The in-flight assistant message at snapshot time. */
	streamingMessage: AgentMessage | null;
	/** Completed requests of the running turn (for a live reattach). */
	liveRequests: LiveRequest[];
	/** Live tool executions at snapshot time (for a live reattach). */
	tools: Record<string, LiveTool>;
	thinkingStartedAt: number | null;
	thinkingEndedAt: number | null;
	turnStartedAt: number | null;
	thinkingDurations: Record<string, { startedAt: number; endedAt: number }>;
	/** Text of the in-flight message (dedup + display), derived at save time. */
	answerText: string;
	/** Tool call ids carried by the in-flight message (dedup). */
	toolIds: string[];
}

const KEY_PREFIX = "ompws:stream-snapshot:";
const KEY = (sid: string) => `${KEY_PREFIX}${sid}`;

/** Keep the newest snapshots of at most this many sessions. */
const MAX_SNAPSHOT_SESSIONS = 20;
/** Per-tool output cap (tool result texts can be enormous). */
const MAX_TOOL_TEXT = 4000;
const MAX_TOOL_DETAILS_JSON = 8192;
const MAX_REQUESTS = 40;
/** Whole-snapshot budget; beyond it only the in-flight message is kept. */
const MAX_SNAPSHOT_JSON = 400_000;
const MAX_SLIM_TEXT = 20_000;

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const asPart = (v: unknown): Record<string, unknown> =>
	typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};

/** Ordinary + narration text of a message's content, in arrival order. */
export function answerTextOf(msg: AgentMessage | null | undefined): string {
	const content = msg && Array.isArray(msg.content) ? msg.content : [];
	const out: string[] = [];
	for (const raw of content) {
		const p = asPart(raw);
		if (p.type === "text" && typeof p.text === "string" && p.text.length > 0) {
			out.push(p.text);
		}
	}
	return out.join("\n\n");
}

/** Non-narration thinking spans of a message's content. */
export function thinkingTextsOf(msg: AgentMessage | null | undefined): string[] {
	const content = msg && Array.isArray(msg.content) ? msg.content : [];
	const out: string[] = [];
	for (const raw of content) {
		const p = asPart(raw);
		if (
			(p.type === "thinking" || p.type === "thought") &&
			p.narration !== true
		) {
			const text = str(p.thinking ?? p.text);
			if (text) out.push(text);
		}
	}
	return out;
}

/** Tool call ids declared by a message's content. */
export function toolIdsOf(msg: AgentMessage | null | undefined): string[] {
	const content = msg && Array.isArray(msg.content) ? msg.content : [];
	const out: string[] = [];
	for (const raw of content) {
		const p = asPart(raw);
		if ((p.type === "tool_use" || p.type === "toolCall") && typeof p.id === "string" && p.id) {
			out.push(p.id);
		}
	}
	return out;
}

/** Shrink a tool entry so one huge tool result cannot blow the budget. */
function slimTool(tool: LiveTool): LiveTool {
	const text = tool.text.length > MAX_TOOL_TEXT ? tool.text.slice(0, MAX_TOOL_TEXT) : tool.text;
	let details = tool.details;
	if (details !== null && details !== undefined) {
		try {
			if (JSON.stringify(details).length > MAX_TOOL_DETAILS_JSON) details = null;
		} catch {
			details = null;
		}
	}
	return { ...tool, text, ...(details === null ? { details: null } : { details }) };
}

/**
 * Snapshot worth persisting for a streaming session, or null when there is
 * nothing to lose (no in-flight message, no tool activity, no finished
 * requests).
 */
export function snapshotFromLive(live: SessionLive, now: number): StreamSnapshot | null {
	if (!live.streaming) return null;
	const streamingMessage = live.streamingMessage;
	const hasMessage = streamingMessage !== null;
	const hasTools = Object.keys(live.tools).length > 0;
	const hasRequests = live.liveRequests.length > 0;
	if (!hasMessage && !hasTools && !hasRequests) return null;
	const tools: Record<string, LiveTool> = {};
	for (const [id, tool] of Object.entries(live.tools)) tools[id] = slimTool(tool);
	return {
		v: 1,
		savedAt: now,
		streamingMessage: hasMessage ? streamingMessage : null,
		liveRequests: live.liveRequests.slice(-MAX_REQUESTS),
		tools,
		thinkingStartedAt: live.thinkingStartedAt ?? null,
		thinkingEndedAt: live.thinkingEndedAt ?? null,
		turnStartedAt: live.turnStartedAt ?? null,
		thinkingDurations: { ...(live.thinkingDurations ?? {}) },
		answerText: answerTextOf(streamingMessage),
		toolIds: toolIdsOf(streamingMessage),
	};
}

// ---- localStorage (silent degradation everywhere) ----

export function loadSnapshot(sessionId: string): StreamSnapshot | null {
	try {
		const raw = globalThis.localStorage?.getItem(KEY(sessionId));
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (typeof parsed !== "object" || parsed === null) return null;
		const snap = parsed as Partial<StreamSnapshot>;
		if (snap.v !== 1) return null;
		return {
			v: 1,
			savedAt: typeof snap.savedAt === "number" ? snap.savedAt : 0,
			streamingMessage: (snap.streamingMessage ?? null) as AgentMessage | null,
			liveRequests: Array.isArray(snap.liveRequests)
				? (snap.liveRequests as LiveRequest[])
				: [],
			tools:
				typeof snap.tools === "object" && snap.tools !== null
					? (snap.tools as Record<string, LiveTool>)
					: {},
			thinkingStartedAt: typeof snap.thinkingStartedAt === "number" ? snap.thinkingStartedAt : null,
			thinkingEndedAt: typeof snap.thinkingEndedAt === "number" ? snap.thinkingEndedAt : null,
			turnStartedAt: typeof snap.turnStartedAt === "number" ? snap.turnStartedAt : null,
			thinkingDurations:
				typeof snap.thinkingDurations === "object" && snap.thinkingDurations !== null
					? (snap.thinkingDurations as StreamSnapshot["thinkingDurations"])
					: {},
			answerText: typeof snap.answerText === "string" ? snap.answerText : "",
			toolIds: Array.isArray(snap.toolIds)
				? snap.toolIds.filter((id): id is string => typeof id === "string")
				: [],
		};
	} catch {
		return null;
	}
}

/** Drop the oldest snapshots beyond the session cap (by savedAt). */
function pruneSnapshots(keep: string): void {
	const storage = globalThis.localStorage;
	if (!storage) return;
	const entries: { sid: string; savedAt: number }[] = [];
	try {
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (!key || !key.startsWith(KEY_PREFIX)) continue;
			const sid = key.slice(KEY_PREFIX.length);
			if (sid === keep) continue;
			const snap = loadSnapshot(sid);
			entries.push({ sid, savedAt: snap?.savedAt ?? 0 });
		}
	} catch {
		return;
	}
	if (entries.length < MAX_SNAPSHOT_SESSIONS) return;
	entries.sort((a, b) => a.savedAt - b.savedAt);
	for (const e of entries.slice(0, entries.length - MAX_SNAPSHOT_SESSIONS + 1)) {
		try {
			storage.removeItem(KEY(e.sid));
		} catch {
			/* ignore */
		}
	}
}

export function saveSnapshot(sessionId: string, snapshot: StreamSnapshot): void {
	try {
		const storage = globalThis.localStorage;
		if (!storage) return;
		let json = JSON.stringify(snapshot);
		if (json.length > MAX_SNAPSHOT_JSON) {
			// One giant message: keep only the in-flight half sentence.
			const slim: StreamSnapshot = {
				...snapshot,
				liveRequests: [],
				tools: {},
				thinkingDurations: {},
				streamingMessage: snapshot.streamingMessage,
				answerText: snapshot.answerText.slice(0, MAX_SLIM_TEXT),
			};
			json = JSON.stringify(slim);
			if (json.length > MAX_SNAPSHOT_JSON) return;
		}
		storage.setItem(KEY(sessionId), json);
		pruneSnapshots(sessionId);
	} catch {
		/* storage unavailable or full: retention is best-effort only */
	}
}

export function clearSnapshot(sessionId: string): void {
	try {
		globalThis.localStorage?.removeItem(KEY(sessionId));
	} catch {
		/* storage unavailable */
	}
}

// ---- Dedup against real data sources ----

const norm = (t: string): string => t.replace(/\s+/g, " ").trim();

/** Below this length a loose `includes` match is too easy to fake. */
const MIN_PREFIX_LEN = 16;

/**
 * True when `items` (a transcript page) already carries the snapshot's
 * content: the in-flight text appears in some assistant item, or (when the
 * message had no text yet) one of its tool calls was committed.
 */
export function snapshotInItems(
	snap: Pick<StreamSnapshot, "answerText" | "toolIds">,
	items: readonly TranscriptItem[],
): boolean {
	const prefix = norm(snap.answerText);
	if (prefix) {
		const probe = prefix.slice(0, 80);
		const loose = probe.length >= MIN_PREFIX_LEN;
		for (const item of items) {
			if (item.kind !== "assistant") continue;
			const text = norm(item.text ?? "");
			if (!text) continue;
			if (loose ? text.includes(probe) || probe.includes(text) : text === prefix) {
				return true;
			}
		}
	}
	if (!prefix && snap.toolIds.length > 0) {
		const ids = new Set(snap.toolIds);
		for (const item of items) {
			for (const call of item.toolCalls ?? []) {
				if (ids.has(call.id)) return true;
			}
		}
	}
	return false;
}

/**
 * True when a snapshot and an in-flight message describe the same answer
 * (the snapshot's text is a prefix of the message's text): a reattach mid-
 * turn may then merge the snapshot's completed requests and tools back in.
 */
export function snapshotContinues(
	snap: Pick<StreamSnapshot, "answerText">,
	msg: AgentMessage | null | undefined,
): boolean {
	const saved = norm(snap.answerText);
	const current = norm(answerTextOf(msg));
	if (!saved) return false;
	return current.startsWith(saved);
}

/**
 * Merge a snapshot into a live session that is streaming again (reattach
 * mid-turn): live values win where both exist; snapshot-only completed
 * requests and tool entries fill the gaps so the turn continues seamlessly.
 */
export function mergeSnapshotIntoLive(live: SessionLive, snap: StreamSnapshot): Partial<SessionLive> {
	const known = new Set(live.liveRequests.map((r) => r.id));
	const requests = [
		...snap.liveRequests.filter((r) => !known.has(r.id)),
		...live.liveRequests,
	];
	const tools = { ...snap.tools };
	for (const [id, tool] of Object.entries(live.tools)) tools[id] = tool;
	return {
		liveRequests: requests.slice(-MAX_REQUESTS),
		tools,
		thinkingStartedAt: live.thinkingStartedAt ?? snap.thinkingStartedAt ?? null,
		thinkingEndedAt: live.thinkingEndedAt ?? snap.thinkingEndedAt ?? null,
		turnStartedAt: live.turnStartedAt ?? snap.turnStartedAt ?? null,
		thinkingDurations: { ...snap.thinkingDurations, ...(live.thinkingDurations ?? {}) },
	};
}

export interface UnfinishedDisplay {
	/** In-flight answer text (the part that was lost). */
	text: string;
	/** Thinking spans of the in-flight message. */
	thinking: string[];
	/** Tool activity at snapshot time (in-flight calls + running tools). */
	tools: { id: string; name: string; running: boolean }[];
}

/** What the "未完成回答（上次中断）" row renders: only the lost in-flight
 * part — completed requests live in the transcript and must not repeat. */
export function unfinishedDisplay(snap: StreamSnapshot): UnfinishedDisplay {
	const msg = snap.streamingMessage;
	const declared = new Set(toolIdsOf(msg));
	const tools: UnfinishedDisplay["tools"] = [];
	for (const raw of msg && Array.isArray(msg.content) ? msg.content : []) {
		const p = asPart(raw);
		if ((p.type === "tool_use" || p.type === "toolCall") && typeof p.id === "string" && p.id) {
			tools.push({ id: p.id, name: str(p.name) || "tool", running: false });
		}
	}
	for (const [id, tool] of Object.entries(snap.tools)) {
		if (declared.has(id) || tools.some((t) => t.id === id)) continue;
		tools.push({ id, name: tool.toolName || "tool", running: tool.status === "running" });
	}
	return {
		text: answerTextOf(msg),
		thinking: thinkingTextsOf(msg),
		tools,
	};
}
