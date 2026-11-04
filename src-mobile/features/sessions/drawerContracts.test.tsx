// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as MobileUi from "../../ui";
import type { Route } from "../../core/nav";

const apiMock = vi.fn();
const newSessionIn = vi.fn();
const toast = vi.fn();
vi.mock("../../core/api", () => ({ api: (...args: unknown[]) => apiMock(...args), errorMessage: (e: unknown) => String(e) }));
vi.mock("../../core/nav", () => ({ nav: { push: vi.fn(), back: vi.fn(), pushLayer: () => () => {} }, paths: { chat: (id: string) => `/s/${id}` } }));
vi.mock("../../core/stores/sessions", () => ({ useSessions: Object.assign((select: (s: { list: never[] }) => unknown) => select({ list: [] }), { getState: () => ({ list: [], refresh: vi.fn() }) }) }));
vi.mock("./actions", () => ({ newSessionIn: (...args: unknown[]) => newSessionIn(...args), addWorkspace: vi.fn(), assignToWorkspace: vi.fn(), batchArchive: vi.fn(), patchSession: vi.fn(), discardDraft: vi.fn() }));
vi.mock("../../ui", async (original) => ({ ...await original<typeof MobileUi>(), toast: (...args: unknown[]) => toast(...args) }));

import { PullToRefresh } from "../../ui/PullToRefresh";
import { SearchPage } from "./SearchPage";
import { useSessionActions } from "./ActionSheets";
import { SessionRow } from "./SessionRow";
import { patchSession } from "./actions";
import { TreeView } from "./TreeView";
import { useTree } from "./treeStore";
import { InboxPage } from "./InboxPage";
import { useTodos } from "./todos";
import type { SessionTree, TreeSession } from "./tree";

const session: TreeSession = { id: "s1", label: "#1", title: "完整的长会话标题，不应在没有展开入口时截断", status: "working", updatedAt: "2026-10-27T10:00:00Z", cwd: "/projects/a", live: true };
const tree: SessionTree = { pinned: [], globalGroup: null, workspaceGroups: [{ workspace: { id: "a", path: "/projects/a", name: "项目甲" }, isGlobal: false, totalCount: 1, subgroups: [{ key: "main", kind: "default", label: "main", deleted: false, sessions: [session], totalCount: 1 }], deletedSubgroups: [] }], unassignedGroups: [], deletedSessions: [], archived: [] };
const route: Route = { name: "search", path: "/search", params: {}, query: {} };

function rowPointer(target: Element, type: string, x: number, y: number) {
	const event = new Event(type, { bubbles: true, cancelable: true });
	Object.defineProperties(event, Object.fromEntries(Object.entries({ pointerId: 1, pointerType: "touch", isPrimary: true, button: 0, clientX: x, clientY: y }).map(([key, value]) => [key, { value }])));
	fireEvent(target, event);
}

function swipeRow(target: Element, x: number, y: number) {
	rowPointer(target, "pointerdown", 20, 20);
	rowPointer(target, "pointermove", x, y);
	rowPointer(target, "pointerup", x, y);
}

