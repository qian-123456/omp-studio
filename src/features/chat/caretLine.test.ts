// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { caretVisualLines } from "./caretLine";

afterEach(() => {
	Reflect.deleteProperty(HTMLSpanElement.prototype, "offsetTop");
});

function ta(value: string, pos: number): HTMLTextAreaElement {
	const el = document.createElement("textarea");
	el.value = value;
	el.setSelectionRange(pos, pos);
	return el;
}

describe("caretVisualLines", () => {
	it("falls back to hard newlines when layout is unavailable", () => {
		expect(caretVisualLines(ta("a\nb", 0))).toEqual({ first: true, last: false });
		expect(caretVisualLines(ta("a\nb", 3))).toEqual({ first: false, last: true });
	});

	it("uses the measured line of the caret for soft-wrapped text", () => {
		// first marker top 0, caret marker top 20 (wrapped), end marker top 40.
		Object.defineProperty(HTMLSpanElement.prototype, "offsetTop", {
			configurable: true,
			get(this: HTMLSpanElement) {
				if (!this.previousSibling) return 0;
				if (!this.nextSibling) return 40;
				return 20;
			},
		});
		expect(caretVisualLines(ta("one long wrapped line", 10))).toEqual({
			first: false,
			last: false,
		});
	});
});
