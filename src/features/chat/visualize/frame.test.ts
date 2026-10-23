import { describe, expect, it } from "vitest";
import { normalizeMath } from "../mathNormalize";
import { VIZ_BRIDGE_SOURCE, vizBridgeSource } from "./bridge";
import {
	buildSrcDoc,
	clampVizHeight,
	escapeScriptJson,
	findVisualizeFence,
	isFenceClosed,
	MAX_VIZ_HEIGHT,
	MAX_WIDGET_STATE_BYTES,
	parseStoredWidgetState,
	parseVisualizeInfo,
	utf8Length,
	VISUALIZE_CSP,
	widgetStateKey,
} from "./frame";

describe("isFenceClosed with math in the tail", () => {
	it("detects the unclosed fence when offsets index the normalized text", () => {
		const raw = "- compute $x^2$ now\n\n```visualize\n<div";
		const parsed = normalizeMath(raw);
		expect(parsed.length).toBeGreaterThan(raw.length);
		const start = parsed.indexOf("```visualize");
		const position = { start: { offset: start }, end: { offset: parsed.length } };
		expect(isFenceClosed(parsed, position)).toBe(false);
		// Raw text with parsed offsets is the old bug: the slice misses the fence and fails open.
		expect(isFenceClosed(raw, position)).toBe(true);
	});
});

describe("findVisualizeFence", () => {
	it("returns the offset of the first top-level visualize fence", () => {
		const text = "intro\n\n```visualize wide\n<div/>\n```\n";
		expect(findVisualizeFence(text)).toBe(text.indexOf("```visualize"));
		expect(findVisualizeFence("```ts\ncode\n```")).toBe(-1);
	});

	it("ignores a visualize fence nested inside another fence", () => {
		expect(findVisualizeFence("````md\n```visualize\n<div/>\n```\n````\n")).toBe(-1);
	});
});

describe("parseVisualizeInfo", () => {
	it("returns standard mode for a plain visualize fence", () => {
		expect(parseVisualizeInfo("visualize")).toEqual({ mode: "standard" });
		expect(parseVisualizeInfo("visualize", "")).toEqual({ mode: "standard" });
		expect(parseVisualizeInfo("visualize", undefined)).toEqual({
			mode: "standard",
		});
	});

	it("returns wide mode for `visualize wide` meta", () => {
		expect(parseVisualizeInfo("visualize", "wide")).toEqual({ mode: "wide" });
		expect(parseVisualizeInfo("visualize", " wide ")).toEqual({ mode: "wide" });
		expect(parseVisualizeInfo("visualize", "wide extra")).toEqual({
			mode: "wide",
		});
	});

	it("ignores look-alike meta tokens and non-string meta", () => {
		expect(parseVisualizeInfo("visualize", "widex")).toEqual({
			mode: "standard",
		});
		expect(parseVisualizeInfo("visualize", 42)).toEqual({ mode: "standard" });
		expect(parseVisualizeInfo("visualize", { wide: true })).toEqual({
			mode: "standard",
		});
	});

	it("returns null for other languages", () => {
		expect(parseVisualizeInfo("html", "wide")).toBeNull();
		expect(parseVisualizeInfo("visualization")).toBeNull();
		expect(parseVisualizeInfo(null)).toBeNull();
		expect(parseVisualizeInfo(undefined, "wide")).toBeNull();
	});
});

describe("isFenceClosed", () => {
	const closed = "text\n```visualize\n<div>hi</div>\n```\nafter";
	it("detects a closed backtick fence", () => {
		expect(
			isFenceClosed(closed, { start: { offset: 5 }, end: { offset: 36 } }),
		).toBe(true);
	});

	it("detects an unclosed fence running to EOF", () => {
		const open = "text\n```visualize\n<div>hi";
		expect(
			isFenceClosed(open, { start: { offset: 5 }, end: { offset: open.length } }),
		).toBe(false);
	});

	it("handles tilde fences and longer closers", () => {
		const tilde = "~~~visualize\nx\n~~~~";
		expect(
			isFenceClosed(tilde, {
				start: { offset: 0 },
				end: { offset: tilde.length },
			}),
		).toBe(true);
		// A ```-opened block whose last line is ~~~ is not closed by it.
		const mixed = "```visualize\nx\n~~~";
		expect(
			isFenceClosed(mixed, {
				start: { offset: 0 },
				end: { offset: mixed.length },
			}),
		).toBe(false);
	});

	it("rejects a closing marker shorter than the opening fence", () => {
		const short = "````visualize\nx\n```";
		expect(
			isFenceClosed(short, {
				start: { offset: 0 },
				end: { offset: short.length },
			}),
		).toBe(false);
	});

	it("tolerates trailing whitespace after the closing fence", () => {
		const ws = "```visualize\nx\n```\n\n   ";
		expect(
			isFenceClosed(ws, { start: { offset: 0 }, end: { offset: ws.length } }),
		).toBe(true);
	});

	it("fails open when position data is missing", () => {
		expect(isFenceClosed("anything", null)).toBe(true);
		expect(isFenceClosed("anything", undefined)).toBe(true);
		expect(isFenceClosed("anything", {})).toBe(true);
	});
});

