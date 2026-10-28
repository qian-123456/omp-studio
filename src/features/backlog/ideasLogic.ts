import type { BacklogItem, BacklogKind, SessionMeta, Workspace } from "../../lib/contracts";
import { repoRootFromWorktree } from "../git/helpers";
import { tNow } from "../../stores/language";

/** Repo root for a project dir so all worktrees of one repo share a project. */
export function projectRoot(dir: string | null | undefined): string | null {
	return dir ? repoRootFromWorktree(dir) : null;
}

/** Newest captured first; falls back to updatedAt for legacy items. */
export const byCreatedDesc = (a: BacklogItem, b: BacklogItem) =>
	(b.createdAt || b.updatedAt).localeCompare(a.createdAt || a.updatedAt);

export type IdeaPhase = "pending" | "running" | "review" | "finished" | "trash";

export const IDEA_PHASES: readonly IdeaPhase[] = ["pending", "running", "review", "finished", "trash"];

/** Days a trashed item is kept before it is purged on app start. */
export const TRASH_RETENTION_DAYS = 7;

/**
 * Determine the phase (tab) of a backlog item.
 * deletedAt set → trash (never shown in other tabs); inbox → pending; done|closed → finished;
 * dispatched → running when the linked session exists, is not archived,
 * and status ∈ {working, awaiting_approval, awaiting_answer}; every other dispatched case → review.
 */
export function ideaPhase(item: BacklogItem, session: SessionMeta | undefined): IdeaPhase {
	if (item.deletedAt) return "trash";
	if (item.status === "inbox") return "pending";
	if (item.status === "done" || item.status === "closed") return "finished";
	if (item.status === "dispatched") {
		if (
			session &&
			!session.archived &&
			(session.status === "working" ||
				session.status === "awaiting_approval" ||
				session.status === "awaiting_answer")
		) {
			return "running";
		}
		return "review";
	}
	return "finished";
}

const byDeletedDesc = (a: BacklogItem, b: BacklogItem) => (b.deletedAt ?? "").localeCompare(a.deletedAt ?? "");

/** Each bucket newest-created first (trash: most recently deleted first). */
export function partitionByPhase(
	items: BacklogItem[],
	sessions: Record<string, SessionMeta>,
): Record<IdeaPhase, BacklogItem[]> {
	const buckets: Record<IdeaPhase, BacklogItem[]> = {
		pending: [],
		running: [],
		review: [],
		finished: [],
		trash: [],
	};
	for (const it of items) {
		const session = it.targetSessionId ? sessions[it.targetSessionId] : undefined;
		buckets[ideaPhase(it, session)].push(it);
	}
	for (const phase of IDEA_PHASES) {
		buckets[phase].sort(phase === "trash" ? byDeletedDesc : byCreatedDesc);
	}
	return buckets;
}

/** pending + review count (trashed excluded); drives the top-bar badge. */
export function needsAttentionCount(
	items: BacklogItem[],
	sessions: Record<string, SessionMeta>,
): number {
	let count = 0;
	for (const it of items) {
		const session = it.targetSessionId ? sessions[it.targetSessionId] : undefined;
		const phase = ideaPhase(it, session);
		if (phase === "pending" || phase === "review") {
			count++;
		}
	}
	return count;
}

export interface IdeaSearch {
	query: string;
	/** Empty = all kinds. */
	kinds: BacklogKind[];
}

export const EMPTY_SEARCH: IdeaSearch = { query: "", kinds: [] };

/** Case-insensitive text match plus kind filter (empty kinds = no kind filter). */
export function searchIdeas(items: BacklogItem[], search: IdeaSearch): BacklogItem[] {
	const q = search.query.trim().toLowerCase();
	if (!q && search.kinds.length === 0) return items;
	return items.filter(
		(it) =>
			(search.kinds.length === 0 || search.kinds.includes(it.kind)) && (!q || it.text.toLowerCase().includes(q)),
	);
}

/** Per-tab counts after scope and search (so counts reflect the active filters). */
export function tabCounts(
	items: BacklogItem[],
	sessions: Record<string, SessionMeta>,
	scope: IdeasScope,
	search: IdeaSearch,
): Record<IdeaPhase, number> {
	const buckets = partitionByPhase(searchIdeas(filterIdeas(items, scope), search), sessions);
	return {
		pending: buckets.pending.length,
		running: buckets.running.length,
		review: buckets.review.length,
		finished: buckets.finished.length,
		trash: buckets.trash.length,
	};
}

/** Whole days left before a trashed item is purged (at least 1 while it still exists). */
export function trashDaysLeft(item: BacklogItem, now: Date = new Date()): number {
	const deleted = item.deletedAt ? new Date(item.deletedAt).getTime() : Number.NaN;
	if (Number.isNaN(deleted)) return TRASH_RETENTION_DAYS;
	const left = TRASH_RETENTION_DAYS - (now.getTime() - deleted) / 86_400_000;
	return Math.max(1, Math.ceil(left));
}

