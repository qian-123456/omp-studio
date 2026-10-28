import { describe, expect, it } from "vitest";
import { normalizeThinkContent, splitThinkTags } from "./thinkTags";

describe("splitThinkTags", () => {
	it("leaves tag-free text untouched", () => {
		const s = splitThinkTags("hello <b>world</b>");
		expect(s).toEqual({ text: "hello <b>world</b>", thinking: "", open: false });
	});

	it("splits a closed think block from the reply", () => {
		const s = splitThinkTags("<think>先想一想</think>\n\n答案是 4");
		expect(s).toEqual({ text: "答案是 4", thinking: "先想一想", open: false });
	});

	it("accepts <thinking> and mixed case, several blocks", () => {
		const s = splitThinkTags("<Thinking>a</Thinking>x<think>b</think>y");
		expect(s.thinking).toBe("a\n\nb");
		expect(s.text).toBe("xy");
	});

	it("treats an unclosed opener as still-open reasoning", () => {
		const s = splitThinkTags("<think>half a thou");
		expect(s).toEqual({ text: "", thinking: "half a thou", open: true });
	});

	it("keeps prose before an opener", () => {
		const s = splitThinkTags("前言<think>想");
		expect(s).toEqual({ text: "前言", thinking: "想", open: true });
	});

	it("holds back a half-typed tag while streaming", () => {
		expect(splitThinkTags("answer <thi", { streaming: true }).text).toBe("answer ");
		expect(splitThinkTags("answer </", { streaming: true }).text).toBe("answer ");
		expect(splitThinkTags("a <", { streaming: true }).text).toBe("a ");
		// Not a tag prefix: kept.
		expect(splitThinkTags("a <tab", { streaming: true }).text).toBe("a <tab");
		// Same tail without streaming is literal.
		expect(splitThinkTags("answer <thi").text).toBe("answer <thi");
	});

	it("a streaming partial opener never flashes into the reasoning", () => {
		const s = splitThinkTags("<think", { streaming: true });
		expect(s).toEqual({ text: "", thinking: "", open: false });
		const s2 = splitThinkTags("<think>", { streaming: true });
		expect(s2).toEqual({ text: "", thinking: "", open: true });
	});

	it("a closer without an opener makes the preceding text reasoning", () => {
		const s = splitThinkTags("reasoning here</think>the answer");
		expect(s).toEqual({ text: "the answer", thinking: "reasoning here", open: false });
	});

	it("drops a stray closer after reasoning already closed", () => {
		const s = splitThinkTags("<think>a</think>b</think>c");
		expect(s.text).toBe("bc");
		expect(s.thinking).toBe("a");
	});

	it("ignores tags inside fenced code", () => {
		const raw = "看这个：\n```html\n<think>x</think>\n```\n完";
		expect(splitThinkTags(raw)).toEqual({ text: raw, thinking: "", open: false });
	});
});

describe("normalizeThinkContent", () => {
	it("returns the same array when nothing needs splitting", () => {
		const c = [{ type: "text", text: "hi" }, { type: "toolCall", id: "1" }];
		expect(normalizeThinkContent(c)).toBe(c);
	});

	it("expands a tagged text part into thinking + text parts in place", () => {
		const c = [
			{ type: "text", text: "<think>t</think>r" },
			{ type: "toolCall", id: "1" },
		];
		expect(normalizeThinkContent(c)).toEqual([
			{ type: "thinking", thinking: "t" },
			{ type: "text", text: "r" },
			{ type: "toolCall", id: "1" },
		]);
	});

	it("preserves explicitly marked narration instead of treating tags as thinking", () => {
		const content = [{ type: "text", text: "<think>spoken</think>", narration: true }];
		expect(normalizeThinkContent(content, { streaming: true })).toBe(content);
	});
	it("drops a text part that is only a half-typed tag while streaming", () => {
		const c = [{ type: "text", text: "<thin" }];
		expect(normalizeThinkContent(c, { streaming: true })).toEqual([]);
	});
});
