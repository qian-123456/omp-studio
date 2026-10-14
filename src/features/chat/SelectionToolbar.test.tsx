// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sideChatAnnKey, useComposer } from "../../stores/composer";
import { SelectionToolbar } from "./SelectionToolbar";

// sessions/ui stores pull in Tauri plumbing; the toolbar only reads these slots.
vi.mock("../../stores/sessions", () => ({
	useSessions: (
		selector: (s: { sessions: Record<string, { forkDepth: number }> }) => unknown,
	) => selector({ sessions: {} }),
}));

const setRightTab = vi.fn();
const openModal = vi.fn();
vi.mock("../../stores/ui", () => ({
	useUi: (
		selector: (s: {
			setRightTab: typeof setRightTab;
			openModal: typeof openModal;
		}) => unknown,
	) => selector({ setRightTab, openModal }),
}));

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
	// jsdom older builds may miss Range rects.
	if (typeof Range.prototype.getBoundingClientRect !== "function") {
		Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 10, 10);
	}
});

beforeEach(() => {
	vi.clearAllMocks();
	localStorage.clear();
	useComposer.setState({ annotations: {}, focusNonce: {}, annotationTarget: "main" });
});

afterEach(cleanup);

const STREAM_TEXT = "hello world from transcript";

function Host() {
	const ref = useRef<HTMLDivElement>(null);
	return (
		<div>
			<div ref={ref} data-testid="stream">
				<div id="msg-42">{STREAM_TEXT}</div>
			</div>
			<SelectionToolbar sessionId="sess-1" containerRef={ref} />
		</div>
	);
}

/** Select `start..end` of the message text: press inside the stream, mark the
 *  range, lift the mouse — the same gesture a real user makes. */
function selectRange(start: number, end: number) {
	const stream = screen.getByTestId("stream");
	fireEvent.mouseDown(stream);
	const node = screen.getByText(STREAM_TEXT).firstChild!;
	const range = document.createRange();
	range.setStart(node, start);
	range.setEnd(node, end);
	const sel = window.getSelection()!;
	sel.removeAllRanges();
	sel.addRange(range);
	fireEvent.mouseUp(stream);
}
function openCommentBox(): HTMLTextAreaElement {
	selectRange(6, 11);
	fireEvent.click(screen.getByRole("button", { name: "批注" }));
	return screen.getByRole("textbox", { name: "添加批注" }) as HTMLTextAreaElement;
}

const annsOf = (key: string) => useComposer.getState().annotations[key];

describe("SelectionToolbar comment box", () => {
	it("is a multi-line textarea; Shift+Enter stays a newline, Enter sends", () => {
		render(<Host />);
		const ta = openCommentBox();
		expect(ta.tagName).toBe("TEXTAREA");

		fireEvent.change(ta, { target: { value: "第一行" } });
		fireEvent.keyDown(ta, { key: "Enter", shiftKey: true });
		// Shift+Enter neither sends nor closes the box.
		expect(annsOf("sess-1")).toBeUndefined();
		expect(screen.getByRole("textbox", { name: "添加批注" })).toBeTruthy();

		fireEvent.change(ta, { target: { value: "第一行\n第二行\n第三行" } });
		fireEvent.keyDown(ta, { key: "Enter" });
		const anns = annsOf("sess-1");
		expect(anns).toHaveLength(1);
		expect(anns[0].comment).toBe("第一行\n第二行\n第三行");
		expect(anns[0].text).toBe("world");
		expect(anns[0].itemId).toBe("42");
		expect(anns[0].source).toBe("message");
		// Send focuses the destination composer and closes the bubble.
		expect(useComposer.getState().focusNonce["sess-1"]).toBe(1);
		expect(screen.queryByRole("textbox", { name: "添加批注" })).toBeNull();
	});

	it("auto-grows with the text up to the height cap, then scrolls", () => {
		render(<Host />);
		const ta = openCommentBox();
		Object.defineProperty(ta, "scrollHeight", { configurable: true, value: 40 });
		fireEvent.change(ta, { target: { value: "短" } });
		expect(ta.style.height).toBe("40px");
		expect(ta.style.overflowY).toBe("hidden");

		Object.defineProperty(ta, "scrollHeight", { configurable: true, value: 500 });
		fireEvent.change(ta, { target: { value: "长".repeat(200) } });
		expect(ta.style.height).toBe("160px");
		expect(ta.style.overflowY).toBe("auto");
	});

	it("stages a non-empty comment into the main composer on click-away, exactly once", () => {
		render(<Host />);
		const ta = openCommentBox();
		fireEvent.change(ta, { target: { value: "记住这条\n细节" } });

		// Clicking elsewhere in the stream dismisses the box…
		fireEvent.mouseDown(screen.getByTestId("stream"));
		fireEvent.mouseUp(screen.getByTestId("stream"));
		const anns = annsOf("sess-1");
		expect(anns).toHaveLength(1);
		expect(anns[0].comment).toBe("记住这条\n细节");
		expect(anns[0].text).toBe("world");
		expect(anns[0].itemId).toBe("42");
		// …quietly: no focus steal, no right-tab switch.
		expect(setRightTab).not.toHaveBeenCalled();
		expect(screen.queryByRole("textbox", { name: "添加批注" })).toBeNull();

		// A press fully outside the stream also stages — and still only once.
		openCommentBox();
		fireEvent.change(screen.getByRole("textbox", { name: "添加批注" }), {
			target: { value: "again" },
		});
		fireEvent.mouseDown(document.body);
		fireEvent.mouseUp(document.body);
		expect(annsOf("sess-1")).toHaveLength(2);
	});

	it("stages into the side-chat key when that destination is selected", () => {
		useComposer.getState().setAnnotationTarget("sidechat");
		render(<Host />);
		const ta = openCommentBox();
		fireEvent.change(ta, { target: { value: "侧聊批注" } });
		fireEvent.mouseDown(screen.getByTestId("stream"));
		const key = sideChatAnnKey("sess-1");
		expect(annsOf(key)).toHaveLength(1);
		expect(annsOf(key)[0].comment).toBe("侧聊批注");
		expect(annsOf("sess-1")).toBeUndefined();
	});

	it("Esc discards the typed comment instead of staging it", () => {
		render(<Host />);
		const ta = openCommentBox();
		fireEvent.change(ta, { target: { value: "丢弃我" } });
		fireEvent.keyDown(document.activeElement!, { key: "Escape" });
		expect(annsOf("sess-1")).toBeUndefined();
		expect(screen.queryByRole("textbox", { name: "添加批注" })).toBeNull();
	});

	it("empty box dismissal stages nothing; send then click-away does not double-stage", () => {
		render(<Host />);
		openCommentBox();
		// No text typed: plain dismissal.
		fireEvent.mouseDown(document.body);
		expect(annsOf("sess-1")).toBeUndefined();

		const ta = openCommentBox();
		fireEvent.change(ta, { target: { value: "once" } });
		fireEvent.keyDown(ta, { key: "Enter" });
		expect(annsOf("sess-1")).toHaveLength(1);
		// Follow-up press outside must not re-stage the sent comment.
		fireEvent.mouseDown(document.body);
		fireEvent.mouseUp(document.body);
		expect(annsOf("sess-1")).toHaveLength(1);
	});
});
