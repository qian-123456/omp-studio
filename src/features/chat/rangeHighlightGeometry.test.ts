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
	it("merges same-line fragments with different font heights without overlapping fills", () => {
		expect(
			mergeHighlightRects([
				{ left: 0, top: 10, width: 30, height: 20 },
				{ left: 25, top: 14, width: 30, height: 14 },
				{ left: 60, top: 10, width: 30, height: 20 },
			]),
		).toEqual([{ left: 0, top: 10, width: 90, height: 20 }]);
	});

	it("paints only selected text rows, not fully selected list block boxes", () => {
		const root = document.createElement("div");
		root.innerHTML = "<p>unselected before</p><ol><li>first row</li><li>second row</li></ol><p>unselected after</p>";
		document.body.append(root);
		const first = root.querySelectorAll("li")[0].firstChild as Text;
		const second = root.querySelectorAll("li")[1].firstChild as Text;
		const selected = document.createRange();
		selected.setStart(first, 0);
		selected.setEnd(second, second.length);
		const originalRects = Range.prototype.getClientRects;
		Range.prototype.getClientRects = function () {
			if (this === selected) {
				return [rect(0, 0, 500, 56), rect(10, 2, 80, 16), rect(10, 30, 100, 16)] as unknown as DOMRectList;
			}
			return [this.startContainer === first ? rect(10, 2, 80, 16) : rect(10, 30, 100, 16)] as unknown as DOMRectList;
		};
		try {
			expect(rangeHighlightRects(selected, root)).toEqual([
				{ left: 10, top: 2, width: 80, height: 16 },
				{ left: 10, top: 30, width: 100, height: 16 },
			]);
		} finally {
			Range.prototype.getClientRects = originalRects;
			root.remove();
		}
	});

	it("keeps the exact partial text boundary and native copy text", () => {
		const root = document.createElement("div");
		root.textContent = "before picked after";
		document.body.append(root);
		const text = root.firstChild as Text;
		const selected = document.createRange();
		selected.setStart(text, 7);
		selected.setEnd(text, 13);
		const originalRects = Range.prototype.getClientRects;
		Range.prototype.getClientRects = function () {
			return [rect(this.startOffset * 10, 0, (this.endOffset - this.startOffset) * 10, 16)] as unknown as DOMRectList;
		};
		try {
			expect(rangeHighlightRects(selected, root)).toEqual([{ left: 70, top: 0, width: 60, height: 16 }]);
			expect(selected.toString()).toBe("picked");
		} finally {
			Range.prototype.getClientRects = originalRects;
			root.remove();
		}
	});
});
