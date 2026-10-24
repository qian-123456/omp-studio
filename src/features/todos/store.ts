/** [D] Todo queue store: list + counts, refreshed on `todos:changed`. */

import { create } from "zustand";
import type { Todo, TodoCounts } from "../../lib/contracts";
import { onTodosChanged } from "../../lib/events";
import { todosAct, todosCounts, todosList } from "../../lib/ipc";
import { toast } from "../../lib/toast";
import { tNow } from "../../stores/language";

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
			const openCount = todos.filter((t) => t.status === "open").length;
			set({
				todos,
				counts: { open: openCount, total: counts.total },
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
		toast.success(tNow("sessions.reopenedTodo"));
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

let startTodosPromise: Promise<void> | null = null;
let activeUnlisten: (() => void) | null = null;

/** Initial load + subscribe to `todos:changed` (idempotent). */
export async function startTodos(): Promise<void> {
	if (activeUnlisten) return;
	if (startTodosPromise) return startTodosPromise;

	void useTodos.getState().refresh();

	startTodosPromise = (async () => {
		try {
			const unlisten = await onTodosChanged(() => {
				void useTodos.getState().refresh();
			});
			if (startTodosPromise === null) {
				// stopTodos was called while start was in-flight
				try {
					unlisten();
				} catch {}
			} else {
				activeUnlisten = unlisten;
			}
		} catch (err) {
			console.error("Failed to subscribe to todos:changed", err);
		}
	})().finally(() => {
		startTodosPromise = null;
	});

	return startTodosPromise;
}

/** Stop active listeners and clean up; useful for tests and teardown. */
export async function stopTodos(): Promise<void> {
	if (startTodosPromise) {
		try {
			await startTodosPromise;
		} catch {
			// ignore failure of in-flight start
		}
	}
	if (activeUnlisten) {
		const un = activeUnlisten;
		activeUnlisten = null;
		try {
			un();
		} catch (err) {
			console.error("Failed to unlisten todos:changed", err);
		}
	}
}
