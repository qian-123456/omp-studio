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
			if (prop === "canvas") return {};
			return (...args: unknown[]) => {
				ctxCalls.push(`${String(prop)}(${args.length})`);
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
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

function setup() {
	const onInsert = vi.fn();
	const onCancel = vi.fn();
	render(<SketchPad onInsert={onInsert} onCancel={onCancel} />);
	// Portaled to document.body: the dialog pad is the last body child.
	const pad = screen.getByRole("dialog");
	const canvas = pad.querySelector("canvas") as HTMLCanvasElement;
	const confirmBtn = screen.getByTitle("完成") as HTMLButtonElement;
	return { onInsert, onCancel, pad, canvas, confirmBtn };
}

function drawStroke(
	canvas: HTMLCanvasElement,
	from = { x: 10, y: 10 },
	to = { x: 40, y: 30 },
) {
	fireEvent.pointerDown(canvas, {
		button: 0,
		pointerId: 1,
		clientX: from.x,
		clientY: from.y,
	});
	fireEvent.pointerMove(canvas, { pointerId: 1, clientX: to.x, clientY: to.y });
	fireEvent.pointerUp(canvas, { pointerId: 1, clientX: to.x, clientY: to.y });
}

describe("SketchPad", () => {
	it("renders the pad with tool pill, palette, slider and confirm", () => {
		setup();
		expect(screen.getByRole("dialog")).toBeTruthy();
		// Five tool slots.
		for (const label of ["选择", "画笔", "文字", "形状", "橡皮擦"]) {
			expect(screen.getByTitle(label)).toBeTruthy();
		}
		expect(screen.getByTitle("撤销")).toBeTruthy();
		expect(screen.getByTitle("重做")).toBeTruthy();
		expect(screen.getByTitle("关闭")).toBeTruthy();
		// Palette: rainbow + 13 swatches = 14 round buttons.
		expect(screen.getByTitle("自定义颜色")).toBeTruthy();
		expect(screen.getAllByTitle(/^#/).length).toBe(13);
		// Brush slider + confirm.
		expect(screen.getByRole("slider")).toBeTruthy();
		expect(screen.getByTitle("完成")).toBeTruthy();
	});

	it("confirm is disabled until the canvas has ink", () => {
		const { canvas, confirmBtn } = setup();
		expect(confirmBtn.disabled).toBe(true);
		drawStroke(canvas);
		expect(confirmBtn.disabled).toBe(false);
	});

	it("confirm calls onInsert with a PNG data URL", () => {
		const { onInsert, canvas, confirmBtn } = setup();
		drawStroke(canvas);
		fireEvent.click(confirmBtn);
		expect(onInsert).toHaveBeenCalledTimes(1);
		expect(onInsert.mock.calls[0][0]).toMatch(/^data:image\/png/);
	});

	it("X and Escape call onCancel", () => {
		const { onCancel } = setup();
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByTitle("关闭"));
		expect(onCancel).toHaveBeenCalledTimes(2);
	});

	it("undo/redo reflect history state", () => {
		const { canvas } = setup();
		const undoBtn = screen.getByTitle("撤销") as HTMLButtonElement;
		const redoBtn = screen.getByTitle("重做") as HTMLButtonElement;
		expect(undoBtn.disabled).toBe(true);
		expect(redoBtn.disabled).toBe(true);

		drawStroke(canvas);
		expect(undoBtn.disabled).toBe(false);

		fireEvent.click(undoBtn);
		expect(redoBtn.disabled).toBe(false);
		fireEvent.click(redoBtn);
		expect(redoBtn.disabled).toBe(true);
	});

	it("text tool commits an item on Enter without closing the pad", () => {
		const { onCancel, canvas, confirmBtn } = setup();
		fireEvent.click(screen.getByTitle("文字"));
		fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 60 });
		fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 60, clientY: 60 });

		const input = screen.getByRole("textbox") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "你好" } });
		fireEvent.keyDown(input, { key: "Enter" });
		expect(confirmBtn.disabled).toBe(false);
		expect(onCancel).not.toHaveBeenCalled();
	});

	it("Escape inside the text input only cancels the input", () => {
		const { onCancel, canvas } = setup();
		fireEvent.click(screen.getByTitle("文字"));
		fireEvent.pointerDown(canvas, { button: 0, clientX: 60, clientY: 60 });
		fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 60, clientY: 60 });
		const input = screen.getByRole("textbox") as HTMLInputElement;
		fireEvent.keyDown(input, { key: "Escape" });
		expect(screen.queryByRole("textbox")).toBeNull();
		expect(onCancel).not.toHaveBeenCalled();
		// The pad is still open and armed: Esc now reaches onCancel.
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("eraser drag removes a stroke and undo restores it", () => {
		const { canvas, confirmBtn } = setup();
		drawStroke(canvas, { x: 10, y: 50 }, { x: 60, y: 50 });
		expect(confirmBtn.disabled).toBe(false);

		fireEvent.click(screen.getByTitle("橡皮擦"));
		fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 30, clientY: 52 });
		fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 45, clientY: 52 });
		fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 45, clientY: 52 });
		expect(confirmBtn.disabled).toBe(true);

		fireEvent.click(screen.getByTitle("撤销"));
		expect(confirmBtn.disabled).toBe(false);
	});

	it("select tool drags a stroke and commits one move op", () => {
		const { canvas } = setup();
		drawStroke(canvas, { x: 100, y: 100 }, { x: 140, y: 100 });
		fireEvent.click(screen.getByTitle("选择"));

		fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 140, clientY: 100 });
		fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 160, clientY: 130 });
		fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 160, clientY: 130 });

		// One move op is undoable; a second undo would be a no-op.
		const undoBtn = screen.getByTitle("撤销") as HTMLButtonElement;
		fireEvent.click(undoBtn);
		expect(undoBtn.disabled).toBe(false); // still has the stroke-add op
		fireEvent.click(undoBtn);
		expect(undoBtn.disabled).toBe(true);
	});

	it("shapes popover picks a shape and drag commits it", () => {
		const { canvas, confirmBtn } = setup();
		fireEvent.click(screen.getByTitle("形状"));
		expect(screen.getByTitle("矩形")).toBeTruthy();
		fireEvent.click(screen.getByTitle("椭圆"));

		fireEvent.pointerDown(canvas, { button: 0, pointerId: 1, clientX: 50, clientY: 50 });
		fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 120, clientY: 90 });
		fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 120, clientY: 90 });
		expect(confirmBtn.disabled).toBe(false);
	});

	it("does not crash when getContext returns null", () => {
		vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
		const { canvas, confirmBtn } = setup();
		drawStroke(canvas);
		expect(confirmBtn.disabled).toBe(false);
	});
});
