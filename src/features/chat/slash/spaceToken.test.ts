import { describe, expect, it } from "vitest";
import { detectFirstWordSpace, detectSpaceToken, insertedSpaceIndex, splitFirstWord } from "./spaceToken";

describe("spaceToken", () => {
	it("detects a single inserted space", () => {
		expect(insertedSpaceIndex("/mcp", "/mcp ", 5)).toBe(4);
		expect(insertedSpaceIndex("/mcp", "/mcp  ", 5)).toBeNull();
		expect(insertedSpaceIndex("ab", "a b", 2)).toBe(1);
		expect(insertedSpaceIndex("ab", "ac ", 3)).toBeNull();
	});
	it("detects slash token + space", () => {
		expect(detectSpaceToken("/mcp", "/mcp ", 5)).toEqual({ start: 0, end: 4, query: "mcp" });
		expect(detectSpaceToken("hi /mcp", "hi /mcp ", 8)).toEqual({ start: 3, end: 7, query: "mcp" });
		expect(detectSpaceToken("a/mcp", "a/mcp ", 6)).toBeNull();
		expect(detectSpaceToken("mcp", "mcp ", 4)).toBeNull();
		expect(detectSpaceToken("/", "/ ", 2)).toBeNull();
	});
	it("detects first-word space", () => {
		expect(detectFirstWordSpace("enable", "enable ", 7)).toEqual({ word: "enable", rest: "" });
		expect(detectFirstWordSpace("enablefoo", "enable foo", 7)).toEqual({ word: "enable", rest: "foo" });
		expect(detectFirstWordSpace("a b", "a b ", 4)).toBeNull();
	});
	it("splits first word", () => {
		expect(splitFirstWord("en foo")).toEqual({ word: "en", rest: "foo" });
		expect(splitFirstWord("")).toEqual({ word: "", rest: "" });
		expect(splitFirstWord("x")).toEqual({ word: "x", rest: "" });
	});
});
