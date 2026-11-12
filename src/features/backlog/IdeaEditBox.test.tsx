// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { backlogAdd, backlogList } = vi.hoisted(() => ({ backlogAdd: vi.fn(), backlogList: vi.fn() }));

vi.mock("../../lib/ipc", () => ({ backlogAdd, backlogList, saveClipboardImage: vi.fn() }));
vi.mock("../../lib/events", () => ({ onBacklogChanged: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("../chat/imageTokens", async (original) => ({ ...(await original<Record<string, unknown>>()), getImageTokenPalette: () => ({ hex: "#888888" }) }));

import { useSessions } from "../../stores/sessions";
import { resetLastCompositionEndForTest } from "../../lib/hooks";
import { IdeaEditor } from "./IdeaEditor";
import { useBacklog } from "./backlogStore";
import { IdeaEditBox } from "./IdeaEditBox";

beforeEach(() => {
	resetLastCompositionEndForTest();
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
	resetLastCompositionEndForTest();
	vi.unstubAllGlobals();
	document.body.innerHTML = "";
});

describe("IdeaEditBox ESC and overlay layering", () => {
	it.each(["Backspace", "Delete"] as const)("removes an adjacent image marker atomically with %s", (key) => {
		render(<IdeaEditBox id="item-1" kind="idea" onKindChange={() => {}} project="" onProjectChange={() => {}} onSave={() => {}} onCancel={() => {}} />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		const caret = key === "Backspace" ? "🖼️ #1".length : 0;
		textarea.setSelectionRange(caret, caret);
		fireEvent.keyDown(textarea, { key });
		expect(useBacklog.getState().editBuffer?.text).toBe("hello");
		expect(useBacklog.getState().editBuffer?.images).toEqual([]);
	});

	it.each(["Enter", "Escape", "Backspace", "Delete"])("leaves IME %s native without saving, cancelling or removing the image", (key) => {
		const onSave = vi.fn();
		const onCancel = vi.fn();
		render(<IdeaEditBox id="item-1" kind="idea" onKindChange={() => {}} project="" onProjectChange={() => {}} onSave={onSave} onCancel={onCancel} />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		const caret = key === "Delete" ? 0 : "🖼️ #1".length;
		textarea.setSelectionRange(caret, caret);
		for (const ime of [{ isComposing: true }, { keyCode: 229 }]) {
			expect(fireEvent.keyDown(textarea, { key, ...ime })).toBe(true);
		}
		expect(onSave).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
		expect(useBacklog.getState().editBuffer).toEqual({ id: "item-1", text: "🖼️ #1hello", images: ["/tmp/img.png"] });
	});

	it.each(["compositionend", "blur"])("paints native preedit and commits its latest value once on %s", (finish) => {
		const onChange = vi.fn();
		function Editor() {
			const [doc, setDoc] = useState({ text: "🖼️ #1不是", images: ["/tmp/img.png"] });
			return <IdeaEditor doc={doc} onChange={(next) => { onChange(next); setDoc(next); }} minHeight={74} maxHeight={74} />;
		}
		render(<Editor />);
		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		const mirror = textarea.nextElementSibling as HTMLDivElement;
		const transparent = getComputedStyle(textarea).color;
		expect(transparent).toBe("rgba(0, 0, 0, 0)");
		expect(getComputedStyle(mirror).visibility).not.toBe("hidden");

		fireEvent.compositionStart(textarea);
		expect(getComputedStyle(textarea).color).not.toBe(transparent);
		expect(getComputedStyle(mirror).visibility).toBe("hidden");
		fireEvent.change(textarea, { target: { value: "🖼️ #1不是直接" } });
		expect(onChange).toHaveBeenCalledTimes(1);

		// Native preedit can advance before React receives the final input event.
		const text = "🖼️ #1不是直接就发送。";
		const setNativeValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
		setNativeValue.call(textarea, text);
		if (finish === "compositionend") fireEvent.compositionEnd(textarea);
		else fireEvent.blur(textarea);
		expect(textarea.value).toBe(text);
		expect(getComputedStyle(textarea).color).toBe(transparent);
		expect(getComputedStyle(mirror).visibility).not.toBe("hidden");
		expect(mirror.textContent).toBe(text);
		expect(onChange).toHaveBeenLastCalledWith({ text, images: ["/tmp/img.png"] });
		expect(onChange).toHaveBeenCalledTimes(2);

		fireEvent.input(textarea, { target: { value: text } });
		expect(onChange).toHaveBeenCalledTimes(2);
	});
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

describe("IdeaEditBox stable 3-line editor display and interactions", () => {
	it("renders stable 3-line textarea and 3-line hint while preserving Enter-to-save, Shift+Enter, and Esc", () => {
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

		const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(textarea.getAttribute("rows")).toBe("3");
		expect(textarea.rows).toBe(3);
		expect(textarea.style.minHeight).toBe("74px");
		expect(textarea.style.height).toBe("74px");

		// Hint is split into 3 distinct lines with whitespace-nowrap
		expect(screen.getByText("Enter 保存").className).toContain("whitespace-nowrap");
		expect(screen.getByText("Shift+Enter 换行").className).toContain("whitespace-nowrap");
		expect(screen.getByText("Esc 取消").className).toContain("whitespace-nowrap");

		// Preserves text contents & update
		fireEvent.change(textarea, { target: { value: "new text line" } });
		expect(useBacklog.getState().editBuffer?.text).toBe("new text line");

		// Preserves Shift+Enter (no save)
		fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
		expect(onSave).not.toHaveBeenCalled();

		// Preserves Enter-to-save
		fireEvent.keyDown(textarea, { key: "Enter" });
		expect(onSave).toHaveBeenCalledTimes(1);

		// Preserves Escape cancel
		fireEvent.keyDown(textarea, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});
