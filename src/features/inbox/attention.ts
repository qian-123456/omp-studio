import type { Attention, SessionMeta, Todo } from "../../lib/contracts";

/** Session-backed inbox kinds. `awaiting`/`error` attention is split by session status. */
export type InboxSessionKind = "approval" | "question" | "error" | "interrupted" | "unread" | "running";

/** Every inbox kind; `schedule` rows are open `schedule_run` todos. */
export type InboxKind = InboxSessionKind | "schedule";

/** Display order of the 全部 sections. */
export const INBOX_ORDER: readonly InboxKind[] = [
	"approval",
	"question",
	"error",
	"interrupted",
	"unread",
	"schedule",
	"running",
];

export type InboxEntry =
	| { type: "session"; kind: InboxSessionKind; session: SessionMeta }
	| { type: "schedule"; kind: "schedule"; todo: Todo };

export interface InboxGroups {
	/** Visible sessions per kind, most recent `updatedAt` first. */
	byKind: Record<InboxSessionKind, SessionMeta[]>;
	/** Open `schedule_run` todos, newest first. */
	schedule: Todo[];
	/** Entries per kind (sessions and schedule todos) in display form. */
	entries: Record<InboxKind, InboxEntry[]>;
	/** All entries in 全部 order (sections concatenated by INBOX_ORDER). */
	all: InboxEntry[];
	/** Sidebar badge: approval + question + error + interrupted + unread sessions + open schedule todos (running excluded). */
	badge: number;
}

const HOUR_MS = 3_600_000;

/** Maps the backend attention kind onto the finer inbox kind using session status. */
export function sessionKind(s: SessionMeta, attention: Attention): InboxSessionKind {
	switch (attention) {
		case "awaiting":
			return s.status === "awaiting_approval" ? "approval" : "question";
		case "error":
			return s.status === "interrupted" ? "interrupted" : "error";
		case "unread":
			return "unread";
		case "running":
			return "running";
	}
}

/**
 * Applies the inbox time window to the backend-derived `attention` kinds.
 * Archived sessions never show; approval/question and running never expire;
 * other kinds drop out once `updatedAt` is older than `now - windowHours`.
 * Open `schedule_run` todos are not windowed and ignore session attention.
 * Mirrors `inbox_badge_count` on the Rust side for the session part.
 */
export function groupInbox(
	sessions: Iterable<SessionMeta>,
	now: number,
	windowHours: number,
	todos: Iterable<Todo> = [],
): InboxGroups {
	const cutoff = now - windowHours * HOUR_MS;
	const byKind: Record<InboxSessionKind, SessionMeta[]> = {
		approval: [],
		question: [],
		error: [],
		interrupted: [],
		unread: [],
		running: [],
	};
	for (const s of sessions) {
		const attention = s.attention;
		if (!attention || s.archived) continue;
		if (attention !== "awaiting" && attention !== "running") {
			const t = Date.parse(s.updatedAt);
			if (Number.isFinite(t) && t < cutoff) continue;
		}
		byKind[sessionKind(s, attention)].push(s);
	}
	for (const list of Object.values(byKind)) {
		list.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
	}
	const schedule = [...todos]
		.filter((t) => t.kind === "schedule_run" && t.status === "open")
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

	const entries = {} as Record<InboxKind, InboxEntry[]>;
	for (const k of Object.keys(byKind) as InboxSessionKind[]) {
		entries[k] = byKind[k].map((session) => ({ type: "session", kind: k, session }));
	}
	entries.schedule = schedule.map((todo) => ({ type: "schedule", kind: "schedule", todo }));

	return {
		byKind,
		schedule,
		entries,
		all: INBOX_ORDER.flatMap((k) => entries[k]),
		badge:
			byKind.approval.length +
			byKind.question.length +
			byKind.error.length +
			byKind.interrupted.length +
			byKind.unread.length +
			schedule.length,
	};
}