/** Project filter: a repo root (see `projectRoot`), or null for all projects. */
export type IdeasScope = string | null;

/** Items visible under `scope`; a repo root keeps items of that repo (any worktree), null keeps everything. */
export function filterIdeas(items: BacklogItem[], scope: IdeasScope): BacklogItem[] {
	if (scope === null) return items;
	return items.filter((i) => projectRoot(i.projectDir) === scope);
}

export interface ScopeOption {
	/** Repo root used as the scope value. */
	root: string;
	label: string;
	isCurrent: boolean;
}

/** Distinct projects that have non-trashed ideas (current project first); ideas without a project are not listed. */
export function scopeOptions(items: BacklogItem[], currentProject: string | null): ScopeOption[] {
	return groupIdeasByProject(
		items.filter((i) => !i.deletedAt),
		currentProject,
	).flatMap((g) => (g.project === null ? [] : [{ root: g.project, label: g.label, isCurrent: g.isCurrent }]));
}

/** A selected project that no longer has items falls back to all projects. */
export function effectiveScope(scope: IdeasScope, options: readonly ScopeOption[]): IdeasScope {
	return scope !== null && options.some((o) => o.root === scope) ? scope : null;
}

/**
 * Inclusive ids between anchor and target following orderedIds order (either direction).
 * anchor null or not in list → [targetId]. target not in list → [].
 */
export function rangeSelection(
	orderedIds: string[],
	anchorId: string | null,
	targetId: string,
): string[] {
	const targetIdx = orderedIds.indexOf(targetId);
	if (targetIdx === -1) return [];
	if (anchorId === null) return [targetId];
	const anchorIdx = orderedIds.indexOf(anchorId);
	if (anchorIdx === -1) return [targetId];
	const start = Math.min(anchorIdx, targetIdx);
	const end = Math.max(anchorIdx, targetIdx);
	return orderedIds.slice(start, end + 1);
}

export function splitSent(
	items: BacklogItem[],
	sentIds: ReadonlySet<string>,
): { remaining: BacklogItem[]; sent: BacklogItem[] } {
	const remaining: BacklogItem[] = [];
	const sent: BacklogItem[] = [];
	for (const it of items) (sentIds.has(it.id) ? sent : remaining).push(it);
	return { remaining, sent };
}
export interface DispatchAttemptResult {
	sentIds: Set<string>;
	pendingStatusUpdates: Map<string, string>;
	sendErrors: Record<string, unknown>;
	statusErrors: Record<string, unknown>;
	firstSession: string | null;
}

/** Send unsent groups once, then retry only the backlog status writes for delivered items. */
export async function dispatchGroups(
	groups: BacklogItem[][],
	sentIds: ReadonlySet<string>,
	pendingStatusUpdates: ReadonlyMap<string, string>,
	sendGroup: (group: BacklogItem[]) => Promise<string>,
	updateStatus: (id: string, sessionId: string) => Promise<void>,
	previousSession: string | null = null,
): Promise<DispatchAttemptResult> {
	const nextSentIds = new Set(sentIds);
	const nextStatusUpdates = new Map(pendingStatusUpdates);
	const sendErrors: Record<string, unknown> = {};
	let firstSession: string | null = previousSession;

	for (const group of groups) {
		const groupKey = group[0]?.id ?? "";
		try {
			const sessionId = await sendGroup(group);
			firstSession ??= sessionId;
			for (const item of group) {
				nextSentIds.add(item.id);
				nextStatusUpdates.set(item.id, sessionId);
			}
		} catch (error) {
			sendErrors[groupKey] = error;
		}
	}

	const statusErrors: Record<string, unknown> = {};
	for (const [id, sessionId] of nextStatusUpdates) {
		try {
			await updateStatus(id, sessionId);
			nextStatusUpdates.delete(id);
		} catch (error) {
			statusErrors[id] = error;
		}
	}

	return {
		sentIds: nextSentIds,
		pendingStatusUpdates: nextStatusUpdates,
		sendErrors,
		statusErrors,
		firstSession,
	};
}

/**
 * Group by projectRoot(projectDir) (null = its own group);
 * groups ordered by first appearance, input order kept inside each group.
 */
export function splitByProject(items: BacklogItem[]): BacklogItem[][] {
	const groups = new Map<string | null, BacklogItem[]>();
	for (const it of items) {
		const key = projectRoot(it.projectDir);
		const list = groups.get(key);
		if (list) {
			list.push(it);
		} else {
			groups.set(key, [it]);
		}
	}
	return [...groups.values()];
}
export interface IdeaGroup {
	/** projectDir, or null for global items. */
	project: string | null;
	label: string;
	isCurrent: boolean;
	items: BacklogItem[];
}

/**
 * Group items by repo root (worktrees merged), each group newest-created first.
 * Current project first, then other projects by their newest item, global (null) last.
 */
