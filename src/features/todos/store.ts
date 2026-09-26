/** [D] Todo queue store: list + counts, refreshed on `todos:changed`. */

import { create } from "zustand";
import type { Todo, TodoCounts } from "../../lib/contracts";
import { onTodosChanged } from "../../lib/events";
import { todosAct, todosCounts, todosList } from "../../lib/ipc";
import { toast } from "../../lib/toast";

export interface IgnoredTodoRef {
	id: string;
	title: string;
}

export interface TodosState {
	todos: Todo[];
	counts: TodoCounts;
	loaded: boolean;
	error: string | null;
	lastIgnored: IgnoredTodoRef | null;
	refresh(): Promise<void>;
	act(id: string, action: "done" | "ignore" | "reopen"): Promise<void>;
	reopen(id: string): Promise<void>;
	undoIgnore(): Promise<void>;
	clearLastIgnored(): void;
}

let lastIgnoredTimer: number | undefined;
export const useTodos = create<TodosState>((set, get) => ({
	todos: [],
	counts: { open: 0, total: 0 },
	loaded: false,
	error: null,
	lastIgnored: null,
	refresh: async () => {
		try {
			const [todos, counts] = await Promise.all([
				todosList(true),
				todosCounts(),
			]);
			set({
				todos,
				counts,
				loaded: true,
				error: null,
			});
		} catch (e) {
			set({ loaded: true, error: String(e) });
		}
	},
	act: async (id, action) => {
		const target = get().todos.find((t) => t.id === id);
		await todosAct(id, action);
		if (action === "ignore" && target) {
			clearTimeout(lastIgnoredTimer);
			set({ lastIgnored: { id, title: target.title } });
			lastIgnoredTimer = window.setTimeout(() => {
				set({ lastIgnored: null });
				lastIgnoredTimer = undefined;
			}, 5000);
		}
		await get().refresh();
	},
	reopen: async (id) => {
		await todosAct(id, "reopen");
		if (get().lastIgnored?.id === id) {
			clearTimeout(lastIgnoredTimer);
			set({ lastIgnored: null });
		}
		await get().refresh();
		toast.success("已重新打开待办");
	},
	undoIgnore: async () => {
		const last = get().lastIgnored;
		if (!last) return;
		clearTimeout(lastIgnoredTimer);
		set({ lastIgnored: null });
		await get().reopen(last.id);
	},
	clearLastIgnored: () => {
		clearTimeout(lastIgnoredTimer);
		set({ lastIgnored: null });
	},
}));

let started = false;

/** Initial load + subscribe to `todos:changed` (idempotent). */
export function startTodos(): void {
	if (started) return;
	started = true;
	void useTodos.getState().refresh();
	void onTodosChanged((counts) => {
		useTodos.setState({ counts });
		void useTodos.getState().refresh();
	});
}
