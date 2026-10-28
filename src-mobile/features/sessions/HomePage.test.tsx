// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.fn();
const createSessionMock = vi.fn();
const replaceMock = vi.fn();

vi.mock("../../core/api", () => ({
	api: (...a: unknown[]) => apiMock(...a),
	errorMessage: (e: unknown) => String((e as Error)?.message ?? e),
}));
vi.mock("../../core/nav", () => ({
	nav: { push: vi.fn(), replace: (...a: unknown[]) => replaceMock(...a), pushLayer: () => () => {} },
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
import { takeFirstSend } from "../chat/lib/drafts";

vi.mock("../chat/components/useVoiceInput", () => ({
	useVoiceInput: ({ onTranscribed }: { onTranscribed: (text: string) => void }) => ({ recording: false, transcribing: false, toggleRecording: async () => onTranscribed("语音转写内容") }),
}));

const typeMessage = async (text: string) => {
	const input = screen.getByLabelText("消息输入框") as HTMLTextAreaElement;
	await act(async () => {
		fireEvent.input(input, { target: { value: text } });
		// iOS 15 is part of this app's supported target and lacks Promise.withResolvers.
		await new Promise((resolve) => requestAnimationFrame(resolve));
	});
	return input;
};

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
		expect(screen.getByRole("button", { name: "添加" })).not.toBeNull();
		expect(screen.getByRole("button", { name: "语音输入" })).not.toBeNull();
		expect(screen.getByPlaceholderText("今天想做点什么？")).not.toBeNull();
	});

	it("keeps the mic available while typing and activates the draft route with the first prompt queued", async () => {
		render(<HomePage route={{ name: "home", path: "/", params: {}, query: {} }} />);
		await typeMessage("帮我编写单元测试");
		expect(screen.getByRole("button", { name: "语音输入" })).toBeTruthy();
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "发送" })); });
		expect(createSessionMock).toHaveBeenCalledWith({ cwd: "/project/workspace", mode: "code" });
		expect(replaceMock).toHaveBeenCalledWith("/s/mobile-draft-1");
		expect(takeFirstSend("mobile-draft-1")).toBe("帮我编写单元测试");
		expect(apiMock.mock.calls.some((call) => String(call[1]).includes("/prompt-ex"))).toBe(false);
	});

	it("inserts voice transcription at the caret without creating or sending a session", async () => {
		render(<HomePage route={{ name: "home", path: "/", params: {}, query: {} }} />);
		const input = await typeMessage("前文后文");
		input.setSelectionRange(2, 2);
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "语音输入" })); });
		expect(input.value).toBe("前文 语音转写内容后文");
		expect(createSessionMock).not.toHaveBeenCalled();
		expect(replaceMock).not.toHaveBeenCalled();
	});

	it("retains the text on creation failure instead of entering a missing-session route", async () => {
		createSessionMock.mockRejectedValueOnce(new Error("离线"));
		render(<HomePage route={{ name: "home", path: "/", params: {}, query: {} }} />);
		const input = await typeMessage("保留这条消息");
		await act(async () => { fireEvent.click(screen.getByRole("button", { name: "发送" })); });
		expect(input.value).toBe("保留这条消息");
		expect(replaceMock).not.toHaveBeenCalled();
	});
});
