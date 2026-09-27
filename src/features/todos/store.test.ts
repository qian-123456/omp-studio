import { beforeEach, describe, expect, it, vi } from "vitest";
import { startTodos, stopTodos, useTodos } from "./store";

const mockUnlisten = vi.fn();
const mockOnTodosChanged = vi.fn();

vi.mock("../../lib/events", () => ({
	onTodosChanged: (...args: unknown[]) => mockOnTodosChanged(...args),
}));

vi.mock("../../lib/ipc", () => ({
	todosList: vi.fn().mockResolvedValue([]),
	todosCounts: vi.fn().mockResolvedValue({ open: 0, total: 0 }),
	todosAct: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/toast", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

describe("todos store listener lifecycle", () => {
	beforeEach(async () => {
		await stopTodos();
		vi.clearAllMocks();
		mockOnTodosChanged.mockResolvedValue(mockUnlisten);
	});

	it("startTodos subscribes to onTodosChanged and calls refresh", async () => {
		const refreshSpy = vi.spyOn(useTodos.getState(), "refresh");
		await startTodos();

		expect(mockOnTodosChanged).toHaveBeenCalledTimes(1);
		expect(refreshSpy).toHaveBeenCalled();
	});

	it("startTodos is idempotent when already subscribed", async () => {
		await startTodos();
		await startTodos();

		expect(mockOnTodosChanged).toHaveBeenCalledTimes(1);
	});

	it("stopTodos unlistens the active listener", async () => {
		await startTodos();
		expect(mockUnlisten).not.toHaveBeenCalled();

		await stopTodos();
		expect(mockUnlisten).toHaveBeenCalledTimes(1);

		// Can start again after stop
		await startTodos();
		expect(mockOnTodosChanged).toHaveBeenCalledTimes(2);
	});
});
