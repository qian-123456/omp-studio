/**
 * App-local thread rows: echoes + result cards of slash commands that omp
 * handles (or the app runs) without ever writing a transcript item, plus
 * compaction / handoff dividers. Each row records its send time and the id of
 * the last transcript item at that moment (`anchorId`); the thread splices it
 * in right after that item, so later replies render below it instead of the
 * row staying pinned at the bottom. Rows are persisted per session
 * (docs/ARCHITECTURE.md §6 `local_rows`) and survive a restart.
 */
import type { ImageAttachment, TranscriptItem } from "../../lib/contracts";
import type { CommandOutputEntry, FlowNotice, FlowNoticeKind, UserEcho } from "../../stores/live";

export type LocalRowPayload =
	| { type: "echo"; echo: UserEcho }
	| { type: "output"; entry: CommandOutputEntry };

/** Synthetic thread item that stands for a local row. */
export type LocalRowItem = TranscriptItem & { localRow?: LocalRowPayload };

export const isLocalRowItem = (
	item: TranscriptItem,
): item is LocalRowItem & { localRow: LocalRowPayload } =>
	(item as LocalRowItem).localRow !== undefined;

/** An echo is the same user line as a transcript item written within this window. */
const ECHO_BEFORE_MS = 5_000;
const ECHO_AFTER_MS = 120_000;
const MAX_PERSISTED_ROWS = 200;

const norm = (t: string): string => t.replace(/\s+/g, " ").trim();

function rowItem(
	id: string,
	tsMs: number,
	localRow: LocalRowPayload,
): LocalRowItem {
	return {
		id,
		parentId: null,
		ts: new Date(tsMs).toISOString(),
		kind: "system",
		text: localRow.type === "echo" ? (localRow.echo.text ?? null) : localRow.entry.text,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		localRow,
	};
}

interface Placed {
	ts: number;
	anchorId: string | null;
	item: LocalRowItem;
}

/**
 * Splice local rows into `items`. A row goes right after its anchor item; an
 * unknown / missing anchor falls back to send time (after the last item
 * written at or before it). Rows sharing a slot keep send-time order. An echo
 * the transcript already carries (same user line written right after it was
 * sent) is dropped, never shown twice.
 */
export function withLocalRows(
	items: TranscriptItem[],
	echoes: readonly UserEcho[],
	outputs: readonly CommandOutputEntry[],
): TranscriptItem[] {
	if (echoes.length === 0 && outputs.length === 0) return items;
	const users = items
		.filter((i) => i.kind === "user")
		.map((i) => ({ text: norm(i.text ?? ""), ts: Date.parse(i.ts) }));
	const placed: Placed[] = [];
	for (const echo of echoes) {
		const ts = Date.parse(echo.ts);
		const text = norm(echo.text ?? "");
		const dup = users.some(
			(u) =>
				u.text === text &&
				!Number.isNaN(u.ts) &&
				u.ts >= ts - ECHO_BEFORE_MS &&
				u.ts <= ts + ECHO_AFTER_MS,
		);
		if (dup) continue;
		placed.push({
			ts,
			anchorId: echo.anchorId ?? null,
			item: rowItem(`local-echo-${echo.id}`, ts, { type: "echo", echo }),
		});
	}
	for (const entry of outputs) {
		placed.push({
			ts: entry.ts,
			anchorId: entry.anchorId ?? null,
			item: rowItem(`local-output-${entry.id}`, entry.ts, { type: "output", entry }),
		});
	}
	if (placed.length === 0) return items;

	const anchorIndex = new Map<string, number>();
	const times = items.map((it, i) => {
		anchorIndex.set(it.id, i);
		return Date.parse(it.ts);
	});
	const slotOf = (p: Placed): number => {
		const byAnchor = p.anchorId === null ? undefined : anchorIndex.get(p.anchorId);
		if (byAnchor !== undefined) return byAnchor;
		let idx = -1;
		times.forEach((t, i) => {
			if (!Number.isNaN(t) && t <= p.ts) idx = i;
		});
		return idx;
	};
	const after = new Map<number, Placed[]>(); // item index (-1 = head) → rows
	for (const p of placed) {
		const idx = slotOf(p);
		after.set(idx, [...(after.get(idx) ?? []), p]);
	}
	const emit = (idx: number, out: TranscriptItem[]) => {
		const rows = after.get(idx);
		if (!rows) return;
		// Array#sort is stable: echoes (pushed first) stay before an equal-time card.
		for (const p of [...rows].sort((a, b) => a.ts - b.ts)) out.push(p.item);
	};
	const out: TranscriptItem[] = [];
	emit(-1, out);
	items.forEach((it, i) => {
		out.push(it);
		emit(i, out);
	});
	return out;
}