describe("clampVizHeight", () => {
	it("passes through sane heights (rounded up)", () => {
		expect(clampVizHeight(500)).toBe(500);
		expect(clampVizHeight(500.2)).toBe(501);
	});

	it("caps at the maximum", () => {
		expect(clampVizHeight(MAX_VIZ_HEIGHT + 9999)).toBe(MAX_VIZ_HEIGHT);
		expect(clampVizHeight(Number.MAX_SAFE_INTEGER)).toBe(MAX_VIZ_HEIGHT);
	});

	it("rejects non-positive and non-finite input", () => {
		expect(clampVizHeight(0)).toBe(0);
		expect(clampVizHeight(-12)).toBe(0);
		expect(clampVizHeight(Number.NaN)).toBe(0);
		expect(clampVizHeight("oops")).toBe(0);
	});
});

describe("escapeScriptJson", () => {
	it("neutralizes script-closing sequences inside payloads", () => {
		const json = escapeScriptJson({ a: "</script><script>alert(1)" });
		expect(json).not.toContain("</script");
		expect(json).toContain("\\u003c");
		expect(JSON.parse(json)).toEqual({ a: "</script><script>alert(1)" });
	});

	it("escapes U+2028/U+2029", () => {
		const json = escapeScriptJson({ a: "x\u2028y\u2029z" });
		expect(json).toContain("\\u2028");
		expect(json).toContain("\\u2029");
	});
});

describe("utf8Length", () => {
	it("counts UTF-8 bytes, not UTF-16 units", () => {
		expect(utf8Length("abc")).toBe(3);
		expect(utf8Length("你好")).toBe(6);
		expect(utf8Length("")).toBe(0);
	});
});

describe("buildSrcDoc", () => {
	const doc = buildSrcDoc({
		html: '<div id="viz"><button>go</button></div>',
		theme: "dark",
		themeVars: { "--background": "rgb(1 2 3)", "--primary": "#fff" },
		widgetState: { count: 1 },
		bridgeSource: vizBridgeSource(MAX_WIDGET_STATE_BYTES),
	});

	it("embeds the CSP meta before any other element", () => {
		const cspAt = doc.indexOf("Content-Security-Policy");
		expect(cspAt).toBeGreaterThan(-1);
		expect(cspAt).toBeLessThan(doc.indexOf("<body"));
		expect(doc).toContain(VISUALIZE_CSP);
	});

	it("contains the fragment verbatim and the theme attribute", () => {
		expect(doc).toContain('<div id="viz"><button>go</button></div>');
		expect(doc).toContain('data-theme="dark"');
		expect(doc).toContain("color-scheme:dark");
	});

	it("inlines theme variables into the :root style", () => {
		expect(doc).toContain("--background:rgb(1 2 3)");
		expect(doc).toContain("--primary:#fff");
	});

	it("embeds widget state as inert escaped JSON", () => {
		expect(doc).toContain('id="omp-visualize-widget-state"');
		expect(doc).toContain('{"count":1}');
		const hostile = buildSrcDoc({
			html: "<div/>",
			theme: "light",
			themeVars: {},
			widgetState: { x: "</script>" },
			bridgeSource: "void 0",
		});
		expect(hostile).not.toContain('{"x":"</script>"}');
		expect(hostile).toContain("\\u003c");
	});
});

describe("parseStoredWidgetState", () => {
	it("round-trips a stored serialized state to an object in the srcdoc", () => {
		const stored = JSON.stringify({ count: 1 });
		const out = buildSrcDoc({
			html: "<div/>",
			theme: "dark",
			themeVars: {},
			widgetState: parseStoredWidgetState(stored),
			bridgeSource: "void 0",
		});
		expect(out).toContain('>{"count":1}</script>');
		expect(out).not.toContain('\\"count\\"');
	});

	it("returns undefined for missing or corrupt state", () => {
		expect(parseStoredWidgetState(null)).toBeUndefined();
		expect(parseStoredWidgetState("{oops")).toBeUndefined();
	});
});

describe("VISUALIZE_CSP", () => {
	it("denies everything by default and allows the CDN allow-list", () => {
		expect(VISUALIZE_CSP).toContain("default-src 'none'");
		expect(VISUALIZE_CSP).toContain("'unsafe-inline'");
		expect(VISUALIZE_CSP).toContain("https://cdn.jsdelivr.net");
		expect(VISUALIZE_CSP).toContain("https://unpkg.com");
		expect(VISUALIZE_CSP).toContain("frame-src 'none'");
		expect(VISUALIZE_CSP).toContain("object-src 'none'");
		expect(VISUALIZE_CSP).toContain("connect-src blob: data:");
	});
});

describe("widgetStateKey", () => {
	it("is deterministic and mode/html sensitive", () => {
		const a = widgetStateKey("<div>a</div>", "standard");
		expect(widgetStateKey("<div>a</div>", "standard")).toBe(a);
		expect(widgetStateKey("<div>a</div>", "wide")).not.toBe(a);
		expect(widgetStateKey("<div>b</div>", "standard")).not.toBe(a);
		expect(a).toMatch(/^ompws:viz-state:/);
	});
});

describe("vizBridgeSource", () => {
	it("injects the byte budget and keeps no literal script closer", () => {
		const source = vizBridgeSource(MAX_WIDGET_STATE_BYTES);
		expect(source).toContain(`const MAX_STATE_BYTES = ${MAX_WIDGET_STATE_BYTES}`);
		expect(source).not.toContain("__OMP_VIZ_MAX_STATE_BYTES__");
		expect(VIZ_BRIDGE_SOURCE).not.toContain("</scr");
		expect(VIZ_BRIDGE_SOURCE).not.toContain("<!--");
	});
});
