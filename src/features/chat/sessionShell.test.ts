import { describe, expect, it } from "vitest";
import { shellQuote } from "./sessionShell";

describe("shellQuote", () => {
	it("wraps a plain string in single quotes", () => {
		expect(shellQuote("hello")).toBe("'hello'");
	});

	it("handles spaces and special characters", () => {
		expect(shellQuote("hello world")).toBe("'hello world'");
		expect(shellQuote("foo$bar*baz")).toBe("'foo$bar*baz'");
	});

	it("escapes single quotes correctly", () => {
		expect(shellQuote("can't")).toBe("'can'\\''t'");
		expect(shellQuote("'quoted'")).toBe("''\\''quoted'\\'''");
	});
});
