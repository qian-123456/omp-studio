import { describe, expect, it } from "vitest";
import { healStreamingMarkdown, splitStableBlocks } from "./streamingMarkdown";

describe("probe: $$ inside inline code freezes the stable-block split", () => {
	const withPid = "先看进程：PID 记在 `$$` 里。\n\n这一段是普通说明文字，应该可以进入稳定区。";

	it("heal masks code spans when counting $$ (documented intent)", () => {
		// healStreamingMarkdown masks `$$` in code spans, so nothing is held back.
		expect(healStreamingMarkdown(withPid)).toBe(withPid);
	});

	it("splitStableBlocks does NOT mask code spans → boundary frozen after that paragraph", () => {
		const a = splitStableBlocks(withPid);
		// Without the stray $$, the first paragraph is a plain paragraph followed by
		// a blank line and an unindented line → it should be split into head.
		const plain = "先看进程：PID 记录在日志里。\n\n这一段是普通说明文字，应该可以进入稳定区。";
		const ok = splitStableBlocks(plain);
		expect(ok.head).not.toBe("");
		// With `$$` inside inline code, the whole text stays in the tail: head frozen.
		expect(a.head).toBe("");
		// ...and it never recovers for the rest of the answer:
		const longer = withPid + "\n\n第三段。\n\n第四段。\n\n第五段。";
		expect(splitStableBlocks(longer).head).toBe("");
	});

	it("tail-only rendering means the frozen region is re-parsed on every token", () => {
		// Document the perf consequence: everything after the offending paragraph
		// is tail, and the tail is re-healed + re-parsed each streamed frame.
		const big = withPid + "\n\n" + "x".repeat(20000);
		const { head, tail } = splitStableBlocks(big);
		expect(head).toBe("");
		expect(tail.length).toBe(big.length);
	});
});
