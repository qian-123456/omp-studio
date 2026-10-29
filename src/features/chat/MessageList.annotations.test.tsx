// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Ipc from "../../lib/ipc";
import type * as Events from "../../lib/events";
import type { TranscriptItem } from "../../lib/contracts";
import { useComposer } from "../../stores/composer";
import { emptySessionLive, useLive } from "../../stores/live";
import { MessageList } from "./MessageList";
import { SelectionToolbar } from "./SelectionToolbar";
import { markerSources, measureMarkers } from "./AnnotationMarkers";
import { findQuoteRange, flashQuote, setQuoteOccurrenceHint } from "./annotationLocate";
import { splitAnswerText } from "./historyRows";

vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof Ipc>()),
	rpcSend: vi.fn(async () => ({})),
	privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "ok", nativeError: null })),
}));
vi.mock("../../lib/events", async (importOriginal) => ({
	...(await importOriginal<typeof Events>()),
	onPrivacyChanged: vi.fn(async () => () => {}),
}));

const quote = "主人真正需要感知的：";
const answer = Array.from({ length: 3 }, (_, i) =>
	`## Section ${i + 1}\n\n${quote}\n\n${"说明文字".repeat(450)}\n\nSection end`,
).join("\n\n");
const item = (id: string, kind: TranscriptItem["kind"], text: string): TranscriptItem => ({
	id, kind, text, parentId: null, ts: "2026-10-29T00:00:00Z", thinking: null,
	toolCalls: [], toolResult: null, usage: null, model: null, stopReason: "stop", hidden: false,
});

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
	if (!Range.prototype.getBoundingClientRect) Range.prototype.getBoundingClientRect = () => new DOMRect();
	vi.spyOn(Range.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(60, 100, 80, 20));
	Range.prototype.getClientRects = () => [new DOMRect(60, 100, 80, 20)] as unknown as DOMRectList;
	Element.prototype.scrollIntoView = vi.fn();
	useComposer.setState({ annotations: {}, focusNonce: {}, annotationTarget: "main" });
	useLive.setState({ sessions: { "annotation-slices": {
		...emptySessionLive(), items: [item("question", "user", "question"), item("answer", "assistant", answer)],
	} } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("split answer annotation anchors", () => {
	it("stages a later real MessageList slice and measures its saved marker and quote range", async () => {
		expect(splitAnswerText(answer).length).toBeGreaterThanOrEqual(3);
		const ref = createRef<HTMLDivElement>();
		const { container } = render(<div ref={ref}>
			<MessageList sessionId="annotation-slices" scrollRef={ref} />
			<SelectionToolbar sessionId="annotation-slices" containerRef={ref} />
		</div>);
		const roots = Array.from(container.querySelectorAll<HTMLElement>('[data-message-item-id="answer"]'));
		const root = roots.find((el) => Number(el.dataset.answerPart) === 2 && el.textContent?.includes(quote));
		expect(root).toBeDefined();
		const walker = document.createTreeWalker(root!, NodeFilter.SHOW_TEXT);
		let node: Text | null = null;
		while (walker.nextNode()) {
			if (walker.currentNode.textContent?.includes(quote)) node = walker.currentNode as Text;
		}
		expect(node).not.toBeNull();
		fireEvent.mouseDown(root!);
		const selection = window.getSelection()!;
		const selected = document.createRange();
		const offset = node!.textContent!.indexOf(quote);
		selected.setStart(node!, offset);
		selected.setEnd(node!, offset + quote.length);
		selection.removeAllRanges();
		selection.addRange(selected);
		fireEvent.mouseUp(root!);
		fireEvent.click(screen.getByRole("button", { name: "批注" }));
		fireEvent.change(screen.getByRole("textbox", { name: "添加批注" }), { target: { value: "later slice" } });
		fireEvent.click(screen.getByRole("button", { name: "确认批注" }));
		const annotation = useComposer.getState().annotations["annotation-slices"][0];
		expect(annotation.itemId).toBe("answer");
		expect(annotation.answerPart).toBe(Number(root!.dataset.answerPart));
		const ranges: Range[] = [];
		const markers = measureMarkers(ref.current!, markerSources([annotation], []), ranges);
		expect(markers).toHaveLength(1);
		expect(ranges[0].startContainer).toBe(node);
		expect(ranges[0].toString()).toBe(quote);
		setQuoteOccurrenceHint(annotation.itemId!, annotation.text, annotation.occurrence, annotation.answerPart);
		expect(findQuoteRange("answer", quote)?.startContainer).toBe(node);
		vi.stubGlobal("CSS", { highlights: new Map() });
		vi.stubGlobal("Highlight", class { constructor(..._ranges: Range[]) {} });
		setQuoteOccurrenceHint(annotation.itemId!, annotation.text, annotation.occurrence, annotation.answerPart);
		expect(await flashQuote("answer", quote, 1)).toBe(true);
		expect(CSS.highlights.has("annotation-locate")).toBe(true);
		await vi.waitFor(() => expect(CSS.highlights.has("annotation-locate")).toBe(false));
	});
});