export function groupIdeasByProject(items: BacklogItem[], currentProject: string | null): IdeaGroup[] {
	const current = projectRoot(currentProject);
	const groups = new Map<string | null, BacklogItem[]>();
	for (const it of [...items].sort(byCreatedDesc)) {
		const key = projectRoot(it.projectDir);
		const list = groups.get(key);
		if (list) list.push(it);
		else groups.set(key, [it]);
	}
	const rank = (p: string | null) => (p === null ? 2 : p === current ? 0 : 1);
	// Map keeps insertion order = order of each group's newest item.
	return [...groups.entries()]
		.map(([project, list]) => ({
			project,
			label: project === null ? tNow("backlog.unassociatedProject") : (project.split("/").filter(Boolean).pop() ?? project),
			isCurrent: project !== null && project === current,
			items: list,
		}))
		.sort((a, b) => rank(a.project) - rank(b.project));
}

const IMAGE_TAG = /\[图片:\s*([^\]]+?)\s*\]/g;

/** Image paths attached to an item: `image` refs plus inline `[图片: path]` tags, deduped. */
export function ideaImages(item: BacklogItem): string[] {
	const out = item.refs.flatMap((r) => (r.kind === "image" && r.path ? [r.path] : []));
	for (const m of item.text.matchAll(IMAGE_TAG)) out.push(m[1]);
	return [...new Set(out)];
}

/** Append `text` to an existing composer draft on a new line, never overwriting it. */
export function appendToDraft(existing: string, text: string): string {
	return existing.trim().length > 0 ? `${existing.trimEnd()}\n${text}` : text;
}

const KIND_TAG: Record<BacklogItem["kind"], string> = { bug: "缺陷", idea: "想法" };

/** Plain-language header + numbered list of items, each prefixed with its type tag. */
export function buildBatchFillText(items: ReadonlyArray<{ kind: BacklogItem["kind"]; body: string }>): string {
	const lines = items.map((it, i) => {
		const prefix = `${i + 1}. 【${KIND_TAG[it.kind]}】`;
		const [first, ...rest] = it.body.trim().split("\n");
		// Continuation lines are indented under the number so the list stays readable.
		return [prefix + first, ...rest.map((l) => (l.length > 0 ? `   ${l}` : l))].join("\n");
	});
	return `以下是 ${items.length} 个待处理问题（缺陷/想法），请逐条处理：\n\n${lines.join("\n")}`;
}

/** Minute precision: today "HH:mm", this year "MM-DD HH:mm", older "YYYY-MM-DD HH:mm". */
export function formatAddedTime(iso: string, now: Date = new Date()): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const p = (n: number) => String(n).padStart(2, "0");
	const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
	const md = `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
	if (d.getFullYear() !== now.getFullYear()) return `${d.getFullYear()}-${md} ${hm}`;
	const sameDay = d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
	return sameDay ? hm : `${md} ${hm}`;
}

const SESSION_OPTION_SNIPPET_LENGTH = 40;

/** Concise label for a session option, preferring recent context over generated titles. */
export function sessionOptionLabel(meta: SessionMeta): string {
	const title = meta.title.trim();
	const genericPrefix = /^(?:会话|Session)\s+(.+)$/.exec(title)?.[1];
	const isGenericTitle = title === meta.id || (genericPrefix !== undefined && meta.id.startsWith(genericPrefix));
	const snippet = meta.lastAssistant?.trim().replace(/\s+/g, " ");
	let displayTitle: string;

	if (isGenericTitle && snippet) {
		displayTitle = snippet.length > SESSION_OPTION_SNIPPET_LENGTH
			? `${snippet.slice(0, SESSION_OPTION_SNIPPET_LENGTH - 1).trimEnd()}…`
			: snippet;
	} else {
		displayTitle = title && title !== meta.id ? title : tNow("backlog.sessionPrefix", { id: meta.id.slice(0, 8) });
	}

	const label = meta.label.trim();
	return `${label ? `[${label}] ` : ""}${displayTitle}`;
}

/** Picker value meaning "file under no project" (stored projectDir = null). */
export const CAPTURE_PROJECT_NONE = "";

/**
 * Project dir a new idea is filed under. `pick` null follows the current session's
 * project; `CAPTURE_PROJECT_NONE` files it under no project; any other value is that dir.
 */
export function resolveCaptureProject(pick: string | null, currentProject: string | null): string | null {
	if (pick === null) return currentProject;
	return pick === CAPTURE_PROJECT_NONE ? null : pick;
}

/** Last path segment of a project dir, for display. */
export function projectDisplayName(dir: string): string {
	return dir.split("/").filter(Boolean).pop() ?? dir;
}

export interface CaptureProjectOption {
	path: string;
	name: string;
}

/** Real project workspaces, deduped by path (one dir can be a project in several modes). */
export function captureProjectOptions(workspaces: Workspace[]): CaptureProjectOption[] {
	const seen = new Set<string>();
	const out: CaptureProjectOption[] = [];
	for (const w of workspaces) {
		if (w.kind !== "project" || seen.has(w.path)) continue;
		seen.add(w.path);
		out.push({ path: w.path, name: w.name || projectDisplayName(w.path) });
	}
	return out.sort((a, b) => a.name.localeCompare(b.name));
}