beforeEach(() => {
	vi.clearAllMocks();
	apiMock.mockResolvedValue({ dirs: [] });
	useTree.setState({ data: tree, error: null, mode: "code", open: {}, expanded: {} });
	useTodos.setState({ todos: [], loaded: false, loading: false, error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("drawer session contracts", () => {
	it("keeps session, project and worktree titles on one line while retaining complete names", () => {
		const longSession = { ...session, kind: "side" as const };
		const longProject = "项目甲非常长的名称用于验证单行显示而不影响完整信息";
		const longWorktree = "feature-very-long-worktree-name-with-more-details";
		useTree.setState({ data: { ...tree, workspaceGroups: [{ ...tree.workspaceGroups[0], workspace: { ...tree.workspaceGroups[0].workspace, name: longProject }, subgroups: [{ ...tree.workspaceGroups[0].subgroups[0], kind: "worktree", label: longWorktree, sessions: [longSession] }] }] } });
		render(<TreeView onMore={() => {}} />);
		for (const label of [longProject, longWorktree, longSession.title]) {
			const text = screen.getByText(label);
			expect(text.className).toContain("truncate");
			expect(text.closest("button")?.getAttribute("aria-label")).toContain(label);
		}
		const project = screen.getByRole("button", { name: `${longProject}，/projects/a` });
		fireEvent.contextMenu(project);
		expect(screen.getByRole("dialog").textContent).toContain(longProject);
	});

	it("shows collapsed status counts inline with accessible status descriptions", () => {
		const withStatuses = { ...tree, workspaceGroups: [{ ...tree.workspaceGroups[0], subgroups: [{ ...tree.workspaceGroups[0].subgroups[0], sessions: [
			{ ...session, id: "working", status: "working" },
			{ ...session, id: "awaiting", status: "awaiting_answer" },
			{ ...session, id: "error", status: "error" },
			{ ...session, id: "unread", status: "idle", unread: true },
		] }] }] } as SessionTree;
		useTree.setState({ data: withStatuses, open: { "w:a": false } });
		render(<TreeView onMore={() => {}} />);
		const header = screen.getByRole("button", { name: "项目甲，/projects/a" });
		expect(header.getAttribute("aria-expanded")).toBe("false");
		expect(header.getAttribute("aria-description")).toContain("1 运行中，1 待回复，1 出错，1 未读");
		const counts = header.querySelector('[aria-hidden="true"].flex-nowrap');
		expect(counts?.children).toHaveLength(4);
		expect(Array.from(counts!.children).map((node) => node.textContent)).toEqual(["1", "1", "1", "1"]);
		fireEvent.click(header);
		expect(header.querySelector('[aria-hidden="true"].flex-nowrap')).toBeNull();
	});

 it("exposes full titles to assistive technology and keyboard actions", () => {
  const more = vi.fn();
  const { rerender } = render(<SessionRow s={session} onMore={more} />);
  fireEvent.keyDown(screen.getByRole("button", { name: new RegExp(session.title) }), { key: "F10", shiftKey: true });
  expect(more).toHaveBeenCalledWith(session);
  rerender(<SessionRow s={session} />);
  expect(screen.getByRole("button", { name: new RegExp(session.title) })).toBeTruthy();
	});

	it("does not open a long-press sheet after its row unmounts", () => {
		vi.useFakeTimers();
		const more = vi.fn();
		const { unmount } = render(<SessionRow s={session} onMore={more} />);
		fireEvent.pointerDown(screen.getByRole("button"), { pointerType: "touch", clientX: 10, clientY: 10 });
		unmount();
		act(() => vi.advanceTimersByTime(600));
		expect(more).not.toHaveBeenCalled();
	});

	it.each([false, true])("persists unread toggle from %s and renders the refreshed tree", async (unread) => {
		const initial = { ...session, status: "idle" as const, unread };
		const initialTree = { ...tree, pinned: [initial], workspaceGroups: [] };
		useTree.setState({ data: initialTree });
		apiMock.mockImplementation(async (method: string) => method === "POST" ? { ok: true, unread: !unread } : { ...initialTree, pinned: [{ ...initial, unread: !unread }] });
		render(<TreeView onMore={() => {}} />);
		swipeRow(screen.getByRole("button", { name: new RegExp(session.title) }), 100, 22);
		await waitFor(() => expect(apiMock).toHaveBeenCalledWith("POST", "/left/inbox/s1/unread", { unread: !unread }));
		await waitFor(() => expect(Boolean(screen.queryByLabelText("未读"))).toBe(!unread));
	});

	it("keeps unread unchanged when persistence fails", async () => {
		apiMock.mockRejectedValue(new Error("offline"));
		render(<SessionRow s={{ ...session, status: "idle", unread: true }} />);
		swipeRow(screen.getByRole("button"), 100, 22);
		await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.stringContaining("操作失败"), { kind: "error" }));
		expect(screen.getByLabelText("未读")).toBeTruthy();
		expect(apiMock).not.toHaveBeenCalledWith("GET", expect.anything());
	});

	it.each([false, true])("reveals and explicitly toggles archive from %s", async (archived) => {
		const item = { ...session, status: "idle" as const, archived };
		const open = vi.fn();
		render(<SessionRow s={item} onOpen={open} />);
		const row = screen.getByRole("button", { name: new RegExp(session.title) });
		swipeRow(row, -300, 22);
		fireEvent.click(row, { detail: 1 });
		expect(open).not.toHaveBeenCalled();
		expect(patchSession).not.toHaveBeenCalled();
		expect(apiMock).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: archived ? "取消归档" : "归档" }));
		await waitFor(() => expect(patchSession).toHaveBeenCalledWith(item, { archived: !archived }, archived ? "已取消归档" : "已归档"));
		expect(screen.queryByRole("button", { name: archived ? "取消归档" : "归档" })).toBeNull();
	});

	it.each(["right swipe", "tap"])("closes a revealed row on %s without mutation or navigation", (action) => {
		const open = vi.fn();
		render(<SessionRow s={{ ...session, status: "idle" }} onOpen={open} />);
		const row = screen.getByRole("button", { name: new RegExp(session.title) });
		swipeRow(row, -100, 20);
		if (action === "right swipe") {
			swipeRow(row, 100, 20);
			fireEvent.click(row, { detail: 1 });
		} else {
			rowPointer(row, "pointerdown", 20, 20);
			rowPointer(row, "pointerup", 20, 20);
			fireEvent.click(row, { detail: 1 });
		}
		expect(screen.queryByRole("button", { name: "归档" })).toBeNull();
		expect(open).not.toHaveBeenCalled();
		expect(patchSession).not.toHaveBeenCalled();
		expect(apiMock).not.toHaveBeenCalled();
	});

	it.each(["short", "vertical", "cancel"])("keeps %s gestures safe", (action) => {
		const open = vi.fn();
		render(<SessionRow s={{ ...session, status: "idle" }} onOpen={open} />);
		const row = screen.getByRole("button", { name: new RegExp(session.title) });
		rowPointer(row, "pointerdown", 20, 20);
		rowPointer(row, "pointermove", action === "short" ? -20 : action === "vertical" ? 15 : -100, action === "vertical" ? 130 : 20);
		rowPointer(row, action === "cancel" ? "pointercancel" : "pointerup", action === "short" ? -20 : action === "vertical" ? 15 : -100, action === "vertical" ? 130 : 20);
		fireEvent.click(row, { detail: 1 });
		expect(screen.queryByRole("button", { name: "归档" })).toBeNull();
		expect(open).not.toHaveBeenCalled();
		expect(patchSession).not.toHaveBeenCalled();
		expect(apiMock).not.toHaveBeenCalled();
	});

	it("leaves vertical scrolling to its container without mutation or accidental open", () => {
		const open = vi.fn();
		render(<SessionRow s={session} onOpen={open} />);
		const row = screen.getByRole("button");
		swipeRow(row, 24, 130);
		fireEvent.click(row, { detail: 1 });
		expect(apiMock).not.toHaveBeenCalled();
		expect(open).not.toHaveBeenCalled();
	});

	it("uses a registered worktree even when it lives outside its project path", async () => {
		apiMock.mockResolvedValue({ dirs: [{ kind: "worktree", workspaceId: "a", path: "/external/feature", label: "feature" }] });
		render(<TreeView onMore={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "在 项目甲 新建会话" }));
		fireEvent.click(await screen.findByRole("button", { name: /在独立工作树新建/ }));
		await waitFor(() => expect(newSessionIn).toHaveBeenCalledWith("/external/feature"));
	});

	it("never silently creates in the current directory when no worktree exists", async () => {
		apiMock.mockResolvedValue({ dirs: [{ kind: "worktree", workspaceId: "other", path: "/projects/ab/feature" }] });
		render(<TreeView onMore={() => {}} />);
		fireEvent.click(screen.getByRole("button", { name: "在 项目甲 新建会话" }));
		fireEvent.click(await screen.findByRole("button", { name: /在独立工作树新建/ }));
		await waitFor(() => expect(toast).toHaveBeenCalledWith("这个项目还没有独立工作树，请先在电脑端创建", { kind: "info" }));
		expect(newSessionIn).not.toHaveBeenCalled();
	});

	 it("shows desktop session actions and resumes a suspended session", async () => {
		const open = vi.fn();
		const suspended = { ...session, status: "suspended" as const, git: { branch: "feature/test" } };
		function Actions() { const { openActions, node } = useSessionActions(open); return <><button onClick={() => openActions(suspended)}>会话操作</button>{node}</>; }
		render(<Actions />);
		fireEvent.click(screen.getByRole("button", { name: "会话操作" }));
		expect(screen.getByRole("button", { name: "归入工作区" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "复制会话 ID" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "复制分支名" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "恢复会话" }));
		await waitFor(() => expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/s1/resume", {}));
		expect(open).toHaveBeenCalledWith(suspended);
	});

	it("uses the drawer navigation callback when opening a session from its actions", () => {
		const open = vi.fn();
		function Actions() {
			const { openActions, node } = useSessionActions(open);
			return <><button type="button" onClick={() => openActions(session)}>会话操作</button>{node}</>;
		}
		render(<Actions />);
		fireEvent.click(screen.getByRole("button", { name: "会话操作" }));
		fireEvent.click(screen.getByRole("button", { name: "打开" }));
		expect(open).toHaveBeenCalledWith(session);
	});
});

