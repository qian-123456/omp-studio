import { describe, expect, it } from "vitest";
import {
	buildHtmlPreviewDoc,
	HTML_PREVIEW_OPEN_MSG,
	HTML_PREVIEW_SANDBOX,
	isHtmlPreviewPath,
	relayedExternalUrl,
} from "./htmlPreview";

describe("htmlPreview", () => {
	it("detects html/htm/svg paths only", () => {
		expect(isHtmlPreviewPath("/a/b.HTML")).toBe(true);
		expect(isHtmlPreviewPath("/a/b.htm")).toBe(true);
		expect(isHtmlPreviewPath("/a/b.svg")).toBe(true);
		expect(isHtmlPreviewPath("/a/b.md")).toBe(false);
	});

	it("never grants the host origin to the preview", () => {
		expect(HTML_PREVIEW_SANDBOX).toBe("allow-scripts");
		expect(HTML_PREVIEW_SANDBOX).not.toContain("same-origin");
	});

	it("injects the link relay inside <head> and keeps the doctype first", () => {
		const doc = buildHtmlPreviewDoc("/a.html", "<!doctype html><html><head><title>x</title></head><body>hi</body></html>");
		expect(doc.startsWith("<!doctype html>")).toBe(true);
		expect(doc.indexOf(HTML_PREVIEW_OPEN_MSG)).toBeGreaterThan(doc.indexOf("<head>"));
		expect(doc.indexOf(HTML_PREVIEW_OPEN_MSG)).toBeLessThan(doc.indexOf("<title>"));
	});

	it("handles fragments without head", () => {
		expect(buildHtmlPreviewDoc("/a.html", "<p>x</p>")).toContain("<p>x</p>");
	});

	it("wraps svg in an html document and drops the xml prolog", () => {
		const doc = buildHtmlPreviewDoc("/a.svg", '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
		expect(doc).toContain("<!doctype html>");
		expect(doc).not.toContain("<?xml");
		expect(doc).toContain("<svg");
	});

	it("relays only http(s) urls", () => {
		expect(relayedExternalUrl({ type: HTML_PREVIEW_OPEN_MSG, href: "https://example.com/x" })).toBe("https://example.com/x");
		expect(relayedExternalUrl({ type: HTML_PREVIEW_OPEN_MSG, href: "file:///etc/passwd" })).toBeNull();
		expect(relayedExternalUrl({ type: HTML_PREVIEW_OPEN_MSG, href: "javascript:alert(1)" })).toBeNull();
		expect(relayedExternalUrl({ type: "other", href: "https://example.com" })).toBeNull();
		expect(relayedExternalUrl("https://example.com")).toBeNull();
	});
});
