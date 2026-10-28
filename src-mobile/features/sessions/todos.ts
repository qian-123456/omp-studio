import { create } from "zustand";
import { api, errorMessage } from "../../core/api";
import { events } from "../../core/sse";
import { toast } from "../../ui";

export interface Todo {
	id: string;
	kind: string;
	status: string;
	sessionId?: string | null;
	title: string;
	detail?: string;
	payload?: { uiRequest?: UiRequest } | null;
	priority?: number;
	createdAt?: string;
}

export interface UiRequest {
	id?: string;
	method?: string;
	type?: string;
	options?: unknown[];
	choices?: unknown[];
	[k: string]: unknown;
}

export const KIND_LABEL: Record<string, string> = {
	approval: "批准",
	question: "问题",
	error: "错误",
	interrupted: "中断",
	review: "验收",
	suggestion: "建议",
	service_left: "服务",
	schedule_run: "定时任务",
};

export interface TodoChoice {
	id: string;
	label: string;
	primary: boolean;
}

const APPROVE_RE = /approve|批准|允许/i;

/**
 * Quick-answer buttons of a todo that carries a pending UI request. Options come from the request itself;
 * a bare approval (no options) offers 批准 / 拒绝. Free-text requests (input/editor) cannot be answered here →
 * `null` (the card then offers 打开会话).
 */
export function todoChoices(t: Pick<Todo, "sessionId" | "payload">): TodoChoice[] | null {
	const req = t.payload?.uiRequest;
	if (!t.sessionId || !req || !req.id) return null;
	const raw = req.options ?? req.choices;
	if (Array.isArray(raw) && raw.length > 0) {
		const out = raw.map((o) => {
			if (typeof o === "string") return { id: o, label: o };
			const r = (o ?? {}) as Record<string, unknown>;
			const id = String(r.id ?? r.value ?? r.label ?? "");
			return { id, label: String(r.label ?? r.id ?? r.value ?? "") };
		});
		return out.map((o) => ({ ...o, primary: APPROVE_RE.test(o.id + o.label) }));
	}
	const method = String(req.method ?? req.type ?? "");
	if (method === "input" || method === "editor") return null;
	return [
		{ id: "Approve", label: "批准", primary: true },
		{ id: "Deny", label: "拒绝", primary: false },
	];
}

export const openTodos = (todos: readonly Todo[]): Todo[] => todos.filter((t) => t.status === "open");

interface TodosState {
	todos: Todo[];
	loaded: boolean;
	loading: boolean;
	error: string | null;
	load: () => Promise<void>;
	act: (id: string, action: "done" | "ignore") => Promise<boolean>;
	respond: (t: Todo, choice: TodoChoice) => Promise<boolean>;
}

let lastOpen = -1;

/** Vibrate / notify when the open count grows (old `notifyNewTodos`). */
function notifyNew(todos: Todo[]): void {
	const open = openTodos(todos);
	if (lastOpen >= 0 && open.length > lastOpen) {
		if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(200);
		if (typeof Notification !== "undefined" && Notification.permission === "granted") {
			new Notification("新的待办", { body: open[0]?.title ?? "" });
		}
	}
	lastOpen = open.length;
}

export const useTodos = create<TodosState>((set, get) => ({
	todos: [],
	loaded: false,
	loading: false,
	error: null,
	load: async () => {
		set({ loading: true });
		try {
			const todos = await api<Todo[]>("GET", "/todos");
			const list = Array.isArray(todos) ? todos : [];
			set({ todos: list, loaded: true, loading: false, error: null });
			notifyNew(list);
		} catch (e) {
			set({ loaded: true, loading: false, error: errorMessage(e) });
		}
	},
	act: async (id, action) => {
		try {
			await api("POST", `/todos/${encodeURIComponent(id)}/act`, { action });
			await get().load();
			return true;
		} catch (e) {
			toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
			return false;
		}
	},
	respond: async (t, choice) => {
		const req = t.payload?.uiRequest;
		if (!t.sessionId || !req?.id) return false;
		try {
			await api("POST", `/sessions/${encodeURIComponent(t.sessionId)}/ui-respond`, {
				response: { id: req.id, type: "extension_ui_response", value: choice.id },
			});
			await get().load();
			return true;
		} catch (e) {
			toast(`操作失败：${errorMessage(e)}`, { kind: "error" });
			return false;
		}
	},
}));

let refs = 0;
let off: (() => void) | null = null;

/** Keep todos fresh from SSE while the home page is mounted (ref-counted). */
export function startTodosSync(): () => void {
	if (refs++ === 0) {
		const reload = () => void useTodos.getState().load();
		reload();
		const offs = [events.on("todos", reload), events.on("resync", reload), events.on("hello", reload)];
		off = () => offs.forEach((o) => o());
	}
	let done = false;
	return () => {
		if (done) return;
		done = true;
		if (--refs === 0) {
			off?.();
			off = null;
		}
	};
}