// ---- Persistence (opaque JSON array per session, see ipc localRowsGet/Set) ----

export type PersistedRow =
	| {
			t: "echo";
			id: string;
			ts: string;
			anchorId: string | null;
			text: string;
			images?: ImageAttachment[];
	  }
	| {
			t: "output";
			ts: number;
			anchorId: string | null;
			command?: string;
			text: string;
			kind: "omp" | "app";
			status?: "done" | "error";
	  }
	| {
			t: "flow";
			kind: FlowNoticeKind;
			status: "done" | "error";
			startedAt: number;
			endedAt?: number;
			anchorId: string | null;
			tokensBefore?: number;
			tokensAfter?: number;
			detail?: string;
	  };

/** Settled rows only: a running card / divider belongs to this process. */
export function serializeLocalRows(
	echoes: readonly UserEcho[],
	outputs: readonly CommandOutputEntry[],
	flows: readonly FlowNotice[],
): PersistedRow[] {
	const rows: { ts: number; row: PersistedRow }[] = [];
	for (const e of echoes) {
		rows.push({
			ts: Date.parse(e.ts) || 0,
			row: {
				t: "echo",
				id: e.id,
				ts: e.ts,
				anchorId: e.anchorId ?? null,
				text: e.text ?? "",
				...(e.images?.length ? { images: e.images } : {}),
			},
		});
	}
	for (const o of outputs) {
		if (o.status === "running") continue;
		rows.push({
			ts: o.ts,
			row: {
				t: "output",
				ts: o.ts,
				anchorId: o.anchorId ?? null,
				...(o.command ? { command: o.command } : {}),
				text: o.text,
				kind: o.kind,
				...(o.status ? { status: o.status } : {}),
			},
		});
	}
	for (const f of flows) {
		if (f.status === "running") continue;
		rows.push({
			ts: f.startedAt,
			row: {
				t: "flow",
				kind: f.kind,
				status: f.status,
				startedAt: f.startedAt,
				...(f.endedAt !== undefined ? { endedAt: f.endedAt } : {}),
				anchorId: f.anchorId,
				...(f.tokensBefore !== undefined ? { tokensBefore: f.tokensBefore } : {}),
				...(f.tokensAfter !== undefined ? { tokensAfter: f.tokensAfter } : {}),
				...(f.detail ? { detail: f.detail } : {}),
			},
		});
	}
	rows.sort((a, b) => a.ts - b.ts);
	return rows.slice(-MAX_PERSISTED_ROWS).map((r) => r.row);
}

const isAnchor = (v: unknown): v is string | null => v === null || typeof v === "string";

/** Defensive parse of the stored array: malformed rows are dropped. */
export function parseLocalRows(raw: unknown): PersistedRow[] {
	if (!Array.isArray(raw)) return [];
	const out: PersistedRow[] = [];
	for (const r of raw as Record<string, unknown>[]) {
		if (!r || typeof r !== "object") continue;
		const anchorId = r.anchorId ?? null;
		if (!isAnchor(anchorId)) continue;
		if (r.t === "echo" && typeof r.id === "string" && typeof r.ts === "string" && typeof r.text === "string") {
			out.push({
				t: "echo",
				id: r.id,
				ts: r.ts,
				anchorId,
				text: r.text,
				...(Array.isArray(r.images) ? { images: r.images as ImageAttachment[] } : {}),
			});
		} else if (
			r.t === "output" &&
			typeof r.ts === "number" &&
			typeof r.text === "string" &&
			(r.kind === "omp" || r.kind === "app")
		) {
			out.push({
				t: "output",
				ts: r.ts,
				anchorId,
				...(typeof r.command === "string" ? { command: r.command } : {}),
				text: r.text,
				kind: r.kind,
				...(r.status === "done" || r.status === "error" ? { status: r.status } : {}),
			});
		} else if (
			r.t === "flow" &&
			(r.kind === "compaction" || r.kind === "handoff") &&
			(r.status === "done" || r.status === "error") &&
			typeof r.startedAt === "number"
		) {
			const num = (v: unknown) => (typeof v === "number" ? v : undefined);
			out.push({
				t: "flow",
				kind: r.kind,
				status: r.status,
				startedAt: r.startedAt,
				...(num(r.endedAt) !== undefined ? { endedAt: num(r.endedAt) } : {}),
				anchorId,
				...(num(r.tokensBefore) !== undefined ? { tokensBefore: num(r.tokensBefore) } : {}),
				...(num(r.tokensAfter) !== undefined ? { tokensAfter: num(r.tokensAfter) } : {}),
				...(typeof r.detail === "string" ? { detail: r.detail } : {}),
			});
		}
	}
	return out;
}
