// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useGutterSelection } from "./gutterSelection";

function Thread() {
	const ref = useRef<HTMLDivElement>(null);
	useGutterSelection(ref);
	return <div ref={ref} data-testid="thread"><div data-index="0"><span>earlier</span></div><div data-index="1"><span>line text</span><button>action</button></div></div>;
}

const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, "getClientRects");
const originalCaret = Object.getOwnPropertyDescriptor(document, "caretRangeFromPoint");
afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	if (originalRects) Object.defineProperty(Range.prototype, "getClientRects", originalRects);
	else Reflect.deleteProperty(Range.prototype, "getClientRects");
	if (originalCaret) Object.defineProperty(document, "caretRangeFromPoint", originalCaret);
	else Reflect.deleteProperty(document, "caretRangeFromPoint");
});

describe("left gutter selection", () => {
	it("anchors a drag at the hit line while preserving native focus, including reverse selections", () => {
		const { getByTestId } = render(<Thread />);
		const root = getByTestId("thread");
		const rows = root.querySelectorAll<HTMLElement>("[data-index]");
		const previous = rows[0].querySelector("span")!.firstChild!;
		const line = rows[1].querySelector("span")!.firstChild!;
		vi.spyOn(root, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 200));
		vi.spyOn(rows[0], "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 300, 20));
		vi.spyOn(rows[1], "getBoundingClientRect").mockReturnValue(new DOMRect(0, 20, 300, 20));
		Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: () => [new DOMRect(100, 20, 80, 20)] });
		const anchor = document.createRange();
		anchor.setStart(line, 0);
		Object.defineProperty(document, "caretRangeFromPoint", { configurable: true, value: vi.fn(() => anchor) });
		const setBaseAndExtent = vi.fn();
		const selection = { anchorNode: previous, anchorOffset: 0, focusNode: line, focusOffset: 4, setBaseAndExtent } as unknown as Selection;
		vi.spyOn(window, "getSelection").mockReturnValue(selection);
		fireEvent.mouseDown(root, { button: 0, clientX: 88, clientY: 30 });
		fireEvent.mouseMove(window, { buttons: 1, clientX: 150, clientY: 30 });
		fireEvent(document, new Event("selectionchange"));
		expect(setBaseAndExtent).toHaveBeenLastCalledWith(line, 0, line, 4);
		Object.assign(selection, { focusNode: previous, focusOffset: 3 });
		fireEvent(document, new Event("selectionchange"));
		expect(setBaseAndExtent).toHaveBeenLastCalledWith(line, 0, previous, 3);
		fireEvent.blur(window);
		fireEvent(document, new Event("selectionchange"));
		expect(setBaseAndExtent).toHaveBeenCalledTimes(2);
	});

	it("does not intercept text and controls", () => {
		const { getByText } = render(<Thread />);
		const hit = vi.fn();
		Object.defineProperty(document, "caretRangeFromPoint", { configurable: true, value: hit });
		fireEvent.mouseDown(getByText("line text"), { button: 0, clientX: 88, clientY: 30 });
		fireEvent.mouseDown(getByText("action"), { button: 0, clientX: 88, clientY: 30 });
		expect(hit).not.toHaveBeenCalled();
	});
});
