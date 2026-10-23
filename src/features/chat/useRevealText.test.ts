import { describe, expect, it } from "vitest";
import { splitStableBlocks } from "./streamingMarkdown";
import {
	DRAIN_FRAMES,
	nextRevealLength,
	reconcileRevealed,
	revealStepSize,
} from "./useRevealText";

describe("revealStepSize", () => {
	it("reveals a single character for a small backlog", () => {
		expect(revealStepSize(1)).toBe(1);
		expect(revealStepSize(5)).toBe(1);
		expect(revealStepSize(8)).toBe(1);
	});
	it("scales with the backlog", () => {
		expect(revealStepSize(9)).toBe(2);
		expect(revealStepSize(800)).toBe(100);
	});
	it("is zero with nothing to reveal", () => {
		expect(revealStepSize(0)).toBe(0);
	});
});

describe("nextRevealLength", () => {
	it("drains any burst within a bounded number of frames", () => {
		const text = "x".repeat(3000);
		let n = 0;
		let frames = 0;
		while (n < text.length) {
			n = nextRevealLength(text, n);
			frames++;
		}
		// ceil(backlog / 8) geometric decay: well under a second at 60 fps.
		expect(frames).toBeLessThan(DRAIN_FRAMES * 12);
	});
	it("steps one character at a time for a slow stream", () => {
		expect(nextRevealLength("abc", 1)).toBe(2);
	});
	it("never splits a surrogate pair", () => {
		const text = "a😀b😀c😀d😀e😀";
		for (let n = 0; n < text.length; ) {
			n = nextRevealLength(text, n);
			if (n < text.length) {
				const c = text.charCodeAt(n - 1);
				expect(c >= 0xd800 && c <= 0xdbff).toBe(false);
			}
		}
	});
	it("clamps at the full length", () => {
		expect(nextRevealLength("abc", 3)).toBe(3);
		expect(nextRevealLength("abc", 9)).toBe(3);
	});
});

describe("reconcileRevealed", () => {
	it("keeps the cursor when the target extends the previous text", () => {
		expect(reconcileRevealed("hello", "hello world", 3)).toBe(3);
	});
	it("clamps when the target shrinks to a prefix", () => {
		expect(reconcileRevealed("hello world", "hello", 8)).toBe(5);
	});
	it("rewinds to the shared prefix when the text is replaced", () => {
		expect(reconcileRevealed("hello world", "help!", 8)).toBe(3);
	});
	it("rewinds to zero for unrelated text", () => {
		expect(reconcileRevealed("abc", "xyz", 3)).toBe(0);
	});
});

describe("splitStableBlocks", () => {
	it("keeps head + tail equal to the text", () => {
		const s = "para one\n\npara two";
		const { head, tail } = splitStableBlocks(s);
		expect(head + tail).toBe(s);
		expect(head).toBe("para one\n\n");
		expect(tail).toBe("para two");
	});
	it("freezes finished paragraphs once a later block starts", () => {
		expect(splitStableBlocks("a\n\nb\n\nc").head).toBe("a\n\nb\n\n");
	});
	it("does not split inside a fenced code block", () => {
		const s = "intro\n\n```js\nx\n\ny\n```\n\nafter";
		const { head, tail } = splitStableBlocks(s);
		expect(head).toBe("intro\n\n```js\nx\n\ny\n```\n\n");
		expect(tail).toBe("after");
		expect(splitStableBlocks("intro\n\n```js\nx\n\ny").head).toBe("intro\n\n");
	});
	it("keeps lists in the tail because they can continue", () => {
		expect(splitStableBlocks("- a\n\n- b\n\ntext").head).toBe("");
	});
	it("does not split inside a $$ math block", () => {
		expect(splitStableBlocks("a\n\n$$\nx\n\ny").head).toBe("a\n\n");
	});
	it("returns everything as tail for a single block", () => {
		expect(splitStableBlocks("only one")).toEqual({ head: "", tail: "only one" });
	});
});
