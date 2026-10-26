// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { backlogAdd, backlogList } = vi.hoisted(() => ({ backlogAdd: vi.fn(), backlogList: vi.fn() }));

vi.mock("../../lib/ipc", () => ({ backlogAdd, backlogList, saveClipboardImage: vi.fn() }));
vi.mock("../../lib/events", () => ({ onBacklogChanged: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../chat/imageTokens", () => ({ getImageTokenPalette: () => ({ hex: "#888888" }) }));

import { useSessions } from "../../stores/sessions";
import { useBacklog } from "./backlogStore";
import { IdeaEditBox } from "./IdeaEditBox";

beforeEach(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	useBacklog.setState({
		editBuffer: { id: "item-1", text: "🖼️ #1hello", images: ["/tmp/img.png"] },
	});
	useSessions.setState({
		workspaces: [{ path: "/work/p1", name: "Project 1", isPrimary: true }],
		sessions: {},
	} as never);
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

describe("IdeaEditBox ESC and overlay layering", () => {
	it("ESC with image preview open keeps editor mounted and content; second ESC cancels the editor", async () => {
		const onCancel = vi.fn();
		const onSave = vi.fn();

		const { unmount } = render(
			<IdeaEditBox
				id="item-1"
				kind="idea"
				onKindChange={() => {}}
				project=""
				onProjectChange={() => {}}
				onSave={onSave}
				onCancel={onCancel}
			/>,
		);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea.value).toBe("🖼️ #1hello");

		// Open image preview by clicking the chip
		const chip = screen.getByTitle("/tmp/img.png（点击预览）");
		fireEvent.mouseDown(chip);

		// Lightbox is now visible in the DOM
		expect(document.querySelector('[data-layer="lightbox"]')).toBeTruthy();

		// First ESC: should close the lightbox only; editor stays mounted and onCancel is not called
		act(() => {
			fireEvent.keyDown(window, { key: "Escape" });
		});

		expect(document.querySelector('[data-layer="lightbox"]')).toBeNull();
		expect(onCancel).not.toHaveBeenCalled();
		expect(screen.getByRole("textbox")).toBeTruthy();
		expect(textarea.value).toBe("🖼️ #1hello");

		// Focus is returned to the textarea
		expect(document.activeElement).toBe(textarea);

		// Second ESC: closes the editor
		act(() => {
			fireEvent.keyDown(textarea, { key: "Escape" });
		});

		expect(onCancel).toHaveBeenCalledTimes(1);
		unmount();
	});

	it("ESC when project picker popover is open closes only the picker; second ESC cancels the editor", async () => {
		const onCancel = vi.fn();
		const onSave = vi.fn();

		const { unmount } = render(
			<IdeaEditBox
				id="item-1"
				kind="idea"
				onKindChange={() => {}}
				project="/work/p1"
				onProjectChange={() => {}}
				onSave={onSave}
				onCancel={onCancel}
			/>,
		);

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;

		// Open project picker
		const pickerBtn = screen.getByRole("button", { name: /归属项目/ });
		fireEvent.click(pickerBtn);

		// Project picker popover should be open
		expect(screen.getByRole("listbox")).toBeTruthy();

		// First ESC: closes only the project picker popover
		act(() => {
			fireEvent.keyDown(textarea, { key: "Escape" });
		});

		expect(screen.queryByRole("listbox")).toBeNull();
		expect(onCancel).not.toHaveBeenCalled();
		expect(screen.getByRole("textbox")).toBeTruthy();

		// Second ESC: cancels the editor
		act(() => {
			fireEvent.keyDown(textarea, { key: "Escape" });
		});

		expect(onCancel).toHaveBeenCalledTimes(1);
		unmount();
	});

	it("bare ESC with no overlays open cancels immediately", () => {
		const onCancel = vi.fn();
		const onSave = vi.fn();

		render(
			<IdeaEditBox
				id="item-1"
				kind="idea"
				onKindChange={() => {}}
				project=""
				onProjectChange={() => {}}
				onSave={onSave}
				onCancel={onCancel}
			/>,
		);

		const textarea = screen.getByRole("textbox");
		fireEvent.keyDown(textarea, { key: "Escape" });

		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});
