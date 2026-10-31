// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../core/api", () => ({
	api: vi.fn().mockResolvedValue({ dirs: [] }),
	errorMessage: (e: unknown) => String(e),
}));

vi.mock("../../core/nav", () => ({
	nav: { push: () => {}, pushLayer: () => () => {} },
	paths: { chat: (id: string) => `/s/${id}`, search: () => "/search", schedules: () => "/schedules", inbox: () => "/inbox", quota: () => "/quota", settings: () => "/settings" },
}));

vi.mock("../../core/stores/sessions", () => ({
	useSessions: Object.assign(
		(selector: (s: { list: unknown[]; byId: Record<string, unknown> }) => unknown) =>
			selector({ list: [], byId: {} }),
		{
			getState: () => ({
				createSession: vi.fn(),
				refresh: vi.fn().mockResolvedValue([]),
				list: [],
				byId: {},
			}),
		},
	),
}));

import { HomePage } from "./HomePage";
import { MenuSheet } from "./MenuSheet";

beforeEach(() => {
 vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => {
	cleanup();
 vi.unstubAllGlobals();
});

describe("Session surface DOM accessibility (not layout measurement)", () => {
 it("exposes the Home composer and its primary actions", () => {
  render(<HomePage route={{ name: "home", path: "/", params: {}, query: {} }} />);
  expect(screen.getByRole("textbox", { name: "消息输入框" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "发送" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "语音输入" })).toBeTruthy();
 });

 it("exposes a modal navigation dialog with an explicit close action", () => {
  const onClose = vi.fn();
  render(<MenuSheet open onClose={onClose} />);
  expect(screen.getByRole("dialog", { name: "导航" }).getAttribute("aria-modal")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "关闭导航" }));
  expect(onClose).toHaveBeenCalledTimes(1);
 });
});
