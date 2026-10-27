import { describe, expect, it } from "vitest";
import { classifyDiffLine, looksLikeDiff } from "./DiffView";
import { safeHref, safeSrc } from "./Markdown";
import { PULL_THRESHOLD, pullDistance } from "./PullToRefresh";

describe("classifyDiffLine", () => {
	it("separates file headers from added/removed lines", () => {
		expect(classifyDiffLine("+++ b/a.ts")).toBe("meta");
		expect(classifyDiffLine("--- a/a.ts")).toBe("meta");
		expect(classifyDiffLine("diff --git a/a b/a")).toBe("meta");
		expect(classifyDiffLine("index 123..456 100644")).toBe("meta");
		expect(classifyDiffLine("\\ No newline at end of file")).toBe("meta");
		expect(classifyDiffLine("+const x = 1;")).toBe("add");
		expect(classifyDiffLine("-const x = 0;")).toBe("del");
		expect(classifyDiffLine("@@ -1,2 +1,2 @@")).toBe("hunk");
		expect(classifyDiffLine(" unchanged")).toBe("ctx");
		expect(classifyDiffLine("")).toBe("ctx");
	});
});

describe("looksLikeDiff", () => {
	it("detects hunk headers, git headers and ---/+++ pairs", () => {
		expect(looksLikeDiff("a\n@@ -1 +1 @@\n-a\n+b")).toBe(true);
		expect(looksLikeDiff("diff --git a/x b/x\n")).toBe(true);
		expect(looksLikeDiff("--- a/x\n+++ b/x\n")).toBe(true);
	});
	it("rejects plain text and lone markers", () => {
		expect(looksLikeDiff("hello\nworld")).toBe(false);
		expect(looksLikeDiff("--- just a rule")).toBe(false);
		expect(looksLikeDiff("use @@ in text")).toBe(false);
	});
});

describe("safeHref", () => {
	it("allows web, mail, tel, fragment and relative links", () => {
		for (const h of ["https://a.b/c", "http://a.b", "mailto:a@b.c", "tel:+123", "#sec", "/a/b", "./x", "x/y?z=1"]) {
			expect(safeHref(h)).toBe(h);
		}
	});
	it("rejects script-capable schemes including obfuscated ones", () => {
		for (const h of [
			"javascript:alert(1)",
			"JaVaScRiPt:alert(1)",
			" java\tscript:alert(1)",
			"data:text/html,<b>x</b>",
			"vbscript:x",
			"file:///etc/passwd",
			"",
			undefined,
		]) {
			expect(safeHref(h)).toBeNull();
		}
	});
});

describe("safeSrc", () => {
	it("allows http(s), raster data URIs and same-origin api paths", () => {
		expect(safeSrc("https://a.b/i.png")).toBe("https://a.b/i.png");
		expect(safeSrc("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
		expect(safeSrc("/api/files/x.png")).toBe("/api/files/x.png");
	});
	it("rejects svg data, script schemes, protocol-relative and other paths", () => {
		expect(safeSrc("data:image/svg+xml;base64,AAAA")).toBeNull();
		expect(safeSrc("data:text/html;base64,AAAA")).toBeNull();
		expect(safeSrc("javascript:alert(1)")).toBeNull();
		expect(safeSrc("//evil.com/x.png")).toBeNull();
		expect(safeSrc("/etc/passwd")).toBeNull();
		expect(safeSrc(undefined)).toBeNull();
	});
});

describe("pullDistance", () => {
	it("is zero for non-positive drags", () => {
		expect(pullDistance(0)).toBe(0);
		expect(pullDistance(-30)).toBe(0);
		expect(pullDistance(Number.NaN)).toBe(0);
	});
	it("is monotonic, resisted (< dy) and bounded", () => {
		let prev = 0;
		for (const dy of [10, 40, 80, 160, 400, 4000]) {
			const d = pullDistance(dy);
			expect(d).toBeGreaterThan(prev);
			expect(d).toBeLessThan(dy);
			expect(d).toBeLessThan(140);
			prev = d;
		}
	});
	it("crosses the refresh threshold at a comfortable drag length", () => {
		expect(pullDistance(60)).toBeLessThan(PULL_THRESHOLD);
		expect(pullDistance(130)).toBeGreaterThanOrEqual(PULL_THRESHOLD);
	});
});
