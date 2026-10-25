import { describe, expect, it } from "vitest";
import { inlineCodeUrl } from "./rehypeFilePathLinks";

describe("inlineCodeUrl", () => {
	it("accepts a lone http(s) URL", () => {
		const u = "https://github.com/qian-123456/omp-studio/releases/latest/download/latest.json";
		expect(inlineCodeUrl(u)).toBe(u);
		expect(inlineCodeUrl("  http://localhost:3000/a?b=1#c ")).toBe("http://localhost:3000/a?b=1#c");
	});

	it("rejects non-URL code and other schemes", () => {
		for (const s of [
			"curl https://a.com",
			"https://",
			"ftp://a.com/x",
			"javascript:alert(1)",
			"file:///tmp/a.md",
			"npm run dev",
			"/Users/me/a.md",
			"https://a.com/<x>",
		]) {
			expect(inlineCodeUrl(s)).toBeNull();
		}
	});
});
