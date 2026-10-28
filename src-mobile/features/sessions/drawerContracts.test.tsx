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
import { TreeView } from "./TreeView";
import { useTree } from "./treeStore";
import { InboxPage } from "./InboxPage";
import { useTodos } from "./todos";
import type { SessionTree, TreeSession } from "./tree";

const session: TreeSession = { id: "s1", label: "#1", title: "完整的长会话标题，不应在没有展开入口时截断", status: "working", updatedAt: "2026-10-27T10:00:00Z", cwd: "/projects/a", live: true };
const tree: SessionTree = { pinned: [], globalGroup: null, workspaceGroups: [{ workspace: { id: "a", path: "/projects/a", name: "项目甲" }, isGlobal: false, totalCount: 1, subgroups: [{ key: "main", kind: "default", label: "main", deleted: false, sessions: [session], totalCount: 1 }], deletedSubgroups: [] }], unassignedGroups: [], deletedSessions: [], archived: [] };
const route: Route = { name: "search", path: "/search", params: {}, query: {} };

beforeEach(() => {
	vi.clearAllMocks();
	apiMock.mockResolvedValue({ dirs: [] });
	useTree.setState({ data: tree, error: null, mode: "code", open: {}, expanded: {} });
	useTodos.setState({ todos: [], loaded: false, loading: false, error: null });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("drawer session contracts", () => {
	it("exposes full titles to keyboard actions and does not clamp without an actions entry", () => {
		const more = vi.fn();
		const { rerender } = render(<SessionRow s={session} onMore={more} />);
		fireEvent.keyDown(screen.getByRole("button"), { key: "F10", shiftKey: true });
		expect(more).toHaveBeenCalledWith(session);
		expect(screen.getByText(session.title).className).toContain("line-clamp-2");
		rerender(<SessionRow s={session} />);
		expect(screen.getByText(session.title).className).not.toContain("line-clamp-2");
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
	it("shows progress immediately, hides stale results and allows failed searches to retry", async () => {
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
		expect(screen.queryByText(session.title)).toBeNull();
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
