import type { BacklogItem, SessionMeta, SessionStatus } from "../../lib/contracts";
import { repoRootFromWorktree } from "../git/helpers";

/** Repo root for a project dir so all worktrees of one repo share a project. */
export function projectRoot(dir: string | null | undefined): string | null {
	return dir ? repoRootFromWorktree(dir) : null;
}

/** Newest captured first; falls back to updatedAt for legacy items. */
export const byCreatedDesc = (a: BacklogItem, b: BacklogItem) =>
	(b.createdAt || b.updatedAt).localeCompare(a.createdAt || a.updatedAt);

/**
 * Split backlog items for the 「想法」 dropdown. `active` = not done/closed,
 * `finished` = done/closed; both strictly newest-created first.
 */
export function partitionIdeas(items: BacklogItem[]): { active: BacklogItem[]; finished: BacklogItem[] } {
	const active = items
		.filter((i) => i.status === "inbox" || i.status === "dispatched")
		.sort(byCreatedDesc);
	const finished = items
		.filter((i) => i.status === "done" || i.status === "closed")
		.sort(byCreatedDesc);
	return { active, finished };
}

export type IdeasFilter = "all" | "current" | "project";

/** Items visible under `filter`; "current" keeps items of the current project's repo (any worktree). */
export function filterIdeas(
	items: BacklogItem[],
	filter: IdeasFilter,
	currentProject: string | null,
): BacklogItem[] {
	if (filter !== "current") return items;
	const root = projectRoot(currentProject);
	return root === null ? [] : items.filter((i) => projectRoot(i.projectDir) === root);
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

/** Live status text for a dispatched item's linked session. */
export function linkedSessionStatus(meta: SessionMeta | undefined): string {
	if (!meta) return "会话不存在";
	if (meta.archived) return "已归档";
	return STATUS_LABEL[meta.status] ?? meta.status;
}
