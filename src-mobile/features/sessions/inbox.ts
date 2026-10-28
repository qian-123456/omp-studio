/** `GET /left/inbox` shape and the pure helpers behind the inbox page and the drawer badge. */
import { openTodos, type Todo } from "./todos";
import type { TreeSession } from "./tree";

export type InboxKey = "awaiting" | "error" | "unread" | "running";
export type InboxData = Partial<Record<InboxKey, TreeSession[]>> & { order?: string[] };

export const INBOX_TITLES: Record<string, string> = { awaiting: "待回复", error: "中断或出错", unread: "未读", running: "运行中" };
const DEFAULT_ORDER = ["awaiting", "error", "unread", "running"];
/** Sections that ask the user for something (running sessions are informational). */
const ACTIONABLE: readonly InboxKey[] = ["awaiting", "error", "unread"];

/** Sections to show, in server order, skipping empty ones. */
export function inboxSections(d: InboxData): { key: string; items: TreeSession[] }[] {
	return (d.order?.length ? d.order : DEFAULT_ORDER)
		.map((key) => ({ key, items: d[key as InboxKey] ?? [] }))
		.filter((s) => s.items.length > 0);
}

/**
 * Badge count of the drawer's 收件箱 entry: distinct sessions that need the user (待回复 / 出错 / 未读) plus open
 * todos that do not already point at one of those sessions.
 */
export function inboxCount(d: InboxData | null, todos: readonly Todo[]): number {
	const ids = new Set<string>();
	for (const k of ACTIONABLE) for (const s of d?.[k] ?? []) ids.add(s.id);
	const extra = openTodos(todos).filter((t) => !t.sessionId || !ids.has(t.sessionId)).length;
	return ids.size + extra;
}
