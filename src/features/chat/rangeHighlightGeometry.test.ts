// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { mergeHighlightRects, rangeHighlightRects } from "./rangeHighlightGeometry";

const rect = (left: number, top: number, width: number, height: number): DOMRect =>
	new DOMRect(left, top, width, height);

describe("range highlight geometry", () => {
	it("merges nearby inline fragments on one visual line", () => {
		expect(
			mergeHighlightRects([
				{ left: 10, top: 20, width: 20, height: 16 },
				{ left: 34, top: 21, width: 12, height: 14 },
			]),
		).toEqual([{ left: 10, top: 20, width: 36, height: 16 }]);
	});

	it("does not merge separate visual lines or distant unselected text", () => {
		expect(
			mergeHighlightRects([
				{ left: 10, top: 20, width: 20, height: 16 },
				{ left: 100, top: 20, width: 12, height: 16 },
				{ left: 10, top: 42, width: 20, height: 16 },
			]),
		).toHaveLength(3);
	});

	it("deduplicates overlapping fragments without expanding to the whole line", () => {
		expect(
			mergeHighlightRects([
				{ left: 10, top: 20, width: 20, height: 16 },
				{ left: 15, top: 20, width: 10, height: 16 },
			]),
		).toEqual([{ left: 10, top: 20, width: 20, height: 16 }]);
	});

	it("adds only selected inline code padding at range boundaries", () => {
		const root = document.createElement("div");
		root.innerHTML = "before <code>picked</code> after";
		document.body.append(root);
		const code = root.querySelector("code")!;
        code.style.paddingLeft = "4px";
        code.style.paddingRight = "4px";
		const range = document.createRange();
		range.selectNodeContents(code);
		const originalRects = Range.prototype.getClientRects;
		Range.prototype.getClientRects = () => [rect(10, 20, 40, 16)] as unknown as DOMRectList;
		Object.defineProperty(code, "getBoundingClientRect", { value: () => rect(10, 20, 48, 16) });
		try {
			const out = rangeHighlightRects(range, root);
            expect(out[0].left).toBe(6);
            expect(out[0].width).toBe(48);
		} finally {
			Range.prototype.getClientRects = originalRects;
			root.remove();
		}
	});
});
