import { describe, expect, it } from "vitest";
import {
	buildSrcDoc,
	clampVizHeight,
	escapeScriptJson,
	MAX_VIZ_HEIGHT,
	MAX_WIDGET_STATE_BYTES,
	MIN_VIZ_HEIGHT,
	parseStoredWidgetState,
	parseVisualizeInfo,
	utf8Length,
	VISUALIZE_CSP,
	widgetStateKey,
} from "./frame";

describe("parseVisualizeInfo", () => {
	it("parses visualize as standard mode", () => {
		expect(parseVisualizeInfo("visualize")).toEqual({ mode: "standard" });
		expect(parseVisualizeInfo("visualize", "")).toEqual({ mode: "standard" });
	});

	it("parses visualize wide as wide mode", () => {
		expect(parseVisualizeInfo("visualize wide")).toEqual({ mode: "wide" });
		expect(parseVisualizeInfo("visualize", "wide")).toEqual({ mode: "wide" });
		expect(parseVisualizeInfo("visualize", "interactive wide layout")).toEqual({ mode: "wide" });
	});

	it("returns null for other languages", () => {
		expect(parseVisualizeInfo("ts")).toBeNull();
		expect(parseVisualizeInfo("mermaid")).toBeNull();
		expect(parseVisualizeInfo(undefined)).toBeNull();
	});
});

describe("clampVizHeight", () => {
	it("clamps height within bounds", () => {
		expect(clampVizHeight(500)).toBe(500);
		expect(clampVizHeight(10)).toBe(MIN_VIZ_HEIGHT);
		expect(clampVizHeight(50_000)).toBe(MAX_VIZ_HEIGHT);
	});

	it("handles invalid inputs gracefully", () => {
		expect(clampVizHeight(null)).toBe(0);
		expect(clampVizHeight(NaN)).toBe(0);
		expect(clampVizHeight(-100)).toBe(0);
	});
});

describe("escapeScriptJson", () => {
	it("escapes script tags and comments", () => {
		const payload = { html: "</script><script>alert(1)</script><!--comment-->" };
		const escaped = escapeScriptJson(payload);
		expect(escaped).not.toContain("</script>");
		expect(escaped).toContain("\\u003c/script>");
	});
});
describe("utf8Length and state limits", () => {
	it("measures utf-8 bytes correctly", () => {
		expect(utf8Length("hello")).toBe(5);
		expect(utf8Length("你好")).toBe(6); // 3 bytes each
	});

	it("enforces 16KB budget limit", () => {
		expect(MAX_WIDGET_STATE_BYTES).toBe(16 * 1024);
	});
});

describe("parseStoredWidgetState", () => {
	it("parses valid JSON string", () => {
		expect(parseStoredWidgetState('{"count":42}')).toEqual({ count: 42 });
	});

	it("returns undefined for null or malformed JSON", () => {
		expect(parseStoredWidgetState(null)).toBeUndefined();
		expect(parseStoredWidgetState("not-json")).toBeUndefined();
	});
});

describe("buildSrcDoc", () => {
	it("assembles complete sandboxed document with CSP and bridge", () => {
		const doc = buildSrcDoc({
			html: "<h1>Chart</h1>",
			theme: "dark",
			themeVars: { "--m-bg": "#000000" },
			widgetState: { count: 1 },
			bridgeSource: "window.testBridge = true;",
		});

		expect(doc).toContain('<!doctype html>');
		expect(doc).toContain('<html data-theme="dark">');
		expect(doc).toContain(VISUALIZE_CSP);
		expect(doc).toContain('<style>:root{color-scheme:dark;--m-bg:#000000}');
		expect(doc).toContain('id="omp-visualize-widget-state">{"count":1}</script>');
		expect(doc).toContain("window.testBridge = true;");
		expect(doc).toContain("<h1>Chart</h1>");
	});
});

describe("widgetStateKey", () => {
	it("generates stable key", () => {
		const k1 = widgetStateKey("<div>hello</div>", "standard");
		const k2 = widgetStateKey("<div>hello</div>", "standard");
		expect(k1).toBe(k2);
		expect(k1).toMatch(/^ompm:viz-state:/);
	});

	it("differs by mode or content", () => {
		const k1 = widgetStateKey("<div>hello</div>", "standard");
		const k2 = widgetStateKey("<div>hello</div>", "wide");
		const k3 = widgetStateKey("<div>world</div>", "standard");
		expect(k1).not.toBe(k2);
		expect(k1).not.toBe(k3);
	});
});
