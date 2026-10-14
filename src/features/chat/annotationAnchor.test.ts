import { describe, expect, it } from "vitest";
import {
	locateQuote,
	normalizeWithMap,
	quoteNeedles,
	segmentEndpoints,
	type TextSegment,
} from "./annotationAnchor";

/** Raw substring covered by a locateQuote result. */
const covered = (haystack: string, quote: string) => {
	const hit = locateQuote(haystack, quote);
	return hit ? haystack.slice(hit.start, hit.end) : null;
};

describe("normalizeWithMap", () => {
	it("collapses whitespace runs and trims, with a raw-index map", () => {
		const n = normalizeWithMap("  a \n\t b  ");
		expect(n.text).toBe("a b");
		expect(n.map).toEqual([2, 3, 7, 10]);
	});

	it("maps each normalised char back to its raw index", () => {
		const raw = "x\n\ny z";
		const n = normalizeWithMap(raw);
		expect(n.text).toBe("x y z");
		for (let i = 0; i < n.text.length; i++) {
			const expected = n.text[i] === " " ? /\s/ : new RegExp(n.text[i]);
			expect(raw[n.map[i]]).toMatch(expected);
		}
		expect(n.map[n.text.length]).toBe(raw.length);
	});

	it("handles empty and whitespace-only input", () => {
		expect(normalizeWithMap("").text).toBe("");
		expect(normalizeWithMap(" \n ").text).toBe("");
	});
});

describe("quoteNeedles", () => {
	it("uses the first non-empty line, normalised", () => {
		expect(quoteNeedles("\n  hello   world \nsecond")).toEqual([
			"hello world",
		]);
	});

	it("adds shorter prefixes for long first lines", () => {
		const line = "a".repeat(30) + " " + "b".repeat(70);
		const needles = quoteNeedles(line);
		expect(needles[0]).toBe(line);
		expect(needles).toContain("a".repeat(30) + " " + "b".repeat(49));
		expect(needles).toContain("a".repeat(20));
	});

	it("returns nothing for blank quotes", () => {
		expect(quoteNeedles("   \n\t ")).toEqual([]);
	});
});

describe("locateQuote", () => {
	it("matches a plain substring exactly", () => {
		expect(covered("the quick brown fox", "quick brown")).toBe("quick brown");
	});

	it("ignores newline vs space differences in the quote", () => {
		const hay = "first line\nsecond   line of text\nthird";
		expect(covered(hay, "second line of text")).toBe("second   line of text");
		// Only the first non-empty line is searched, so a multi-line quote anchors on its first line.
		expect(covered(hay, "first\nline")).toBe("first");
	});

	it("ignores whitespace differences inside the haystack", () => {
		const hay = "alpha\n\n   beta\tgamma";
		expect(covered(hay, "alpha beta gamma")).toBe(hay);
	});

	it("trims surrounding whitespace in the quote", () => {
		expect(covered("one two three", "   two  \n")).toBe("two");
	});

	it("falls back to a shorter prefix when the full line is not found", () => {
		const hay = "The cache is warm after the first request, then ...";
		const quote = "The cache is warm after the first request, but the second one differs";
		expect(covered(hay, quote)).toBe(quote.slice(0, 40));
	});

	it("returns null when nothing matches", () => {
		expect(locateQuote("hello world", "goodbye")).toBeNull();
		expect(locateQuote("hello world", "  \n ")).toBeNull();
		expect(locateQuote("", "hello")).toBeNull();
	});

	it("returns raw offsets that exclude surrounding whitespace", () => {
		const hay = "  \nabc\n  ";
		expect(locateQuote(hay, "abc")).toEqual({ start: 3, end: 6 });
	});

	it("matches across text that was split into several nodes", () => {
		// Simulates "Hello " + "**big** " + "world" text nodes joined together.
		const parts = ["Hello ", "big", " world\n", "tail"];
		const hay = parts.join("");
		expect(covered(hay, "Hello big world")).toBe("Hello big world");
	});
});

describe("segmentEndpoints", () => {
	const seg = (node: string, start: number, length: number): TextSegment<string> => ({
		node,
		start,
		length,
	});

	it("maps a match inside one node", () => {
		const segments = [seg("a", 0, 5), seg("b", 5, 4)];
		expect(segmentEndpoints(segments, 1, 3)).toEqual({
			startNode: "a",
			startOffset: 1,
			endNode: "a",
			endOffset: 3,
		});
	});

	it("maps a match spanning several nodes", () => {
		const segments = [seg("a", 0, 5), seg("b", 5, 4), seg("c", 9, 3)];
		expect(segmentEndpoints(segments, 3, 10)).toEqual({
			startNode: "a",
			startOffset: 3,
			endNode: "c",
			endOffset: 1,
		});
	});

	it("maps a match ending exactly at a node boundary", () => {
		const segments = [seg("a", 0, 5), seg("b", 5, 4)];
		expect(segmentEndpoints(segments, 0, 5)).toEqual({
			startNode: "a",
			startOffset: 0,
			endNode: "a",
			endOffset: 5,
		});
	});

	it("returns null for empty or out-of-range matches", () => {
		const segments = [seg("a", 0, 5)];
		expect(segmentEndpoints(segments, 2, 2)).toBeNull();
		expect(segmentEndpoints(segments, 7, 9)).toBeNull();
	});
});
