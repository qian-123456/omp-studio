// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
const createSessionMock = vi.fn();
const pushMock = vi.fn();

vi.mock("../../core/api", () => ({
	api: (...a: unknown[]) => apiMock(...a),
	errorMessage: (e: unknown) => String((e as Error)?.message ?? e),
}));
vi.mock("../../core/nav", () => ({
	nav: { push: (...a: unknown[]) => pushMock(...a), pushLayer: () => () => {} },
	paths: { chat: (id: string) => `/s/${id}`, search: () => "/search", schedules: () => "/schedules", inbox: () => "/inbox", quota: () => "/quota", settings: () => "/settings" },
}));
vi.mock("../../core/stores/sessions", () => ({
	useSessions: Object.assign(
		(selector: (s: { list: unknown[]; byId: Record<string, unknown> }) => unknown) =>
			selector({ list: [], byId: {} }),
		{
			getState: () => ({
				createSession: createSessionMock,
				refresh: vi.fn().mockResolvedValue([]),
				list: [],
				byId: {},
			}),
		},
	),
}));

import { HomePage } from "./HomePage";

beforeEach(() => {
	apiMock.mockImplementation(async (_m: string, path: string) => {
		if (path === "/left/dirs") {
			return {
				dirs: [
					{ path: "/project/workspace", label: "workspace", kind: "workspace", mode: "code", workspaceId: "w1" },
				],
			};
		}
		if (path === "/left/sessions") {
			return { pinned: [], workspaceGroups: [], unassignedGroups: [], deletedSessions: [], archived: [] };
		}
		if (path === "/left/todos") {
			return { todos: [] };
		}
		if (path.includes("/prompt-ex")) {
			return { sessionId: "real-session-123" };
		}
		return {};
	});
	createSessionMock.mockResolvedValue({ id: "mobile-draft-1", mode: "code", cwd: "/project/workspace" });
});

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("HomePage", () => {
	it("renders neutral welcome page without user name or 聊天/任务 switch", () => {
		render(<HomePage route={{ name: "home", path: "/", params: {}, query: {} }} />);

		// Neutral greeting exists
		expect(screen.getByText("今天想做点什么？")).not.toBeNull();

		// No user name is displayed
		expect(screen.queryByText(/用户|User|Admin/i)).toBeNull();

		// No 聊天 / 任务 switch
		expect(screen.queryByRole("tab", { name: "会话" })).toBeNull();
		expect(screen.queryByRole("tab", { name: "待办" })).toBeNull();
		expect(screen.queryByText("聊天/任务")).toBeNull();

		// Pill composer exists with + and mic (when empty)
		expect(screen.getByRole("button", { name: "新建会话选项" })).not.toBeNull();
		expect(screen.getByRole("button", { name: "语音输入" })).not.toBeNull();
		expect(screen.getByPlaceholderText("今天想做点什么？")).not.toBeNull();
	});

	it("switches from mic to send button when text is typed and hands off draft on send", async () => {
		render(<HomePage route={{ name: "home", path: "/", params: {}, query: {} }} />);

		const input = screen.getByPlaceholderText("今天想做点什么？");
		fireEvent.change(input, { target: { value: "帮我编写单元测试" } });

		// Mic button is replaced by send button
		expect(screen.queryByRole("button", { name: "语音输入" })).toBeNull();
		const sendBtn = screen.getByRole("button", { name: "发送消息" });
		expect(sendBtn).not.toBeNull();

		await act(async () => {
			fireEvent.click(sendBtn);
		});

		expect(createSessionMock).toHaveBeenCalledWith({
			cwd: "/project/workspace",
			mode: "code",
		});
		expect(apiMock).toHaveBeenCalledWith("POST", "/sessions/mobile-draft-1/prompt-ex", {
			text: "帮我编写单元测试",
			images: [],
		});
		expect(pushMock).toHaveBeenCalledWith("/s/real-session-123");
	});
});
