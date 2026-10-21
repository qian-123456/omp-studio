// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SketchPad } from "./SketchPad";

/** Recording stub for CanvasRenderingContext2D (jsdom has no 2d backend). */
const ctxCalls: string[] = [];
const ctxStub = new Proxy(
	{},
	{
		get(_t, prop) {
			if (prop === "measureText") {
				return () => ({ width: 8 });
			}
			if (prop === "canvas") return null;
			return (...args: unknown[]) => {
				ctxCalls.push(String(prop));
				void args;
			};
		},
		set() {
			return true;
		},
	},
);

const PNG_URL = "data:image/png;base64,iVBORw0KGgo=";

beforeEach(() => {
	ctxCalls.length = 0;
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
		(contextId: string) =>
			contextId === "2d"
				? (ctxStub as unknown as CanvasRenderingContext2D)
				: null,
	);
	vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PNG_URL);
	// jsdom reports zero-size rects; give every element a fixed box so the
	// canvas surface reports a usable extent.
	vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
		x: 0,
		y: 0,
		top: 0,
		left: 0,
		bottom: 640,
		right: 960,
		width: 960,
		height: 640,
		toJSON: () => ({}),
	} as DOMRect);
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function setup() {
	const onInsert = vi.fn();
	const onCancel = vi.fn();
	render(<SketchPad onInsert={onInsert} onCancel={onCancel} />);
	const dialog = screen.getByRole("dialog");
	const surface = dialog.querySelector(
		"[data-sketch-canvas-surface]",
	) as HTMLElement;
	const canvas = dialog.querySelector("canvas") as HTMLCanvasElement;
	return { onInsert, onCancel, dialog, surface, canvas };
}

function drawStroke(
	surface: HTMLElement,
	from = { x: 10, y: 10 },
	to = { x: 40, y: 30 },
) {
	fireEvent.pointerDown(surface, {
		button: 0,
		pointerId: 1,
		pointerType: "mouse",
		clientX: from.x,
		clientY: from.y,
	});
	fireEvent.pointerMove(surface, {
		pointerId: 1,
		pointerType: "mouse",
		clientX: to.x,
		clientY: to.y,
	});
	fireEvent.pointerUp(surface, {
		pointerId: 1,
		pointerType: "mouse",
		clientX: to.x,
		clientY: to.y,
	});
}

/** aria-pressed lookup by tooltip title (icon buttons carry both). */
function pressed(name: string): boolean {
	return (
		(screen.getByTitle(name) as HTMLButtonElement).getAttribute(
			"aria-pressed",
		) === "true"
	);
}

