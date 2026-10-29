// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { Annotation } from "../../stores/composer";
import { markerSources, measureMarkers } from "./AnnotationMarkers";

// AnnotationMarkers only touches useLive inside the marker onClick; the store
// itself pulls in Tauri event plumbing that node cannot load.
vi.mock("../../stores/live", () => ({
	useLive: { getState: () => ({ scrollToItem: () => {} }) },
}));

const msg = (id: string, text: string, comment?: string): Annotation => ({
	id,
	source: "message",
	itemId: `item-${id}`,
	text,
	comment,
});

describe("markerSources", () => {
	it("numbers main and side-chat annotations as separate lists", () => {
		const sources = markerSources(
			[msg("m1", "first quote"), msg("m2", "second quote")],
			[msg("s1", "side quote")],
		);
		expect(sources.map((s) => [s.kind, s.n])).toEqual([
			["main", 1],
			["main", 2],
			["sidechat", 1],
		]);
		expect(sources[0].title).toBe("批注 1：first quote");
		expect(sources[2].title).toBe("辅助对话批注 1：side quote");
	});

	it("renumbers each list after a move between them", () => {
		// Moving main annotation m2 to the side-chat list drops it there with a
		// new id; the remaining main marker renumbers and the side list counts up.
		const sources = markerSources(
			[msg("m1", "first quote")],
			[msg("s1", "side quote"), { ...msg("m2", "second quote"), id: "ann-moved" }],
		);
		expect(sources.map((s) => [s.id, s.kind, s.n])).toEqual([
			["m1", "main", 1],
			["s1", "sidechat", 1],
			["ann-moved", "sidechat", 2],
		]);
	});

	it("skips annotations with no message anchor", () => {
		const diff: Annotation = {
			id: "d1",
			source: "diff",
			file: "a.ts",
			lines: "1-2",
			text: "hunk",
		};
		expect(markerSources([diff, msg("m1", "q")], [])).toHaveLength(1);
	});
});

describe("slice marker measurement", () => {
	it("anchors the selected local occurrence regardless of other mounted parts", () => {
		const container = document.createElement("div");
		container.innerHTML = '<div id="msg-answer">repeat repeat</div><div id="msg-answer-answer-part-2">repeat repeat</div>';
		document.body.append(container);
		const rects = Range.prototype.getClientRects;
		Range.prototype.getClientRects = () => [new DOMRect(60, 100, 80, 20)] as unknown as DOMRectList;
		try {
			const source = markerSources([{ ...msg("a", "repeat"), itemId: "answer", answerPart: 2, occurrence: 1 }], []);
			const selected = document.getElementById("msg-answer-answer-part-2")!;
			const ranges: Range[] = [];
			expect(measureMarkers(container, source, ranges)).toHaveLength(1);
			expect(ranges[0].startContainer).toBe(selected.firstChild);
			expect(ranges[0].startOffset).toBe(7);
			document.getElementById("msg-answer")!.remove();
			const afterUnmount: Range[] = [];
			expect(measureMarkers(container, source, afterUnmount)).toHaveLength(1);
			expect(afterUnmount[0].startOffset).toBe(7);
			selected.remove();
			expect(measureMarkers(container, source, [])).toHaveLength(0);
			container.append(selected);
			expect(measureMarkers(container, source, [])).toHaveLength(1);
		} finally {
			Range.prototype.getClientRects = rects;
			container.remove();
		}
	});

	it.each([
		{ name: "syntax-highlighted line with its first token scrolled offscreen", rects: [new DOMRect(40, 100, 20, 20), new DOMRect(60, 100, 600, 20)], left: 90, top: 84 },
		{ name: "single text fragment extending beyond both scroller edges", rects: [new DOMRect(40, 100, 600, 20)], left: 90, top: 84 },
		{ name: "multi-line quote with its first line clipped vertically", rects: [new DOMRect(120, 40, 100, 20), new DOMRect(120, 100, 100, 20)], left: 110, top: 84 },
	])("anchors the first visible fragment of a $name", ({ rects, left, top }) => {
		const container = document.createElement("div");
		container.innerHTML = '<div id="msg-overflow"><pre style="overflow-x: auto; overflow-y: auto"><code><span>1.</span> whole long line</code></pre></div>';
		document.body.append(container);
		Object.defineProperty(container, "clientWidth", { value: 500 });
		const boxes = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
			return this.tagName === "PRE" ? new DOMRect(100, 80, 300, 80) : new DOMRect(0, 0, 500, 500);
		});
		const previousRects = Range.prototype.getClientRects;
		Range.prototype.getClientRects = () => rects as unknown as DOMRectList;
		try {
			const sources = markerSources([{ ...msg("overflow", "1. whole long line"), itemId: "overflow" }], []);
			const ranges: Range[] = [];
			expect(measureMarkers(container, sources, ranges)).toMatchObject([{ left, top }]);
			// Keep the entire quote for CSS Highlight, not only its visible token.
			expect(ranges.map((range) => range.toString())).toEqual(["1. whole long line"]);
			Range.prototype.getClientRects = () => [new DOMRect(40, 100, 20, 20)] as unknown as DOMRectList;
			const hiddenRanges: Range[] = [];
			expect(measureMarkers(container, sources, hiddenRanges)).toEqual([]);
			expect(hiddenRanges).toEqual([]);
		} finally {
			Range.prototype.getClientRects = previousRects;
			boxes.mockRestore();
			container.remove();
		}
	});
});
