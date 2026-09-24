/** [D] Pure helpers for the todo queue (unit-tested). */

import type { Todo, TodoKind } from "../../lib/contracts";
import type { SubagentInfo } from "../../stores/live";

export const KIND_LABEL: Record<TodoKind, string> = {
	approval: "待审批",
	question: "提问",
	error: "报错",
	interrupted: "中断",
	review: "待验收",
	suggestion: "监工建议",
	service_left: "服务残留",
};

export const KIND_COLOR: Record<TodoKind, string> = {
	approval: "bg-yellow-500/15 text-yellow-300",
	question: "bg-sky-500/15 text-sky-300",
	error: "bg-red-500/15 text-red-300",
	interrupted: "bg-rose-500/10 text-rose-300",
	review: "bg-orange-500/15 text-orange-300",
	suggestion: "bg-violet-500/15 text-violet-300",
	service_left: "bg-teal-500/15 text-teal-300",
};

/** Open todos by priority desc then age (FIFO); closed ones newest first. */
export function splitTodos(
	todos: Todo[],
	sessionId?: string | null,
): { open: Todo[]; closed: Todo[] } {
	const scoped =
		sessionId === undefined
			? todos
			: todos.filter((t) => t.sessionId === sessionId);
	const open = scoped
		.filter((t) => t.status === "open")
		.sort(
			(a, b) =>
				b.priority - a.priority || a.createdAt.localeCompare(b.createdAt),
		);
	const closed = scoped
		.filter((t) => t.status !== "open")
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return { open, closed };
}

/** Raw extension_ui_request carried by approval/question todos. */
export interface UiRequest {
	id: string;
	method: string;
	title?: string;
	message?: string;
	options?: string[];
	optionDetails?: { description?: string }[];
	placeholder?: string;
	prefill?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

export function uiRequestOf(todo: Todo): UiRequest | null {
	if (!isRecord(todo.payload)) return null;
	const req = todo.payload.uiRequest;
	if (!isRecord(req) || typeof req.id !== "string") return null;
	return req as unknown as UiRequest;
}

export type UiAnswer =
	| { value: string }
	| { confirmed: boolean }
	| { cancelled: true };

export function buildUiResponse(request: UiRequest, answer: UiAnswer) {
	return { type: "extension_ui_response", id: request.id, ...answer };
}

export interface DispatchAction {
	type: "dispatch_backlog";
	backlogId: string;
	targetSessionId: string;
}

export function suggestionAction(todo: Todo): DispatchAction | null {
	if (!isRecord(todo.payload)) return null;
	const a = todo.payload.action;
	if (
		isRecord(a) &&
		a.type === "dispatch_backlog" &&
		typeof a.backlogId === "string" &&
		typeof a.targetSessionId === "string"
	) {
		return a as unknown as DispatchAction;
	}
	return null;
}

export function servicePid(todo: Todo): number | null {
	if (!isRecord(todo.payload)) return null;
	return typeof todo.payload.pid === "number" ? todo.payload.pid : null;
}

export interface SubagentCounts {
	running: number;
	done: number;
	failed: number;
}

/** Bucket subagent statuses (free-form strings from RPC frames). */
export function subagentBucket(status: string): keyof SubagentCounts {
	const s = status.toLowerCase();
	if (/(fail|error|abort|cancel|kill)/.test(s)) return "failed";
	if (/(done|complete|finish|success|succeed|exit|end)/.test(s)) return "done";
	return "running";
}

export function subagentCounts(
	subagents: Record<string, SubagentInfo>,
): SubagentCounts {
	const c: SubagentCounts = { running: 0, done: 0, failed: 0 };
	for (const s of Object.values(subagents)) c[subagentBucket(String(s.status ?? ""))] += 1;
	return c;
}
