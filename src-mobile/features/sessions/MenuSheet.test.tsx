// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("../../core/nav", () => ({
	nav: { push: (...a: unknown[]) => pushMock(...a), pushLayer: () => () => {} },
	paths: {
		search: () => "/search",
		schedules: () => "/schedules",
		inbox: () => "/inbox",
		quota: () => "/quota",
		settings: () => "/settings",
		chat: (id: string) => `/s/${id}`,
	},
}));

vi.mock("../../core/api", () => ({
	api: vi.fn().mockResolvedValue({ dirs: [] }),
	errorMessage: (e: unknown) => String(e),
}));

vi.mock("../../core/stores/sessions", () => ({
	useSessions: Object.assign(
		(selector: (s: { list: unknown[]; byId: Record<string, unknown> }) => unknown) =>
			selector({ list: [], byId: {} }),
		{
			getState: () => ({
				list: [],
				byId: {},
				refresh: vi.fn().mockResolvedValue([]),
			}),
		},
	),
}));

import { MenuSheet } from "./MenuSheet";

beforeEach(() => {
	vi.clearAllMocks();
});

afterEach(() => {
	cleanup();
});

describe("MenuSheet (Left Navigation Sheet)", () => {
	it("renders required Top, Middle, and Bottom sections and excludes irrelevant Gemini items", () => {
		const onClose = vi.fn();
		const onNewSession = vi.fn();

		render(<MenuSheet open onClose={onClose} onNewSession={onNewSession} />);

		// 1. Top section
		const newBtn = screen.getByRole("button", { name: /发起新对话/i });
		expect(newBtn).not.toBeNull();
		fireEvent.click(newBtn);
		expect(onNewSession).toHaveBeenCalled();
		expect(onClose).toHaveBeenCalled();

		const searchBtn = screen.getByRole("button", { name: /搜索会话/i });
		expect(searchBtn).not.toBeNull();
		fireEvent.click(searchBtn);
		expect(pushMock).toHaveBeenCalledWith("/search");

		const schedulesBtn = screen.getByRole("button", { name: /定时任务/i });
		expect(schedulesBtn).not.toBeNull();
		fireEvent.click(schedulesBtn);
		expect(pushMock).toHaveBeenCalledWith("/schedules");

		// 2. Middle section: Space selector & "按项目 / 按时间" view toggle
		const projectTab = screen.getByRole("tab", { name: "按项目" });
		const timeTab = screen.getByRole("tab", { name: "按时间" });
		expect(projectTab).not.toBeNull();
		expect(timeTab).not.toBeNull();

		// Toggle view mode
		fireEvent.click(timeTab);
		expect(timeTab.getAttribute("aria-selected")).toBe("true");

		// 3. Bottom section
		const inboxBtn = screen.getByRole("button", { name: /收件箱/i });
		expect(inboxBtn).not.toBeNull();
		fireEvent.click(inboxBtn);
		expect(pushMock).toHaveBeenCalledWith("/inbox");

		const quotaBtn = screen.getByRole("button", { name: /订阅与配额/i });
		expect(quotaBtn).not.toBeNull();
		fireEvent.click(quotaBtn);
		expect(pushMock).toHaveBeenCalledWith("/quota");

		const settingsBtn = screen.getByRole("button", { name: /设置/i });
		expect(settingsBtn).not.toBeNull();
		fireEvent.click(settingsBtn);
		expect(pushMock).toHaveBeenCalledWith("/settings");

		// 4. Remove irrelevant Gemini items: 库, 学生, 自定义, 视频, 笔记本
		expect(screen.queryByText(/库/)).toBeNull();
		expect(screen.queryByText(/学生/)).toBeNull();
		expect(screen.queryByText(/自定义/)).toBeNull();
		expect(screen.queryByText(/视频/)).toBeNull();
		expect(screen.queryByText(/笔记本/)).toBeNull();
	});
});
