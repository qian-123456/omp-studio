import type { BacklogItem, SessionMeta, SessionStatus } from "../../lib/contracts";

/**
 * Split backlog items for the 「想法」 dropdown. `active` = not done/closed,
 * items captured in `currentProject` first, then newest first; `finished`
 * = done/closed, newest first.
 */
export function partitionIdeas(
	items: BacklogItem[],
	currentProject: string | null,
): { active: BacklogItem[]; finished: BacklogItem[] } {
	const newestFirst = (a: BacklogItem, b: BacklogItem) =>
		b.updatedAt.localeCompare(a.updatedAt);
	const active = items.filter((i) => i.status === "inbox" || i.status === "dispatched");
	const finished = items
		.filter((i) => i.status === "done" || i.status === "closed")
		.sort(newestFirst);
	active.sort((a, b) => {
		const aHere = currentProject !== null && a.projectDir === currentProject;
		const bHere = currentProject !== null && b.projectDir === currentProject;
		if (aHere !== bHere) return aHere ? -1 : 1;
		return newestFirst(a, b);
	});
	return { active, finished };
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
