// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { useComposer } from "../../stores/composer";
import { SelectionToolbar } from "./SelectionToolbar";

// sessions/ui stores pull in Tauri plumbing; the toolbar only reads these slots.
const h = vi.hoisted(() => ({
	sessions: {} as Record<string, { forkDepth: number; kind?: "side" | "fork" | null }>,
	openChild: {} as Record<string, string>,
	openNewSideChat: vi.fn(),
	revealSideChat: vi.fn(),
	setOpenChild: vi.fn(),
	saveClipboardImage: vi.fn(async (_base64: string) => "/clip/pasted.png"),
}));
vi.mock("../../stores/sessions", () => ({
	useSessions: (selector: (s: { sessions: typeof h.sessions }) => unknown) =>
		selector({ sessions: h.sessions }),
}));
vi.mock("../sidechat/viewStore", () => ({
	useSideChatView: {
		getState: () => ({ openChild: h.openChild, setOpenChild: h.setOpenChild }),
		subscribe: () => () => {},
	},
	isBlankTab: (id: string) => id.startsWith("new:"),
	openNewSideChat: h.openNewSideChat,
	revealSideChat: h.revealSideChat,
}));

const setRightTab = vi.fn();
const openModal = vi.fn();
vi.mock("../../stores/ui", () => ({
	useUi: Object.assign(
		(
			selector: (s: {
				setRightTab: typeof setRightTab;
				openModal: typeof openModal;
			}) => unknown,
		) => selector({ setRightTab, openModal }),
		{ subscribe: () => () => {}, getState: () => ({ setRightTab, openModal }) },
	),
}));

