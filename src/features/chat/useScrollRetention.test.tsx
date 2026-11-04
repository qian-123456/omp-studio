// @vitest-environment jsdom
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useScrollRetention } from "./useScrollRetention";

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	Reflect.deleteProperty(document, "caretRangeFromPoint");
	document.body.replaceChildren();
});

function setup(preserve = true) {
	const scroller = document.createElement("div");
	const paragraph = document.createElement("p");
	paragraph.textContent = "A long paragraph whose selected character moves between wrapped lines. ".repeat(20);
	scroller.append(paragraph);
	document.body.append(scroller);
	const text = paragraph.firstChild as Text;
	let width = 900;
	let documentY = 890;
	scroller.scrollTop = 500;
	Object.defineProperties(scroller, {
		clientWidth: { get: () => width },
		clientHeight: { get: () => 600 },
	});
	scroller.getBoundingClientRect = () => ({ left: 0, top: 100, width, height: 600 }) as DOMRect;
	const caret = document.createRange();
	caret.setStart(text, 105);
	caret.collapse(true);
	Object.defineProperty(document, "caretRangeFromPoint", { configurable: true, value: () => caret });
	const getRects = vi.fn(function (this: Range) {
		expect(this.startContainer).toBe(text);
		expect(this.startOffset).toBe(105);
		return [{ top: documentY - scroller.scrollTop }] as unknown as DOMRectList;
	});
	Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: getRects });
	let resize!: ResizeObserverCallback;
	vi.stubGlobal("ResizeObserver", class {
		constructor(callback: ResizeObserverCallback) { resize = callback; }
		observe() {}
		disconnect() {}
	});
	let frame: FrameRequestCallback | null = null;
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frame = callback; return 1; });
	vi.stubGlobal("cancelAnimationFrame", () => { frame = null; });
	renderHook(() => useScrollRetention({ current: scroller }, "session", () => preserve));
	return {
		scroller,
		reflow(delta: number) {
			width = 600;
			documentY += delta;
			resize([], {} as ResizeObserver);
		},
		settle(delta = 0) {
			documentY += delta;
			frame?.(0);
		},
	};
}

describe("reading position through sidebar reflow", () => {
	it("keeps the same character at the viewport midpoint after wrapping and virtual measurement", () => {
		const fixture = setup();
		fixture.reflow(180);
		expect(fixture.scroller.scrollTop).toBe(680);
		fixture.settle(60);
		expect(fixture.scroller.scrollTop).toBe(740);
	});

	it("leaves live-tail following in control of the scroll position", () => {
		const fixture = setup(false);
		fixture.reflow(180);
		fixture.settle();
		expect(fixture.scroller.scrollTop).toBe(500);
	});

	it("does not undo a reader's new scroll after the resize", () => {
		const fixture = setup();
		fixture.reflow(180);
		fixture.scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: -80 }));
		fixture.scroller.scrollTop = 600;
		fixture.scroller.dispatchEvent(new Event("scroll"));
		fixture.settle();
		expect(fixture.scroller.scrollTop).toBe(600);
	});
});
