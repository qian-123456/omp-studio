// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { backlogAdd, backlogList } = vi.hoisted(() => ({ backlogAdd: vi.fn(), backlogList: vi.fn() }));

vi.mock("../../lib/ipc", () => ({ backlogAdd, backlogList, saveClipboardImage: vi.fn() }));
vi.mock("../../lib/events", () => ({ onBacklogChanged: vi.fn(() => Promise.resolve(() => {})), onQuickCapture: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../chat/imageTokens", () => ({ getImageTokenPalette: () => ({ hex: "#888888" }) }));

import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useBacklog } from "./backlogStore";
import { QuickCapture } from "./QuickCapture";
import { toast } from "../../lib/toast";

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			disconnect() {}
		},
	);
	backlogAdd.mockReset().mockResolvedValue({ id: "n1" });
	backlogList.mockReset().mockResolvedValue([]);
	useBacklog.setState({ draft: { text: "", kind: "idea", images: [] }, lastKind: "idea", captureProject: null });
	useUi.setState({ selectedSessionId: "s1", modal: null });
	useSessions.setState({ sessions: { s1: { id: "s1", cwd: "/work/proj", title: "Test Project" } } } as never);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("QuickCapture modal layer", () => {
	it("renders nothing when modal is not quick-capture", () => {
		useUi.setState({ modal: null });
		render(<QuickCapture />);
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("renders modal with title, textarea, and full controls when open", () => {
		useUi.setState({ modal: { name: "quick-capture", props: { text: "从会话选中的文本", sessionId: "s1" } } });
		render(<QuickCapture />);

		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(screen.getByText("记到收集箱")).toBeTruthy();
		expect(screen.getByDisplayValue("从会话选中的文本")).toBeTruthy();
		expect(screen.getByText("缺陷")).toBeTruthy();
		expect(screen.getByText("想法")).toBeTruthy();
		expect(screen.getByText("proj")).toBeTruthy();
		expect(screen.getByText("附带当前会话")).toBeTruthy();
		expect(screen.getByLabelText("添加图片")).toBeTruthy();
	});

	it("submitting closes the modal and triggers success toast", async () => {
		useUi.setState({ modal: { name: "quick-capture", props: { text: "需要解决的问题", sessionId: "s1" } } });
		render(<QuickCapture />);

		const textarea = screen.getByDisplayValue("需要解决的问题");
		fireEvent.keyDown(textarea, { key: "Enter" });

		await waitFor(() => expect(backlogAdd).toHaveBeenCalledTimes(1));
		expect(toast.success).toHaveBeenCalledWith("已记入收集箱");
		expect(useUi.getState().modal).toBeNull();
	});

	it("closes modal on header close button click", () => {
		useUi.setState({ modal: { name: "quick-capture", props: {} } });
		render(<QuickCapture />);

		const closeBtn = screen.getByLabelText("关闭");
		fireEvent.click(closeBtn);
		expect(useUi.getState().modal).toBeNull();
	});
});
