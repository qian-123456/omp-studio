import type { SessionMeta, SessionSearchHit, Workspace } from "../../../lib/contracts";
import { isEmptySideChat, matchesSearch } from "../grouping";
import { tNow } from "../../../stores/language";

/** Max rows shown for the empty-query "最近会话" list. */
export const RECENT_LIMIT = 100;
/** Max instant metadata rows shown while typing. */
export const META_LIMIT = 50;

export type RecentBucketKey = "today" | "yesterday" | "last7Days" | "last30Days" | "earlier";

export interface RecentBucket {
	key: RecentBucketKey;
	label: string;
	sessions: SessionMeta[];
}

/** One selectable result row (a session, optionally with its best message snippet). */
export interface SearchRow {
	/** Stable list key: the session id. */
	key: string;
	session: SessionMeta;
	/** Best message hit; null for a pure metadata hit. */
	hit: SessionSearchHit | null;
	source: "meta" | "content";
}

function sessionTime(s: SessionMeta): number {
	const t = Date.parse(s.updatedAt || s.createdAt);
	return Number.isNaN(t) ? 0 : t;
}

/**
 * Sessions the dialog can list at all: no zero-message side chats and no blank
 * drafts. `isBlank` is injected so this stays free of live-store imports.
 */
export function searchableSessions(
	sessions: Iterable<SessionMeta>,
	isBlank: (s: SessionMeta) => boolean,
): SessionMeta[] {
	const out: SessionMeta[] = [];
	for (const s of sessions) {
		if (isEmptySideChat(s) || isBlank(s)) continue;
		out.push(s);
	}
	return out;
}

/** Group sessions (any order) into recency buckets, most recent first; empty buckets omitted. */
export function bucketRecent(
	sessions: readonly SessionMeta[],
	now: Date = new Date(),
): RecentBucket[] {
	const day = (offset: number) =>
		new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset).getTime();
	const startToday = day(0);
	const startYesterday = day(1);
	const start7 = day(6);
	const start30 = day(29);

	const buckets: RecentBucket[] = [
		{ key: "today", label: tNow("time.today"), sessions: [] },
		{ key: "yesterday", label: tNow("time.yesterday"), sessions: [] },
		{ key: "last7Days", label: tNow("time.past7Days"), sessions: [] },
		{ key: "last30Days", label: tNow("time.past30Days"), sessions: [] },
		{ key: "earlier", label: tNow("time.earlier"), sessions: [] },
	];
	const sorted = [...sessions].sort((a, b) => sessionTime(b) - sessionTime(a));
	for (const s of sorted) {
		const t = sessionTime(s);
		let idx = 4;
		if (t >= startToday) idx = 0;
		else if (t >= startYesterday) idx = 1;
		else if (t >= start7) idx = 2;
		else if (t >= start30) idx = 3;
		buckets[idx].sessions.push(s);
	}
	return buckets.filter((b) => b.sessions.length > 0);
}

/** Cap the total number of rows across buckets (keeps the empty-query list light). */
export function limitBuckets(buckets: RecentBucket[], limit: number): RecentBucket[] {
	let left = limit;
	const out: RecentBucket[] = [];
	for (const b of buckets) {
		if (left <= 0) break;
		const sessions = b.sessions.slice(0, left);
		left -= sessions.length;
		out.push({ ...b, sessions });
	}
	return out;
}

/** Instant tier: sessions whose metadata matches every query token, newest first. */
export function metadataMatches(
	sessions: readonly SessionMeta[],
	query: string,
	workspaces: readonly Workspace[],
	limit: number = META_LIMIT,
): SessionMeta[] {
	const wsPath = new Map<string, string>();
	for (const w of workspaces) wsPath.set(w.id, w.path);
	const out: SessionMeta[] = [];
	for (const s of sessions) {
		if (matchesSearch(s, query, s.workspaceId ? wsPath.get(s.workspaceId) : undefined)) out.push(s);
	}
	out.sort((a, b) => sessionTime(b) - sessionTime(a));
	return out.slice(0, limit);
}

/**
 * Merge the instant metadata tier with the content tier into one row per
 * session: metadata rows first (carrying their snippet when the session also
 * matched by content), then content-only rows in backend order (relevance,
 * then recency). Content hits for sessions that are not listable are dropped.
 */
export function mergeResults(
	metaSessions: readonly SessionMeta[],
	contentHits: readonly SessionSearchHit[],
	listable: ReadonlyMap<string, SessionMeta>,
): SearchRow[] {
	const hitBySession = new Map<string, SessionSearchHit>();
	for (const h of contentHits) {
		if (!hitBySession.has(h.sessionId)) hitBySession.set(h.sessionId, h);
	}
	const rows: SearchRow[] = [];
	const seen = new Set<string>();
	for (const s of metaSessions) {
		if (seen.has(s.id)) continue;
		seen.add(s.id);
		rows.push({ key: s.id, session: s, hit: hitBySession.get(s.id) ?? null, source: "meta" });
	}
	for (const h of hitBySession.values()) {
		if (seen.has(h.sessionId)) continue;
		const session = listable.get(h.sessionId);
		if (!session) continue;
		seen.add(h.sessionId);
		rows.push({ key: h.sessionId, session, hit: h, source: "content" });
	}
	// Newest first (the time shown on each row); Array.sort is stable, so ties keep source order.
	const when = (s: SessionMeta) => Date.parse(s.updatedAt || s.createdAt) || 0;
	return rows.sort((x, y) => when(y.session) - when(x.session));
}

export type SearchScopeFilter = "all" | "project" | "universal";
export type SearchTimeFilter = "all" | "today" | "7days" | "30days";

export interface SearchFilters {
	scope: SearchScopeFilter;
	projectId: string;
	timeRange: SearchTimeFilter;
	includeArchived: boolean;
}

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
	scope: "all",
	projectId: "all",
	timeRange: "all",
	includeArchived: true,
};

export function countActiveFilters(filters: SearchFilters): number {
	let count = 0;
	if (filters.scope !== "all") count++;
	if (filters.projectId !== "all") count++;
	if (filters.timeRange !== "all") count++;
	if (!filters.includeArchived) count++;
	return count;
}

export function matchesSearchFilters(
	session: SessionMeta,
	filters: SearchFilters,
	workspacesById: ReadonlyMap<string, Workspace>,
	now: number = Date.now(),
): boolean {
	if (!filters.includeArchived && session.archived) {
		return false;
	}

	const ws = session.workspaceId ? workspacesById.get(session.workspaceId) : undefined;
	const isGlobal = !session.workspaceId || ws?.kind === "global";

	if (filters.scope === "project" && isGlobal) {
		return false;
	}
	if (filters.scope === "universal" && !isGlobal) {
		return false;
	}

	if (filters.projectId !== "all") {
		if (session.workspaceId !== filters.projectId) {
			return false;
		}
	}

	if (filters.timeRange !== "all") {
		const time = Date.parse(session.updatedAt || session.createdAt) || 0;
		const nowDate = new Date(now);
		const startOfToday = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
		if (filters.timeRange === "today") {
			if (time < startOfToday) return false;
		} else if (filters.timeRange === "7days") {
			const start7Days = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 6).getTime();
			if (time < start7Days) return false;
		} else if (filters.timeRange === "30days") {
			const start30Days = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate() - 29).getTime();
			if (time < start30Days) return false;
		}
	}

	return true;
}
