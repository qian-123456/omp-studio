import { describe, expect, it } from "vitest";
import { normalizeMath } from "./mathNormalize";

describe("normalizeMath", () => {
	it("puts inline-closed display math on its own fenced lines", () => {
		const src = "前文\n$$\\begin{aligned}\nA &\\cap B\n\\end{aligned}$$\n```\ncode\n```";
		const out = normalizeMath(src);
		expect(out).toContain("\n$$\n\\begin{aligned}\nA &\\cap B\n\\end{aligned}\n$$\n");
		expect(out.endsWith("```\ncode\n```")).toBe(true);
	});

	it("escapes an unclosed $$ so it cannot swallow the rest", () => {
		expect(normalizeMath("a $$ b\n\nrest")).toBe("a \\$\\$ b\n\nrest");
	});

	it("does not pair $$ across a blank line", () => {
		expect(normalizeMath("$$ x\n\ny $$")).toBe("\\$\\$ x\n\ny \\$\\$");
	});

	it("leaves fenced code and inline code untouched", () => {
		const src = "`$$`\n\n```sh\necho $$\n```\n";
		expect(normalizeMath(src)).toBe(src);
	});
});