vi.mock("../../lib/ipc", () => ({
	saveClipboardImage: h.saveClipboardImage,
	importImageFile: vi.fn(async (p: string) => p),
	clipboardFilePaths: vi.fn(async () => []),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

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
	h.sessions = {};
	h.openChild = {};
});

afterEach(cleanup);

const STREAM_TEXT = "hello world from transcript";

function Host({ sessionId = "sess-1", compact = false }: { sessionId?: string; compact?: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	return (
		<div>
			<div ref={ref} data-testid="stream">
				<div id="msg-42">{STREAM_TEXT}</div>
			</div>
			<SelectionToolbar sessionId={sessionId} containerRef={ref} compact={compact} />
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

describe("SelectionToolbar actions", () => {
	it("clicking 记到收集箱 opens quick-capture modal and discards bubble", () => {
		render(<Host />);
		selectRange(6, 11);
		const btn = screen.getByRole("button", { name: "记到收集箱" });
		expect(btn).toBeTruthy();
		fireEvent.click(btn);
		expect(openModal).toHaveBeenCalledWith("quick-capture", { text: "world", sessionId: "sess-1" });
		expect(screen.queryByRole("button", { name: "记到收集箱" })).toBeNull();
	});
});

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

	it("main selection: choosing 辅助对话 stages for the side chat and reveals a blank new tab", () => {
		render(<Host />);
		const ta = openCommentBox();
		fireEvent.click(screen.getByRole("radio", { name: "辅助对话" }));
		expect(useComposer.getState().annotationTarget).toBe("sidechat");
		expect(localStorage.getItem("ompws:annotation-target")).toBe("sidechat");
		fireEvent.change(ta, { target: { value: "侧聊批注" } });
		fireEvent.click(screen.getByRole("button", { name: "确认批注" }));
		expect(annsOf("sidechat:sess-1")).toHaveLength(1);
		expect(annsOf("sidechat:sess-1")[0].comment).toBe("侧聊批注");
		expect(annsOf("sess-1")).toBeUndefined();
		expect(h.openNewSideChat).toHaveBeenCalledWith("sess-1");
	});

	it("main selection: reuses the open side-chat thread's composer", () => {
		h.openChild = { "sess-1": "child-9" };
		useComposer.getState().setAnnotationTarget("sidechat");
		render(<Host />);
		const ta = openCommentBox();
		fireEvent.change(ta, { target: { value: "x" } });
		fireEvent.click(screen.getByRole("button", { name: "确认批注" }));
		expect(annsOf("child-9")).toHaveLength(1);
		expect(h.setOpenChild).toHaveBeenCalledWith("sess-1", "child-9");
		expect(h.revealSideChat).toHaveBeenCalled();
		expect(h.openNewSideChat).not.toHaveBeenCalled();
	});

	it("main selection defaults to the main composer", () => {
		render(<Host />);
		const ta = openCommentBox();
		expect(screen.getByRole("radio", { name: "主对话" })).toBeTruthy();
		fireEvent.change(ta, { target: { value: "主" } });
		fireEvent.click(screen.getByRole("button", { name: "确认批注" }));
		expect(annsOf("sess-1")).toHaveLength(1);
		expect(h.openNewSideChat).not.toHaveBeenCalled();
	});

	it("selection inside the right-panel side chat shows no chooser and stages into its own session", () => {
		h.sessions = { "sess-1": { forkDepth: 1, kind: "side" } };
		useComposer.getState().setAnnotationTarget("sidechat");
		render(<Host compact />);
		const ta = openCommentBox();
		expect(screen.queryByRole("radio")).toBeNull();
		fireEvent.change(ta, { target: { value: "当前对话批注" } });
		fireEvent.click(screen.getByRole("button", { name: "确认批注" }));
		expect(annsOf("sess-1")).toHaveLength(1);
		expect(annsOf("sess-1")[0].comment).toBe("当前对话批注");
		expect(annsOf("sidechat:sess-1")).toBeUndefined();
		expect(h.openNewSideChat).not.toHaveBeenCalled();
		expect(h.revealSideChat).not.toHaveBeenCalled();
	});

	it("a side-chat session shown in the main area still offers the target choice", () => {
		h.sessions = { "sess-1": { forkDepth: 1, kind: "side" } };
		render(<Host />);
		openCommentBox();
		expect(screen.getAllByRole("radio").length).toBe(2);
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

describe("streaming selection anchors", () => {
	it("does not persist the transient live-answer DOM id as a real message id", () => {
		render(<Host />);
		screen.getByText(STREAM_TEXT).id = "msg-live-answer";
		const ta = openCommentBox();
		fireEvent.change(ta, { target: { value: "streaming quote" } });
		fireEvent.click(screen.getByRole("button", { name: "确认批注" }));
		expect(annsOf("sess-1")[0].text).toBe("world");
		expect(annsOf("sess-1")[0].itemId).toBeUndefined();
	});
});

describe("comment image draft", () => {
	/** Paste a screenshot, then wait until the saved image shows as a thumbnail (FileReader + save are async). */
	const pasteImage = async (ta: HTMLTextAreaElement) => {
		fireEvent.paste(ta, {
			clipboardData: {
				types: ["Files"],
				items: [{ kind: "file", getAsFile: () => new File(["x"], "s.png", { type: "image/png" }) }],
			},
		});
		await waitFor(() => expect(screen.getByAltText("批注图片")).toBeTruthy());
	};

	it("marks the open bubble and keeps draft + pasted image across a parent rerender", async () => {
		const { rerender } = render(<Host />);
		const ta = openCommentBox();
		fireEvent.change(ta, { target: { value: "带图批注" } });
		await pasteImage(ta);
		expect(screen.getByAltText("批注图片")).toBeTruthy();
		expect(document.querySelector('[data-selection-toolbar-active="true"]')).not.toBeNull();

		// Tool completion / streaming update: the parent re-renders with new content.
		rerender(<Host />);
		expect((screen.getByRole("textbox", { name: "添加批注" }) as HTMLTextAreaElement).value).toBe("带图批注");
		expect(screen.getByAltText("批注图片")).toBeTruthy();

		fireEvent.keyDown(screen.getByRole("textbox", { name: "添加批注" }), { key: "Enter" });
		expect(annsOf("sess-1")[0].images).toEqual(["/clip/pasted.png"]);
		expect(document.querySelector('[data-selection-toolbar-active="true"]')).toBeNull();
	});

	it("an image-only annotation survives click-away and can drop the image again", async () => {
		render(<Host />);
		const ta = openCommentBox();
		await pasteImage(ta);
		fireEvent.click(screen.getByRole("button", { name: "移除图片" }));
		expect(screen.queryByAltText("批注图片")).toBeNull();
		await pasteImage(ta);
		fireEvent.mouseDown(document.body);
		fireEvent.mouseUp(document.body);
		expect(annsOf("sess-1")).toHaveLength(1);
		expect(annsOf("sess-1")[0].images).toEqual(["/clip/pasted.png"]);
		expect(annsOf("sess-1")[0].comment).toBeUndefined();
	});

	/** Start a paste whose save stays pending until the returned `release(path)` is called. */
	const pasteDeferred = async (ta: HTMLTextAreaElement) => {
		let release!: (path: string) => void;
		// Executor form on purpose: the project's TS target has no Promise.withResolvers (see sideChatAttachments).
		h.saveClipboardImage.mockImplementationOnce(
			() => new Promise<string>((resolve) => (release = resolve)),
		);
		const before = h.saveClipboardImage.mock.calls.length;
		fireEvent.paste(ta, {
			clipboardData: {
				types: ["Files"],
				items: [{ kind: "file", getAsFile: () => new File(["x"], "s.png", { type: "image/png" }) }],
			},
		});
		await waitFor(() => expect(h.saveClipboardImage.mock.calls.length).toBe(before + 1));
		return (path: string) => act(async () => release(path));
	};

	it("Enter while the image is still saving waits, then stages the comment with that image", async () => {
		render(<Host />);
		const ta = openCommentBox();
		fireEvent.change(ta, { target: { value: "等图" } });
		const release = await pasteDeferred(ta);
		fireEvent.keyDown(ta, { key: "Enter" });
		// Nothing staged yet and the box is still open.
		expect(annsOf("sess-1")).toBeUndefined();
		expect(screen.getByRole("textbox", { name: "添加批注" })).toBeTruthy();
		await release("/clip/late.png");
		expect(annsOf("sess-1")).toHaveLength(1);
		expect(annsOf("sess-1")[0]).toMatchObject({ comment: "等图", images: ["/clip/late.png"] });
		expect(screen.queryByRole("textbox", { name: "添加批注" })).toBeNull();
	});

	it("click-away while the image is still saving keeps the bubble open and stages once it lands", async () => {
		render(<Host />);
		const ta = openCommentBox();
		const release = await pasteDeferred(ta);
		fireEvent.mouseDown(document.body);
		fireEvent.mouseUp(document.body);
		expect(annsOf("sess-1")).toBeUndefined();
		await release("/clip/late.png");
		expect(annsOf("sess-1")).toHaveLength(1);
		expect(annsOf("sess-1")[0].images).toEqual(["/clip/late.png"]);
	});

	it("Esc discards and invalidates the pending image: a later selection never receives it", async () => {
		render(<Host />);
		const ta = openCommentBox();
		const release = await pasteDeferred(ta);
		fireEvent.keyDown(ta, { key: "Escape" });
		expect(screen.queryByRole("textbox", { name: "添加批注" })).toBeNull();
		const next = openCommentBox();
		await release("/clip/stale.png");
		expect(screen.queryByAltText("批注图片")).toBeNull();
		fireEvent.change(next, { target: { value: "新批注" } });
		fireEvent.keyDown(next, { key: "Enter" });
		expect(annsOf("sess-1")).toHaveLength(1);
		expect(annsOf("sess-1")[0].images).toBeUndefined();
	});

	it("overlapping pastes: Enter waits for both", async () => {
		render(<Host />);
		const ta = openCommentBox();
		const releaseA = await pasteDeferred(ta);
		const releaseB = await pasteDeferred(ta);
		fireEvent.keyDown(ta, { key: "Enter" });
		await releaseA("/clip/a.png");
		expect(annsOf("sess-1")).toBeUndefined();
		await releaseB("/clip/b.png");
		expect(annsOf("sess-1")[0].images).toEqual(["/clip/a.png", "/clip/b.png"]);
	});
});
