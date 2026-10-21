// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { type Annotation, useComposer } from "../../stores/composer";
import { AnnotationHoverCard, AnnotationNotePopover } from "./AnnotationNotePopover";

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
});

const ann = (id: string, comment?: string): Annotation => ({
	id,
	source: "message",
	itemId: "item-1",
	text: `quote ${id}`,
	comment,
});
const anchor = new DOMRect(10, 10, 20, 20);

beforeEach(() => {
	useComposer.setState({ annotations: { s1: [ann("a1", "old"), ann("a2", "other")] } });
});
afterEach(cleanup);

const mount = (onClose = vi.fn(), scrollTarget?: HTMLElement) => {
	render(
		<AnnotationNotePopover
			anchor={anchor}
			storeKey="s1"
			annotation={ann("a1", "old")}
			n={1}
			scrollTarget={scrollTarget}
			onClose={onClose}
		/>,
	);
	return onClose;
};

describe("AnnotationNotePopover", () => {
	it("shows only the clicked annotation", () => {
		mount();
		expect(screen.getByText("quote a1")).toBeTruthy();
		expect(screen.queryByText("quote a2")).toBeNull();
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("old");
		expect(screen.getByText("删除")).toBeTruthy();
	});

	it("saves on outside mousedown", () => {
		const onClose = mount();
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "新的" } });
		fireEvent.mouseDown(document.body);
		expect(useComposer.getState().annotations.s1[0].comment).toBe("新的");
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("discards on Escape", () => {
		const onClose = mount();
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "新的" } });
		fireEvent.keyDown(document, { key: "Escape" });
		expect(useComposer.getState().annotations.s1[0].comment).toBe("old");
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("saves when the thread scrolls", () => {
		const scroller = document.createElement("div");
		const onClose = mount(vi.fn(), scroller);
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "滚动" } });
		act(() => {
			scroller.dispatchEvent(new Event("scroll"));
		});
		expect(useComposer.getState().annotations.s1[0].comment).toBe("滚动");
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("deletes only that annotation", () => {
		const onClose = mount();
		fireEvent.click(screen.getByText("删除"));
		expect(useComposer.getState().annotations.s1.map((a) => a.id)).toEqual(["a2"]);
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});

describe("AnnotationHoverCard", () => {
	it("shows the quote and note read-only", () => {
		render(<AnnotationHoverCard anchor={anchor} annotation={ann("a1", "我的批注")} n={2} />);
		expect(screen.getByText("quote a1")).toBeTruthy();
		expect(screen.getByText("批注：我的批注")).toBeTruthy();
		expect(screen.queryByRole("textbox")).toBeNull();
	});
});
