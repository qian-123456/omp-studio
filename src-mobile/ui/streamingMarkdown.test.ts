import { describe, expect, it } from "vitest";
import {
	findVisualizeFence,
	healStreamingMarkdown,
	isFenceClosed,
	splitStableBlocks,
} from "./streamingMarkdown";

describe("splitStableBlocks", () => {
	it("returns empty head when no stable boundary exists", () => {
		const text = "Hello world streaming...";
		const res = splitStableBlocks(text);
		expect(res.head).toBe("");
		expect(res.tail).toBe(text);
		expect(res.head + res.tail).toBe(text);
	});

	it("splits completed paragraphs separated by blank lines", () => {
		const text = "Paragraph 1\n\nParagraph 2\n\nParagraph 3 is active";
		const res = splitStableBlocks(text);
		expect(res.head).toBe("Paragraph 1\n\nParagraph 2\n\n");
		expect(res.tail).toBe("Paragraph 3 is active");
		expect(res.head + res.tail).toBe(text);
	});

	it("keeps unclosed code fences in the tail", () => {
		const text = "Intro text\n\n```ts\nconst x = 1;\nconsole.log(x);";
		const res = splitStableBlocks(text);
		expect(res.head).toBe("Intro text\n\n");
		expect(res.tail).toBe("```ts\nconst x = 1;\nconsole.log(x);");
	});

	it("splits after a closed code fence", () => {
		const text = "```ts\nconst x = 1;\n```\n\nNext paragraph";
		const res = splitStableBlocks(text);
		expect(res.head).toBe("```ts\nconst x = 1;\n```\n\n");
		expect(res.tail).toBe("Next paragraph");
	});
});

describe("healStreamingMarkdown", () => {
	it("returns unchanged text when not streaming partial syntax", () => {
		const text = "Hello world";
		expect(healStreamingMarkdown(text)).toBe("Hello world");
	});

	it("balances unclosed bold markers", () => {
		const text = "Here is **bold text";
		expect(healStreamingMarkdown(text)).toBe("Here is **bold text**");
	});

	it("balances unclosed inline code", () => {
		const text = "Check `variable";
		expect(healStreamingMarkdown(text)).toBe("Check `variable`");
	});

	it("leaves closed fences untouched", () => {
		const text = "```\ncode block\n```";
		expect(healStreamingMarkdown(text)).toBe(text);
	});
});

describe("isFenceClosed", () => {
	it("returns false for an unclosed fence", () => {
		const source = "```mermaid\ngraph TD\n  A-->B";
		const closed = isFenceClosed(source, {
			start: { offset: 0 },
			end: { offset: source.length },
		});
		expect(closed).toBe(false);
	});

	it("returns true for a closed fence", () => {
		const source = "```mermaid\ngraph TD\n  A-->B\n```";
		const closed = isFenceClosed(source, {
			start: { offset: 0 },
			end: { offset: source.length },
		});
		expect(closed).toBe(true);
	});

	it("returns false when closing marker length is shorter than opening marker", () => {
		const source = "````visualize\n<div>hi</div>\n```";
		const closed = isFenceClosed(source, {
			start: { offset: 0 },
			end: { offset: source.length },
		});
		expect(closed).toBe(false);
	});

	it("fails open when position is null or undefined", () => {
		expect(isFenceClosed("```mermaid\nA", null)).toBe(true);
		expect(isFenceClosed("```mermaid\nA", undefined)).toBe(true);
	});
});

describe("findVisualizeFence", () => {
	it("finds offset of visualize block", () => {
		const text = "Paragraph\n\n```visualize\n<div>hi</div>\n```";
		const offset = findVisualizeFence(text);
		expect(offset).toBe("Paragraph\n\n".length);
	});

	it("finds offset of visualize wide block", () => {
		const text = "```visualize wide\n<div>hi</div>\n```";
		const offset = findVisualizeFence(text);
		expect(offset).toBe(0);
	});

	it("returns -1 when no visualize fence exists", () => {
		expect(findVisualizeFence("```mermaid\nA-->B\n```")).toBe(-1);
	});

	it("ignores visualize fence nested inside another fence", () => {
		const text = "````markdown\n```visualize\nhello\n```\n````";
		expect(findVisualizeFence(text)).toBe(-1);
	});
});
