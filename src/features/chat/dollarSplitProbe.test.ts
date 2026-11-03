import { describe, expect, it } from "vitest";
import { healStreamingMarkdown, splitStableBlocks } from "./streamingMarkdown";

describe("probe: $$ inside inline code must not freeze the stable-block split", () => {
	const withPid = "先看进程：PID 记在 `$$` 里。\n\n这一段是普通说明文字，应该可以进入稳定区。";

	it("heal masks code spans when counting $$ (documented intent)", () => {
		// healStreamingMarkdown masks `$$` in code spans, so nothing is held back.
		expect(healStreamingMarkdown(withPid)).toBe(withPid);
	});

	it("splitStableBlocks masks code spans too → the boundary moves past the `$$` paragraph", () => {
		const a = splitStableBlocks(withPid);
		// Without the stray $$, the first paragraph is a plain paragraph followed by
		// a blank line and an unindented line → it should be split into head.
		const plain = "先看进程：PID 记录在日志里。\n\n这一段是普通说明文字，应该可以进入稳定区。";
		const ok = splitStableBlocks(plain);
		expect(ok.head).not.toBe("");
		// The `$$` inside inline code is masked before counting: the first
		// paragraph is a plain paragraph, so it belongs in the head.
		expect(a.head).toContain("先看进程：PID 记在 `$$` 里。");
		// ...and the split keeps advancing for the rest of the answer:
		const longer = withPid + "\n\n第三段。\n\n第四段。\n\n第五段。";
		expect(splitStableBlocks(longer).head).toContain("第三段。");
	});

	it("only the live tail is re-healed + re-parsed on every token", () => {
		// The finished paragraphs above the last one are head; the tail that is
		// re-healed + re-parsed each streamed frame is only the live block.
		const big = withPid + "\n\n" + "x".repeat(20000);
		const { head, tail } = splitStableBlocks(big);
		expect(head).toBe(withPid + "\n\n");
		expect(tail).toBe("x".repeat(20000));
	});
});
