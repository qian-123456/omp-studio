/**
 * 断流续传 · 半句留存: omp persists a message only at `message_end`, so a page killed
 * mid-stream loses the unfinished half everywhere. While streaming, the controller mirrors
 * the latest live row here (throttled); on reopen the controller restores it — as the live
 * row when the backend is still streaming, as a marked interrupted row otherwise.
 *
 * Per session the entry holds two slots: `main` (the ongoing stream's latest snapshot,
 * cleared when the turn ends normally or the persisted row takes over) and `stale` (an
 * interrupted answer kept until a data source carries the same content or the user removes it).
 */

import { LIVE_ID, emptyItem } from "../../../core/normalize";
import type { Item, ToolItem } from "../../../core/types";

export const LIVE_SNAPSHOT_KEY = "ompm.chat.livestream";
/** Minimum interval between two mirror writes of the streaming row. */
export const LIVE_SNAPSHOT_THROTTLE_MS = 600;
const MAX_ENTRIES = 8;
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const MAX_TEXT = 200_000;
const MAX_THINKING = 100_000;
const MAX_TOOLS = 64;
const MAX_TOOL_RESULT = 4000;
const MAX_ENTRY_JSON = 1_000_000;

export interface LiveSnapshotBody {
	text: string;
	thinking: string;
	tools: ToolItem[];
	at: number;
}

interface Entry {
	main?: LiveSnapshotBody;
	stale?: LiveSnapshotBody;
}

type Book = Record<string, Entry>;

const store = (): Storage | null => {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
};

function read(storage: Storage): Book {
	try {
		const raw = storage.getItem(LIVE_SNAPSHOT_KEY);
		const v = raw ? (JSON.parse(raw) as unknown) : null;
		return v && typeof v === "object" ? (v as Book) : {};
	} catch {
		return {};
	}
}

function write(storage: Storage, book: Book, now: number): void {
	try {
		const entries = Object.entries(book)
			.filter(([, e]) => e && (e.main || e.stale) && (e.main?.at ?? e.stale?.at ?? 0) > now - MAX_AGE_MS)
			.sort((a, b) => (b[1].main?.at ?? b[1].stale?.at ?? 0) - (a[1].main?.at ?? a[1].stale?.at ?? 0))
			.slice(0, MAX_ENTRIES);
		if (!entries.length) storage.removeItem(LIVE_SNAPSHOT_KEY);
		else storage.setItem(LIVE_SNAPSHOT_KEY, JSON.stringify(Object.fromEntries(entries)));
	} catch {
		/* quota / private mode: the mirror is best-effort and must never break streaming */
	}
}

const asBody = (v: unknown): LiveSnapshotBody | null => {
	if (!v || typeof v !== "object") return null;
	const b = v as Partial<LiveSnapshotBody>;
	if (typeof b.text !== "string" || typeof b.thinking !== "string" || !Array.isArray(b.tools)) return null;
	const tools = b.tools.filter((t): t is ToolItem => !!t && typeof t === "object" && typeof (t as ToolItem).id === "string");
	return { text: b.text, thinking: b.thinking, tools, at: typeof b.at === "number" ? b.at : 0 };
};

/** The saved entry for one session, or null. Corrupted data is treated as absent. */
export function loadLiveEntry(id: string, storage: Storage | null = store()): Entry | null {
	if (!storage) return null;
	const e = read(storage)[id];
	if (!e || typeof e !== "object") return null;
	const main = asBody(e.main);
	const stale = asBody(e.stale);
	if (!main && !stale) return null;
	return { main: main ?? undefined, stale: stale ?? undefined };
}

/** Mirror the streaming row (content-capped); failures are swallowed by design. */
export function saveLiveMain(id: string, body: LiveSnapshotBody, storage: Storage | null = store()): void {
	if (!storage) return;
	const book = read(storage);
	const capped: LiveSnapshotBody = {
		text: body.text.length > MAX_TEXT ? body.text.slice(-MAX_TEXT) : body.text,
		thinking: body.thinking.length > MAX_THINKING ? body.thinking.slice(-MAX_THINKING) : body.thinking,
		tools: body.tools.slice(-MAX_TOOLS).map((t) => ({ ...t, result: t.result.length > MAX_TOOL_RESULT ? t.result.slice(0, MAX_TOOL_RESULT) : t.result })),
		at: body.at,
	};
	const entry: Entry = { ...book[id], main: capped };
	if (JSON.stringify(entry).length > MAX_ENTRY_JSON) entry.main = { ...capped, tools: [] };
	if (JSON.stringify(entry).length > MAX_ENTRY_JSON) return;
	book[id] = entry;
	write(storage, book, body.at);
}

/** Move content out of the streaming slot into the interrupted slot (replaces any previous stale). */
export function stashLiveStale(id: string, body: LiveSnapshotBody, storage: Storage | null = store()): void {
	if (!storage) return;
	const book = read(storage);
	book[id] = { stale: body };
	write(storage, book, body.at);
}

export const clearLiveMain = (id: string, storage: Storage | null = store()): void => {
	if (!storage) return;
	const book = read(storage);
	if (!book[id]?.main) return;
	const { main: _drop, ...rest } = book[id];
	if (rest.stale) book[id] = rest;
	else delete book[id];
	write(storage, book, Date.now());
};

export const clearLiveStale = (id: string, storage: Storage | null = store()): void => {
	if (!storage) return;
	const book = read(storage);
	if (!book[id]?.stale) return;
	const { stale: _drop, ...rest } = book[id];
	if (rest.main) book[id] = rest;
	else delete book[id];
	write(storage, book, Date.now());
};

/** Rebuild a live-shaped Item from a snapshot: text/thinking/tools only, no invented metadata. */
export function snapshotToItem(b: LiveSnapshotBody, streaming: boolean): Item {
	const item = emptyItem(LIVE_ID, "assistant", "assistant");
	item.text = b.text;
	item.thinking = b.thinking;
	item.tools = b.tools;
	item.streaming = streaming;
	return item;
}
