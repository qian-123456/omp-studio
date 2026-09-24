/** [D] Todo queue store: list + counts, refreshed on `todos:changed`. */

import { create } from "zustand";
import type { Todo, TodoCounts } from "../../lib/contracts";
import { onTodosChanged } from "../../lib/events";
import { todosAct, todosCounts, todosList } from "../../lib/ipc";

export interface TodosState {
	todos: Todo[];
	counts: TodoCounts;
	loaded: boolean;
	error: string | null;
	refresh(): Promise<void>;
	act(id: string, action: "done" | "ignore"): Promise<void>;
}

export const useTodos = create<TodosState>((set, get) => ({
	todos: [],
	counts: { open: 0, total: 0 },
	loaded: false,
	error: null,
	refresh: async () => {
		try {
			const [todos, counts] = await Promise.all([
				todosList(true),
				todosCounts(),
			]);
			set({ todos, counts, loaded: true, error: null });
		} catch (e) {
			set({ loaded: true, error: String(e) });
		}
	},
	act: async (id, action) => {
		await todosAct(id, action);
		await get().refresh();
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
