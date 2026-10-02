import type { Attention, SessionMeta } from "../../lib/contracts";

/** Display order of the 全部 sections. */
export const ATTENTION_ORDER: readonly Attention[] = ["awaiting", "error", "unread", "running"];

export interface InboxGroups {
	/** Visible sessions per kind, most recent `updatedAt` first. */
	byKind: Record<Attention, SessionMeta[]>;
	/** All visible sessions in 全部 order (sections concatenated). */
	all: SessionMeta[];
	/** Sidebar / Dock badge: awaiting + error + unread (running excluded). */
	badge: number;
}

const HOUR_MS = 3_600_000;

/**
 * Applies the inbox time window to the backend-derived `attention` kinds.
 * Archived sessions never show; `awaiting` and `running` never expire;
 * other kinds drop out once `updatedAt` is older than `now - windowHours`.
 * Mirrors `inbox_badge_count` on the Rust side.
 */
export function groupInbox(
	sessions: Iterable<SessionMeta>,
	now: number,
	windowHours: number,
): InboxGroups {
	const cutoff = now - windowHours * HOUR_MS;
	const byKind: Record<Attention, SessionMeta[]> = {
		awaiting: [],
		error: [],
		unread: [],
		running: [],
	};
	for (const s of sessions) {
		const kind = s.attention;
		if (!kind || s.archived) continue;
		if (kind !== "awaiting" && kind !== "running") {
			const t = Date.parse(s.updatedAt);
			if (Number.isFinite(t) && t < cutoff) continue;
		}
		byKind[kind].push(s);
	}
	for (const list of Object.values(byKind)) {
		list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
	}
	return {
		byKind,
		all: ATTENTION_ORDER.flatMap((k) => byKind[k]),
		badge: byKind.awaiting.length + byKind.error.length + byKind.unread.length,
	};
}