describe("SketchPad", () => {
	it("portals a dialog with aria-modal to document.body", () => {
		setup();
		const dialog = screen.getByRole("dialog");
		expect(dialog.closest("[data-sketch-overlay]")?.parentElement).toBe(
			document.body,
		);
		expect(dialog.getAttribute("aria-modal")).toBe("true");
		expect(dialog.getAttribute("aria-label")).toBe("草图编辑器");
		expect(
			screen.getByRole("application", { name: "草图画布" }),
		).toBeTruthy();
	});
	it("switches tools through the capsule and marks aria-pressed", () => {
		setup();
		expect(pressed("画笔")).toBe(true);
		fireEvent.click(screen.getByTitle("选择"));
		expect(pressed("选择")).toBe(true);
		expect(pressed("画笔")).toBe(false);
		fireEvent.click(screen.getByTitle("橡皮"));
		expect(pressed("橡皮")).toBe(true);
	});

	it("shapes button opens the 4×2 popover and picks a shape", () => {
		setup();
		fireEvent.click(screen.getByTitle("形状"));
		expect(pressed("形状")).toBe(true);
		for (const name of [
			"直线",
			"箭头",
			"矩形",
			"椭圆",
			"三角形",
			"菱形",
			"星形",
			"心形",
		]) {
			expect(screen.getByTitle(name)).toBeTruthy();
		}
		fireEvent.click(screen.getByTitle("椭圆"));
		expect(pressed("形状")).toBe(true);
	});

	it("color swatch from eraser switches back to the pen", () => {
		setup();
		fireEvent.click(screen.getByTitle("橡皮"));
		expect(pressed("橡皮")).toBe(true);
		fireEvent.click(screen.getByLabelText("使用红色"));
		expect(pressed("画笔")).toBe(true);
	});

	it("attach is disabled on an empty canvas and enables after a stroke", () => {
		const { surface } = setup();
		const done = screen.getByLabelText("附加草图") as HTMLButtonElement;
		expect(done.disabled).toBe(true);
		drawStroke(surface);
		expect(done.disabled).toBe(false);
	});

	it("attach calls onInsert with a PNG data URL", () => {
		const { onInsert, surface } = setup();
		drawStroke(surface);
		fireEvent.click(screen.getByLabelText("附加草图"));
		return vi.waitFor(() => {
			expect(onInsert).toHaveBeenCalledTimes(1);
			expect(onInsert.mock.calls[0][0]).toMatch(/^data:image\/png/);
		});
	});

	it("Escape hierarchy: text tool falls back to Select, then closes", () => {
		const { onCancel, canvas } = setup();
		fireEvent.click(screen.getByTitle("文字"));
		expect(pressed("文字")).toBe(true);
		// Esc on the canvas: the tool falls back to Select; modal stays open.
		fireEvent.keyDown(canvas, { key: "Escape" });
		expect(onCancel).not.toHaveBeenCalled();
		expect(pressed("选择")).toBe(true);
		// Next Esc with nothing left to consume closes the modal.
		fireEvent.keyDown(canvas, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("Escape inside the text editor only commits the edit", () => {
		const { onCancel, surface } = setup();
		fireEvent.click(screen.getByTitle("文字"));
		fireEvent.pointerDown(surface, {
			button: 0,
			pointerId: 1,
			clientX: 60,
			clientY: 60,
		});
		fireEvent.pointerUp(surface, { pointerId: 1, clientX: 60, clientY: 60 });
		const editor = screen.getByTestId("sketch-text-editor");
		fireEvent.change(editor, { target: { value: "hi" } });
		fireEvent.keyDown(editor, { key: "Escape" });
		expect(screen.queryByTestId("sketch-text-editor")).toBeNull();
		expect(onCancel).not.toHaveBeenCalled();
		// Committing switches the tool back to select.
		expect(pressed("选择")).toBe(true);
	});

	it("X button and bare Escape close an empty sketch immediately", () => {
		const { onCancel } = setup();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(1);
		cleanup();
		render(<SketchPad onCancel={onCancel} onInsert={vi.fn()} />);
		fireEvent.click(screen.getByLabelText("关闭草图编辑器"));
		expect(onCancel).toHaveBeenCalledTimes(2);
	});

	it("closing a non-empty sketch asks before discarding it", () => {
		const { onCancel, surface } = setup();
		drawStroke(surface);
		fireEvent.click(screen.getByLabelText("关闭草图编辑器"));
		expect(onCancel).not.toHaveBeenCalled();
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		// Esc dismisses the confirmation, keeping the drawing.
		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(onCancel).not.toHaveBeenCalled();
		// Backdrop click asks again; confirming discards.
		const overlay = document.querySelector("[data-sketch-overlay]") as HTMLElement;
		fireEvent.pointerDown(overlay);
		expect(onCancel).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "放弃草图" }));
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("undo/redo reflect history state", () => {
		const { surface } = setup();
		const undo = screen.getByLabelText("撤销") as HTMLButtonElement;
		const redo = screen.getByLabelText("重做") as HTMLButtonElement;
		expect(undo.disabled).toBe(true);
		expect(redo.disabled).toBe(true);
		drawStroke(surface);
		expect(undo.disabled).toBe(false);
		fireEvent.click(undo);
		expect(redo.disabled).toBe(false);
		fireEvent.click(redo);
		expect(redo.disabled).toBe(true);
	});

	it("renders 13 palette swatches plus the custom color input", () => {
		setup();
		expect(screen.getAllByRole("button", { name: /^使用/ }).length).toBe(13);
		expect(screen.getByLabelText("自定义颜色")).toBeTruthy();
		expect(screen.getByRole("slider")).toBeTruthy();
	});
});