describe("pull to refresh", () => {
	it("cancels interrupted and horizontal gestures instead of refreshing", () => {
		const refresh = vi.fn();
		const { container } = render(<PullToRefresh onRefresh={refresh}><p>列表</p></PullToRefresh>);
		const scroller = container.firstElementChild as HTMLElement;
		fireEvent.touchStart(scroller, { touches: [{ clientX: 0, clientY: 0 }] });
		fireEvent.touchMove(scroller, { touches: [{ clientX: 0, clientY: 200 }] });
		fireEvent.touchCancel(scroller);
		fireEvent.touchStart(scroller, { touches: [{ clientX: 0, clientY: 0 }] });
		fireEvent.touchMove(scroller, { touches: [{ clientX: 220, clientY: 150 }] });
		fireEvent.touchEnd(scroller);
		expect(refresh).not.toHaveBeenCalled();
	});

	it("announces a refresh and clears its busy state when the callback finishes", async () => {
		let finish = () => {};
		const refresh = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
		const { container } = render(<PullToRefresh onRefresh={refresh}><p>列表</p></PullToRefresh>);
		const scroller = container.firstElementChild as HTMLElement;
		fireEvent.touchStart(scroller, { touches: [{ clientX: 0, clientY: 0 }] });
		fireEvent.touchMove(scroller, { touches: [{ clientX: 0, clientY: 200 }] });
		fireEvent.touchEnd(scroller);
		expect(scroller.getAttribute("aria-busy")).toBe("true");
		expect(screen.getByRole("status").textContent).toBe("正在刷新");
		await act(async () => { await Promise.resolve(); finish(); });
		expect(scroller.hasAttribute("aria-busy")).toBe(false);
		expect(refresh).toHaveBeenCalledTimes(1);
	});
});

