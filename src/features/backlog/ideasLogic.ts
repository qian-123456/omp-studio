import type { BacklogItem, SessionMeta, SessionStatus, Workspace } from "../../lib/contracts";
import { repoRootFromWorktree } from "../git/helpers";

/** Repo root for a project dir so all worktrees of one repo share a project. */
export function projectRoot(dir: string | null | undefined): string | null {
	return dir ? repoRootFromWorktree(dir) : null;
}

/** Newest captured first; falls back to updatedAt for legacy items. */
export const byCreatedDesc = (a: BacklogItem, b: BacklogItem) =>
	(b.createdAt || b.updatedAt).localeCompare(a.createdAt || a.updatedAt);

export type IdeaPhase = "pending" | "running" | "review" | "finished";

/**
 * Determine the phase of a backlog item.
 * inbox → pending; done|closed → finished;
 * dispatched → running when the linked session exists, is not archived,
 * and status ∈ {working, awaiting_approval, awaiting_answer};
 * every other dispatched case → review.
 */
export function ideaPhase(item: BacklogItem, session: SessionMeta | undefined): IdeaPhase {
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

/** Each bucket newest-created first (createdAt, falling back to updatedAt). */
export function partitionByPhase(
	items: BacklogItem[],
	sessions: Record<string, SessionMeta>,
): Record<IdeaPhase, BacklogItem[]> {
	const buckets: Record<IdeaPhase, BacklogItem[]> = {
		pending: [],
		running: [],
		review: [],
		finished: [],
	};
	for (const it of items) {
		const session = it.targetSessionId ? sessions[it.targetSessionId] : undefined;
		buckets[ideaPhase(it, session)].push(it);
	}
	for (const phase of Object.keys(buckets) as IdeaPhase[]) {
		buckets[phase].sort(byCreatedDesc);
	}
	return buckets;
}

/** pending + review count; drives the top-bar badge. */
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

export type IdeasScope = "all" | "current";

/** Items visible under `scope`; "current" keeps items of the current project's repo (any worktree). */
export function filterIdeas(
	items: BacklogItem[],
	scope: IdeasScope,
	currentProject: string | null,
): BacklogItem[] {
	if (scope !== "current") return items;
	const root = projectRoot(currentProject);
	return root === null ? [] : items.filter((i) => projectRoot(i.projectDir) === root);
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
			label: project === null ? "未关联项目" : (project.split("/").filter(Boolean).pop() ?? project),
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

const KIND_TAG: Record<BacklogItem["kind"], string> = { bug: "缺陷", todo: "待办", idea: "想法" };

/** Plain-language header + numbered list of items, each prefixed with its type tag. */
export function buildBatchFillText(items: ReadonlyArray<{ kind: BacklogItem["kind"]; body: string }>): string {
	const lines = items.map((it, i) => {
		const prefix = `${i + 1}. 【${KIND_TAG[it.kind]}】`;
		const [first, ...rest] = it.body.trim().split("\n");
		// Continuation lines are indented under the number so the list stays readable.
		return [prefix + first, ...rest.map((l) => (l.length > 0 ? `   ${l}` : l))].join("\n");
	});
	return `以下是 ${items.length} 个待处理问题（缺陷/待办/想法），请逐条处理：\n\n${lines.join("\n")}`;
}

/** "刚刚" / "N分钟前" / "N小时前" within a day, else "MM-DD HH:mm". */
export function formatAddedTime(iso: string, now: Date = new Date()): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return "";
	const mins = Math.floor((now.getTime() - d.getTime()) / 60000);
	if (mins >= 0 && mins < 1) return "刚刚";
	if (mins >= 0 && mins < 60) return `${mins}分钟前`;
	if (mins >= 0 && mins < 24 * 60) return `${Math.floor(mins / 60)}小时前`;
	const p = (n: number) => String(n).padStart(2, "0");
	return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_LABEL: Record<SessionStatus, string> = {
	working: "运行中",
	awaiting_approval: "待批准",
	awaiting_answer: "待回答",
	review: "待验收",
	idle: "空闲",
	error: "报错",
	interrupted: "已中断",
	suspended: "已挂起",
	external: "外部",
};

const SESSION_OPTION_SNIPPET_LENGTH = 40;

/** Concise label for a session option, preferring recent context over generated titles. */
export function sessionOptionLabel(meta: SessionMeta): string {
	const title = meta.title.trim();
	const genericPrefix = /^会话\s+(.+)$/.exec(title)?.[1];
	const isGenericTitle = title === meta.id || (genericPrefix !== undefined && meta.id.startsWith(genericPrefix));
	const snippet = meta.lastAssistant?.trim().replace(/\s+/g, " ");
	let displayTitle: string;

	if (isGenericTitle && snippet) {
		displayTitle = snippet.length > SESSION_OPTION_SNIPPET_LENGTH
			? `${snippet.slice(0, SESSION_OPTION_SNIPPET_LENGTH - 1).trimEnd()}…`
			: snippet;
	} else {
		displayTitle = title && title !== meta.id ? title : `会话 ${meta.id.slice(0, 8)}`;
	}

	const label = meta.label.trim();
	return `${label ? `[${label}] ` : ""}${displayTitle}`;
}

/** Live status text for a dispatched item's linked session. */
export function linkedSessionStatus(meta: SessionMeta | undefined): string {
	if (!meta) return "会话不存在";
	if (meta.archived) return "已归档";
	return STATUS_LABEL[meta.status] ?? meta.status;
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
