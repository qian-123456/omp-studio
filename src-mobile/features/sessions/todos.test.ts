import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../core/api";
import { branchChoice } from "./search";
import { todoChoices, useTodos, type Todo } from "./todos";

vi.mock("../../core/api", () => ({
	api: vi.fn(),
	errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock("../../ui", () => ({ toast: vi.fn() }));

beforeEach(() => {
	vi.resetAllMocks();
	useTodos.setState({ todos: [], loaded: false, loading: false, error: null });
});

describe("todo loading", () => {
	it("settles a failed initial load and clears its error after retry succeeds", async () => {
		vi.mocked(api).mockRejectedValueOnce(new Error("连接已断开"));
		const failed = useTodos.getState().load();
		expect(useTodos.getState()).toMatchObject({ loaded: false, loading: true, error: null });
		await expect(failed).resolves.toBeUndefined();
		expect(useTodos.getState()).toMatchObject({ todos: [], loaded: true, loading: false, error: "连接已断开" });

		const todo: Todo = { id: "t", kind: "review", status: "open", title: "需要验收" };
		vi.mocked(api).mockResolvedValueOnce([todo]);
		const retry = useTodos.getState().load();
		expect(useTodos.getState()).toMatchObject({ loaded: true, loading: true, error: "连接已断开" });
		await retry;
		expect(useTodos.getState()).toMatchObject({ todos: [todo], loaded: true, loading: false, error: null });
		expect(api).toHaveBeenNthCalledWith(1, "GET", "/todos");
		expect(api).toHaveBeenNthCalledWith(2, "GET", "/todos");
	});

	it("preserves previously loaded items when refresh fails", async () => {
		const todos: Todo[] = [{ id: "kept", kind: "review", status: "open", title: "保留待办" }];
		vi.mocked(api).mockResolvedValueOnce(todos);
		await useTodos.getState().load();
		vi.mocked(api).mockRejectedValueOnce(new Error("刷新失败"));
		const refresh = useTodos.getState().load();
		expect(useTodos.getState().todos).toBe(todos);
		await expect(refresh).resolves.toBeUndefined();
		expect(useTodos.getState()).toMatchObject({ todos, loaded: true, loading: false, error: "刷新失败" });
		expect(useTodos.getState().todos).toBe(todos);
	});

	it("keeps an accepted action successful when the following refresh fails", async () => {
		const todo: Todo = { id: "t", kind: "review", status: "open", title: "需要验收" };
		useTodos.setState({ todos: [todo], loaded: true });
		vi.mocked(api).mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error("刷新失败"));
		await expect(useTodos.getState().act(todo.id, "done")).resolves.toBe(true);
		expect(useTodos.getState()).toMatchObject({ todos: [todo], loading: false, error: "刷新失败" });
	});
});

describe("todoChoices", () => {
	it("uses the request's own options and marks approvals primary", () => {
		const c = todoChoices({ sessionId: "s", payload: { uiRequest: { id: "r", options: ["Allow once", { id: "d", label: "拒绝" }] } } });
		expect(c).toEqual([
			{ id: "Allow once", label: "Allow once", primary: false },
			{ id: "d", label: "拒绝", primary: false },
		]);
		expect(todoChoices({ sessionId: "s", payload: { uiRequest: { id: "r", choices: ["Approve"] } } })?.[0].primary).toBe(true);
	});

	it("a bare confirm offers 批准 / 拒绝; free-text requests and session-less todos offer none", () => {
		expect(todoChoices({ sessionId: "s", payload: { uiRequest: { id: "r", method: "confirm" } } })?.map((x) => x.label)).toEqual(["批准", "拒绝"]);
		expect(todoChoices({ sessionId: "s", payload: { uiRequest: { id: "r", method: "input" } } })).toBeNull();
		expect(todoChoices({ sessionId: "s", payload: { uiRequest: { id: "r", method: "editor" } } })).toBeNull();
		expect(todoChoices({ sessionId: null, payload: { uiRequest: { id: "r" } } })).toBeNull();
		expect(todoChoices({ sessionId: "s", payload: null })).toBeNull();
	});
});

describe("branchChoice", () => {
	it("opens a single hit directly and asks to choose among several, noting truncation", () => {
		expect(branchChoice({ branch: "main", count: 1, sessionIds: ["a"] })).toEqual({ kind: "open", id: "a" });
		expect(branchChoice({ branch: "main", count: 9, sessionIds: ["a", "b"] })).toEqual({
			kind: "choose",
			title: "main（共 9 个，列出 2 个）",
			ids: ["a", "b"],
		});
		expect(branchChoice({ branch: "dev", count: 2, sessionIds: ["a", "b"] })).toMatchObject({ title: "dev" });
	});
});
