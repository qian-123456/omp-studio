// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../core/api";
import { nav } from "../../core/nav";
import { TodosPane } from "./TodosPane";
import { useTodos, type Todo } from "./todos";

vi.mock("../../core/api", () => ({
	api: vi.fn(),
	errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock("../../core/nav", () => ({
	nav: { push: vi.fn() },
	paths: { chat: (id: string) => `/s/${id}` },
}));
vi.mock("../../core/stores/sessions", () => ({
	useSessions: (selector: (state: { byId: Record<string, never> }) => unknown) => selector({ byId: {} }),
}));

beforeEach(() => {
	vi.resetAllMocks();
	useTodos.setState({ todos: [], loaded: false, loading: false, error: null });
});

afterEach(() => {
	cleanup();
});

describe("TodosPane recovery", () => {
	it("announces an initial load failure with no items and retries successfully", async () => {
		vi.mocked(api).mockRejectedValueOnce(new Error("连接已断开"));
		render(<TodosPane />);
		expect(screen.getByRole("status").textContent).toBe("正在加载待办");
		await act(async () => {
			await useTodos.getState().load();
		});
		expect(screen.getByRole("alert").textContent).toContain("待办加载失败：连接已断开");
		expect(screen.queryByRole("status")).toBeNull();

		const todo: Todo = { id: "recovered", kind: "review", status: "open", title: "恢复后的待办" };
		// The mobile project's ES2021 library target does not expose Promise.withResolvers.
		let resolve!: (todos: Todo[]) => void;
		const pending = new Promise<Todo[]>((done) => { resolve = done; });
		vi.mocked(api).mockReturnValueOnce(pending);
		const retry = screen.getByRole("button", { name: "重试加载待办" }) as HTMLButtonElement;
		fireEvent.click(retry);
		expect(retry.disabled).toBe(true);
		expect(retry.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("alert").textContent).toContain("连接已断开");
		await act(async () => { resolve([todo]); });
		expect(screen.getByText(todo.title)).not.toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
		expect(api).toHaveBeenCalledTimes(2);
	});

	it("clears the error when retry confirms there are no todos", async () => {
		useTodos.setState({ loaded: true, error: "加载失败" });
		vi.mocked(api).mockResolvedValueOnce([]);
		render(<TodosPane />);
		fireEvent.click(screen.getByRole("button", { name: "重试加载待办" }));
		await waitFor(() => {
			expect(screen.queryByRole("alert")).toBeNull();
			expect(screen.queryByRole("region", { name: "待办" })).toBeNull();
		});
		expect(useTodos.getState()).toMatchObject({ loaded: true, loading: false, error: null, todos: [] });
	});

	it.each(["input", "editor"])("keeps a pending %s request open without offering generic completion", (method) => {
		const todo: Todo = {
			id: "pending", kind: "question", status: "open", title: "请补充内容", sessionId: "session",
			payload: { uiRequest: { id: "request", method } },
		};
		useTodos.setState({ loaded: true, todos: [todo] });
		render(<TodosPane />);
		expect(screen.queryByRole("button", { name: "完成" })).toBeNull();
		expect(screen.queryByRole("button", { name: "批准" })).toBeNull();
		expect(screen.queryByRole("button", { name: "拒绝" })).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "打开会话" }));
		expect(nav.push).toHaveBeenCalledWith("/s/session");
		expect(api).not.toHaveBeenCalled();
		expect(useTodos.getState().todos).toEqual([todo]);
	});

	it.each(["完成", "忽略", "批准"])("unlocks %s after an accepted action leaves a stale item on refresh failure", async (label) => {
		const todo: Todo = { id: "stale", kind: "review", status: "open", title: "待刷新事项", sessionId: "session" };
		if (label === "批准") todo.payload = { uiRequest: { id: "request", method: "confirm" } };
		useTodos.setState({ loaded: true, todos: [todo] });
		vi.mocked(api).mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error("刷新失败"));
		render(<TodosPane />);
		const button = screen.getByRole("button", { name: label }) as HTMLButtonElement;
		fireEvent.click(button);
		expect(button.disabled).toBe(true);
		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toContain("刷新失败");
			expect(button.disabled).toBe(false);
		});
		expect(button.getAttribute("aria-busy")).toBeNull();
		expect(screen.getByText(todo.title)).not.toBeNull();
		expect((screen.getByRole("button", { name: "忽略" }) as HTMLButtonElement).disabled).toBe(false);
		expect(screen.getByRole("button", { name: "打开会话" })).not.toBeNull();
	});
});
