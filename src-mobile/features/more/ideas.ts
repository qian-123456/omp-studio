import { baseName } from "../../core/lib/format";

export type IdeaKind = "idea" | "bug";
export type IdeaStatus = "inbox" | "dispatched" | "done" | "closed";
export type IdeaTab = "active" | "done" | "all";

export interface IdeaRef {
	kind: string;
	sessionId?: string | null;
	path?: string | null;
	text?: string | null;
}

export interface Idea {
	id: string;
	text: string;
	kind: IdeaKind;
	refs: IdeaRef[];
	status: IdeaStatus;
	targetSessionId: string | null;
	projectDir: string | null;
	createdAt: string;
	updatedAt: string;
}

export const KIND_LABEL: Record<IdeaKind, string> = { idea: "想法", bug: "Bug" };
export const STATUS_LABEL: Record<IdeaStatus, string> = { inbox: "待处理", dispatched: "已派发", done: "已完成", closed: "已关闭" };

export const isActive = (it: Pick<Idea, "status">): boolean => it.status === "inbox" || it.status === "dispatched";

export function filterIdeas(items: Idea[], tab: IdeaTab): Idea[] {
	if (tab === "all") return items;
	return items.filter((it) => (tab === "active" ? isActive(it) : !isActive(it)));
}

export function tabCounts(items: Idea[]): Record<IdeaTab, number> {
	const active = items.filter(isActive).length;
	return { active, done: items.length - active, all: items.length };
}

export const sessionRefs = (it: Idea): IdeaRef[] => it.refs.filter((r) => r.kind === "session" && r.sessionId);
export const imageRefs = (it: Idea): IdeaRef[] => it.refs.filter((r) => r.kind === "image" && r.path);

export interface IdeaGroup {
	dir: string;
	label: string;
	current: boolean;
	items: Idea[];
}

/** Group by project: the current project first, other projects by name, global ("") last. */
export function groupIdeas(items: Idea[], currentDir: string | null): IdeaGroup[] {
	const by = new Map<string, Idea[]>();
	for (const it of items) {
		const k = it.projectDir || "";
		const list = by.get(k);
		if (list) list.push(it);
		else by.set(k, [it]);
	}
	const cur = currentDir || "";
	const rank = (k: string): number => (k && k === cur ? 0 : k === "" ? 2 : 1);
	return [...by.keys()]
		.sort((a, b) => rank(a) - rank(b) || baseName(a).localeCompare(baseName(b)))
		.map((dir) => ({ dir, label: dir ? baseName(dir) : "全局", current: !!dir && dir === cur, items: by.get(dir) ?? [] }));
}

/** Body of `POST /ideas`; images are already-uploaded server paths. */
export function buildCreatePayload(input: {
	text: string;
	kind: IdeaKind;
	imagePaths: string[];
	projectDir?: string;
	linkSessionId?: string | null;
}): Record<string, unknown> {
	const body: Record<string, unknown> = { text: input.text.trim(), kind: input.kind, imagePaths: input.imagePaths };
	if (input.projectDir) body.projectDir = input.projectDir;
	if (input.linkSessionId) body.sessionIds = [input.linkSessionId];
	return body;
}

/** Why the capture form cannot be submitted, or null. */
export function captureError(text: string, imageCount: number): string | null {
	return text.trim() || imageCount ? null : "请输入内容或添加图片";
}

/** Body of a PATCH: only fields that changed. */
export function buildEditPatch(it: Idea, text: string, kind: IdeaKind): Record<string, unknown> {
	const p: Record<string, unknown> = {};
	const t = text.trim();
	if (t !== it.text) p.text = t;
	if (kind !== it.kind) p.kind = kind;
	return p;
}

/** Request for dispatching to a new (sessionId "") or existing session. Single → /ideas/{id}/dispatch, many → /ideas/dispatch. */
export function buildDispatch(
	ids: string[],
	sessionId: string,
	cwd: string | null,
): { path: string; body: Record<string, unknown> } {
	const target: Record<string, unknown> = sessionId ? { sessionId } : cwd ? { cwd } : {};
	if (ids.length > 1) return { path: "/ideas/dispatch", body: { ids, ...target } };
	return { path: `/ideas/${encodeURIComponent(ids[0] ?? "")}/dispatch`, body: target };
}

/** Replace items by id with the server's updated copies. */
export function mergeItems(items: Idea[], updated: Idea[]): Idea[] {
	const by = new Map(updated.map((u) => [u.id, u]));
	return items.map((it) => by.get(it.id) ?? it);
}

/** The project dir shared by every selected idea (the cwd for a new dispatch session); null when they differ or are global. */
export function commonProjectDir(items: Idea[], ids: string[]): string | null {
	const dirs = new Set(items.filter((it) => ids.includes(it.id)).map((it) => it.projectDir || ""));
	if (dirs.size !== 1) return null;
	const [only] = [...dirs];
	return only || null;
}
