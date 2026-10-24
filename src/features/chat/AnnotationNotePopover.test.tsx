// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
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

	it("saves on outside pointerdown", () => {
		const onClose = mount();
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "新的" } });
		fireEvent.pointerDown(document.body);
		expect(useComposer.getState().annotations.s1[0].comment).toBe("新的");
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("saves once and closes when the confirm button is clicked", () => {
		const onClose = mount();
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "点击确认" } });
		const btn = screen.getByRole("button", { name: "确认批注" });
		fireEvent.pointerDown(btn);
		fireEvent.click(btn);
		expect(useComposer.getState().annotations.s1[0].comment).toBe("点击确认");
		expect(useComposer.getState().annotations.s1).toHaveLength(2);
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

	it("still closes on outside pointerdown after the scroll target appears (re-run of effects)", () => {
		const onClose = vi.fn();
		const el = (t?: HTMLElement) => (
			<AnnotationNotePopover
				anchor={anchor}
				storeKey="s1"
				annotation={ann("a1", "old")}
				n={1}
				scrollTarget={t}
				onClose={onClose}
			/>
		);
		const { rerender } = render(el(undefined));
		rerender(el(document.createElement("div")));
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "保留" } });
		fireEvent.pointerDown(document.body);
		expect(useComposer.getState().annotations.s1[0].comment).toBe("保留");
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("closes on outside pointerdown under StrictMode", () => {
		const onClose = vi.fn();
		render(
			<StrictMode>
				<AnnotationNotePopover
					anchor={anchor}
					storeKey="s1"
					annotation={ann("a1", "old")}
					n={1}
					onClose={onClose}
				/>
			</StrictMode>,
		);
		fireEvent.pointerDown(document.body);
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not close on pointerdown inside the (portaled) popover", () => {
		const onClose = mount();
		fireEvent.pointerDown(screen.getByRole("textbox"));
		fireEvent.pointerDown(screen.getByTestId("annotation-note-popover"));
		expect(onClose).not.toHaveBeenCalled();
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
