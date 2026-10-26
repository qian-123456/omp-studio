// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { backlogAdd, backlogList } = vi.hoisted(() => ({ backlogAdd: vi.fn(), backlogList: vi.fn() }));

vi.mock("../../lib/ipc", () => ({ backlogAdd, backlogList, saveClipboardImage: vi.fn() }));
vi.mock("../../lib/events", () => ({ onBacklogChanged: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../chat/imageTokens", () => ({ getImageTokenPalette: () => ({ hex: "#888888" }) }));

import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { useBacklog } from "./backlogStore";
import { IdeaCaptureBox } from "./IdeaCaptureBox";

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
	useUi.setState({ selectedSessionId: "s1" });
	useSessions.setState({ sessions: { s1: { id: "s1", cwd: "/work/proj", title: "T" } } } as never);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

describe("IdeaCaptureBox", () => {
	it("idle: pill with placeholder and a disabled send button, no kind/project pills", () => {
		render(<IdeaCaptureBox variant="panel" />);
		expect(screen.getByPlaceholderText("记一条想法")).toBeTruthy();
		expect((screen.getByTitle("记录（Enter）") as HTMLButtonElement).disabled).toBe(true);
		expect(screen.queryByText("缺陷")).toBeNull();
	});

	it("expands on focus and shows project, kind pills; quick variant adds the session toggle", () => {
		render(<IdeaCaptureBox variant="quick" />);
		fireEvent.focus(screen.getByPlaceholderText("记一条想法"));
		expect(screen.getByText("缺陷")).toBeTruthy();
		expect(screen.getByText("想法")).toBeTruthy();
		expect(screen.getByText("proj")).toBeTruthy();
		expect(screen.getByText("附带当前会话")).toBeTruthy();
	});

	it("submits with Enter using the chosen kind, resolved project and inline image tags; clears draft", async () => {
		const onSubmitted = vi.fn();
		useBacklog.setState({ draft: { text: "修一下 🖼️ #1", kind: "idea", images: ["/tmp/a.png"] } });
		render(<IdeaCaptureBox variant="panel" onSubmitted={onSubmitted} />);
		const ta = screen.getByPlaceholderText("记一条想法");
		fireEvent.focus(ta);
		fireEvent.click(screen.getByText("缺陷"));
		fireEvent.keyDown(ta, { key: "Enter" });
		await waitFor(() => expect(backlogAdd).toHaveBeenCalledTimes(1));
		expect(backlogAdd).toHaveBeenCalledWith("修一下 [图片: /tmp/a.png]", "bug", [], "/work/proj");
		await waitFor(() => expect(onSubmitted).toHaveBeenCalled());
		expect(useBacklog.getState().draft.text).toBe("");
		expect(useBacklog.getState().draft.images).toEqual([]);
	});

	it("Shift+Enter does not submit; empty draft never submits", () => {
		render(<IdeaCaptureBox variant="panel" />);
		const ta = screen.getByPlaceholderText("记一条想法");
		fireEvent.keyDown(ta, { key: "Enter" });
		useBacklog.setState({ draft: { text: "x", kind: "idea", images: [] } });
		fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
		expect(backlogAdd).not.toHaveBeenCalled();
	});

	it("quick variant attaches the session ref only while the toggle is on", async () => {
		useBacklog.setState({ draft: { text: "记一下", kind: "idea", images: [] } });
		render(<IdeaCaptureBox variant="quick" />);
		fireEvent.keyDown(screen.getByPlaceholderText("记一条想法"), { key: "Enter" });
		await waitFor(() => expect(backlogAdd).toHaveBeenCalled());
		expect(backlogAdd.mock.calls[0][2]).toEqual([
			{ kind: "session", sessionId: "s1", path: null, text: null, lines: null },
		]);
	});
});