describe("search feedback", () => {
 it("shows progress, preserves the last successful result while retrying and clears immediately", async () => {
		apiMock.mockImplementation(async (_method: string, path: string) => {
			if (path.includes("/left/search")) throw new Error("离线");
			return tree;
		});
		render(<SearchPage route={route} />);
		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "查找" } });
		expect(screen.getAllByRole("status").some((node) => node.textContent === "正在搜索")).toBe(true);
		await screen.findByRole("alert");
		expect(screen.queryByText(session.title)).toBeNull();
		apiMock.mockImplementation(async (_method: string, path: string) => path.includes("/left/search") ? { sessions: [session], branches: [] } : tree);
		fireEvent.click(screen.getByRole("button", { name: "重试" }));
		await screen.findByText(session.title);
		fireEvent.change(screen.getByRole("searchbox"), { target: { value: "其他" } });
  expect(screen.getByRole("button", { name: new RegExp(session.title) })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "清空" }));
  expect(screen.queryByRole("button", { name: new RegExp(session.title) })).toBeNull();
	});

 it("keeps server result order and ignores an older query response", async () => {
  // ES2021/iOS 15 target does not provide Promise.withResolvers.
  const pending = new Map<string, (result: unknown) => void>();
  apiMock.mockImplementation((_method: string, path: string) => {
   if (path.includes("/left/search")) return new Promise((resolve) => pending.set(new URL(path, "https://test.invalid").searchParams.get("q")!, resolve));
   return Promise.resolve(tree);
  });
  render(<SearchPage route={route} />);
  const input = screen.getByRole("searchbox");
  fireEvent.change(input, { target: { value: "old" } });
  await waitFor(() => expect(pending.has("old")).toBe(true));
  fireEvent.change(input, { target: { value: "new" } });
  await waitFor(() => expect(pending.has("new")).toBe(true));
  const newest = { ...session, id: "rank-first", title: "排序首条" };
  const second = { ...session, id: "rank-second", title: "排序次条" };
  await act(async () => pending.get("new")!({ sessions: [newest, second], branches: [] }));
  const firstNode = screen.getByRole("button", { name: /排序首条/ });
  const secondNode = screen.getByRole("button", { name: /排序次条/ });
  expect(firstNode.compareDocumentPosition(secondNode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await act(async () => pending.get("old")!({ sessions: [{ ...session, title: "过期结果" }], branches: [] }));
  expect(screen.queryByRole("button", { name: /过期结果/ })).toBeNull();
  expect(screen.getByRole("button", { name: /排序首条/ })).toBeTruthy();
 });
});

describe("inbox aggregate feedback", () => {
	it("does not announce empty while todos fail, and recovers after retry", async () => {
		apiMock.mockImplementation(async (_method: string, path: string) => {
			if (path === "/todos") throw new Error("待办离线");
			return { awaiting: [], error: [], unread: [], running: [] };
		});
		render(<InboxPage route={{ ...route, name: "inbox", path: "/inbox" }} />);
		await screen.findByRole("alert");
		expect(screen.queryByText("收件箱是空的")).toBeNull();
		apiMock.mockResolvedValue([]);
		fireEvent.click(screen.getByRole("button", { name: "重试加载待办" }));
		await screen.findByText("收件箱是空的");
	});
});
