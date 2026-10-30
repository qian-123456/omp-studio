// @vitest-environment jsdom
/** Rail hover: the preview card opens after a delay, never while selecting text, and brushing past cancels it. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { emptySessionLive, useLive } from "../../stores/live";
import { ChatTrace } from "./ChatTrace";

const user = (n: number) =>
	({
		id: `u${n}`,
		parentId: null,
		ts: new Date().toISOString(),
		kind: "user",
		text: `question number ${n}`,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
	}) as TranscriptItem;

const mount = () => {
	const scrollRef = createRef<HTMLDivElement>();
	return render(
		<div ref={scrollRef}>
			<ChatTrace sessionId="s1" scrollRef={scrollRef} />
		</div>,
	);
};

const dash = (i: number) => screen.getAllByRole("button")[i];

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000);
	vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(400);
	useLive.setState({
		sessions: { s1: { ...emptySessionLive(), items: [1, 2, 3, 4].map(user) } },
	});
});

afterEach(() => {
	cleanup();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("ChatTrace hover preview", () => {
	it("opens only after the hover delay", () => {
		mount();
		fireEvent.pointerEnter(dash(1));
		act(() => void vi.advanceTimersByTime(150));
		expect(screen.queryByText("question number 2")).toBeNull();
		act(() => void vi.advanceTimersByTime(100));
		expect(screen.getByText("question number 2")).toBeTruthy();
	});

	it("brushing past the rail (leave before the delay) never opens the card", () => {
		mount();
		fireEvent.pointerEnter(dash(1));
		act(() => void vi.advanceTimersByTime(100));
		fireEvent.pointerLeave(dash(1).closest("div.pointer-events-auto") as HTMLElement);
		act(() => void vi.advanceTimersByTime(500));
		expect(screen.queryByText("question number 2")).toBeNull();
	});

	it("does not open while a text selection exists", () => {
		vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
		mount();
		fireEvent.pointerEnter(dash(1));
		act(() => void vi.advanceTimersByTime(500));
		expect(screen.queryByText("question number 2")).toBeNull();
	});


	it("a press after the hover started cancels the pending open", () => {
		mount();
		fireEvent.pointerEnter(dash(1));
		act(() => void vi.advanceTimersByTime(100));
		fireEvent.pointerDown(document.body);
		act(() => void vi.advanceTimersByTime(500));
		expect(screen.queryByText("question number 2")).toBeNull();
	});

	it("a press closes an already open card immediately", () => {
		mount();
		fireEvent.pointerEnter(dash(1));
		act(() => void vi.advanceTimersByTime(250));
		expect(screen.getByText("question number 2")).toBeTruthy();
		fireEvent.pointerDown(document.body);
		expect(screen.queryByText("question number 2")).toBeNull();
	});

	it("a new selection closes an already open card immediately", () => {
		mount();
		fireEvent.pointerEnter(dash(1));
		act(() => void vi.advanceTimersByTime(250));
		vi.spyOn(window, "getSelection").mockReturnValue({ isCollapsed: false } as Selection);
		act(() => void document.dispatchEvent(new Event("selectionchange")));
		expect(screen.queryByText("question number 2")).toBeNull();
	});
	it("does not open while a mouse button is held", () => {
		mount();
		fireEvent.pointerEnter(dash(1), { buttons: 1 });
		act(() => void vi.advanceTimersByTime(500));
		expect(screen.queryByText("question number 2")).toBeNull();
	});
});
