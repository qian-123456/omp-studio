// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Annotation } from "../../stores/composer";
import { useComposer } from "../../stores/composer";
import { AnnotationChip } from "./AnnotationChip";

const scrollToItem = vi.fn();

// The live store drags in Tauri event plumbing; only scrollToItem matters here.
vi.mock("../../stores/live", () => ({
	useLive: (selector: (s: { scrollToItem: typeof scrollToItem }) => unknown) =>
		selector({ scrollToItem }),
}));

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
});


afterEach(cleanup);
const ann = (id: string): Annotation => ({
	id,
	source: "message",
	itemId: "item-1",
	text: "quoted text",
});

/** Open the hover/focus popover so entry buttons render. */
const openPopover = () => {
	fireEvent.focusIn(screen.getByRole("button", { name: /^\d+ 条批注$/ }));
};

describe("AnnotationChip move button", () => {
	it("calls onMove with the annotation id", () => {
		const onMove = vi.fn();
		render(
			<AnnotationChip
				sessionId="sess-1"
				annotations={[ann("a1")]}
				onMove={onMove}
				moveLabel="移动到辅助对话"
			/>,
		);
		openPopover();
		fireEvent.click(
			screen.getByRole("button", { name: "移动到辅助对话" }),
		);
		expect(onMove).toHaveBeenCalledWith("a1");
		// Moving is not deleting: the store list is untouched.
		expect(useComposer.getState().annotations["sess-1"]).toBeUndefined();
	});

	it("hides the move button without onMove", () => {
		render(<AnnotationChip sessionId="sess-1" annotations={[ann("a1")]} />);
		openPopover();
		expect(screen.queryByRole("button", { name: /移动/ })).toBeNull();
	});

	it("locate uses anchorSessionId instead of the store key", () => {
		render(
			<AnnotationChip
				sessionId="sidechat:parent-1"
				anchorSessionId="parent-1"
				annotations={[ann("a1")]}
			/>,
		);
		openPopover();
		fireEvent.click(screen.getByRole("button", { name: "定位到原消息" }));
		expect(scrollToItem).toHaveBeenCalledWith("parent-1", "item-1");
	});
});

describe("AnnotationChip multi-line comment", () => {
	it("renders newlines in the saved comment", () => {
		const a: Annotation = { ...ann("a1"), comment: "第一行\n第二行" };
		render(<AnnotationChip sessionId="sess-1" annotations={[a]} />);
		openPopover();
		const shown = screen.getByText(/批注：/);
		expect(shown.textContent).toBe("批注：第一行\n第二行");
	});

	it("edits in a multi-line box: Enter saves, Shift+Enter does not", () => {
		const a: Annotation = { ...ann("a1"), comment: "旧批注" };
		useComposer.getState().addAnnotation("sess-1", a);
		const [stored] = useComposer.getState().annotations["sess-1"];
		render(<AnnotationChip sessionId="sess-1" annotations={[stored]} />);
		openPopover();
		fireEvent.click(screen.getByRole("button", { name: "编辑批注" }));
		const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
		expect(editor.tagName).toBe("TEXTAREA");

		fireEvent.change(editor, { target: { value: "第一行" } });
		fireEvent.keyDown(editor, { key: "Enter", shiftKey: true });
		// Shift+Enter stays a newline: nothing saved, editor still open.
		expect(useComposer.getState().annotations["sess-1"][0].comment).toBe("旧批注");
		expect(screen.getByRole("textbox")).toBeTruthy();

		fireEvent.change(editor, { target: { value: "第一行\n第二行" } });
		fireEvent.keyDown(editor, { key: "Enter" });
		expect(useComposer.getState().annotations["sess-1"][0].comment).toBe(
			"第一行\n第二行",
		);
	});
});
