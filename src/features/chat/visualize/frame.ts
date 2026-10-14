/**
 * Pure helpers for the visualize feature: fenced-block info parsing, closed
 * fence detection, srcdoc assembly and size limits. Kept DOM-free so vitest
 * can exercise them in the node environment.
 */

export type VisualizeMode = "standard" | "wide";

export interface VisualizeInfo {
	mode: VisualizeMode;
}

/** Max iframe height the host will apply (matches the ChatGPT host cap). */
export const MAX_VIZ_HEIGHT = 10_000;

/** Widget-state payloads larger than this are rejected (16 KiB, UTF-8). */
export const MAX_WIDGET_STATE_BYTES = 16 * 1024;

/**
 * CDN allow-list and CSP for the sandboxed srcdoc document. Mirrors the
 * upstream contract: fragments may inline scripts/styles and load code,
 * images, fonts and media from the listed CDNs only; no arbitrary network.
 */
export const VISUALIZE_RESOURCE_SOURCES = [
	"blob:",
	"data:",
	"https://cdnjs.cloudflare.com",
	"https://cdn.jsdelivr.net",
	"https://esm.sh",
	"https://fonts.bunny.net",
	"https://fonts.googleapis.com",
	"https://fonts.gstatic.com",
	"https://unpkg.com",
].join(" ");

export const VISUALIZE_CSP = [
	"default-src 'none'",
	`script-src 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' ${VISUALIZE_RESOURCE_SOURCES}`,
	`style-src 'unsafe-inline' ${VISUALIZE_RESOURCE_SOURCES}`,
	`img-src ${VISUALIZE_RESOURCE_SOURCES}`,
	`font-src ${VISUALIZE_RESOURCE_SOURCES}`,
	`media-src ${VISUALIZE_RESOURCE_SOURCES}`,
	"worker-src blob:",
	"connect-src blob: data:",
	"frame-src 'none'",
	"object-src 'none'",
	"base-uri 'none'",
	"form-action 'none'",
].join("; ");

/**
 * Parse a fenced code block's language + meta. `visualize` → standard width,
 * `visualize wide` → wide layout. The meta string may arrive as the hast
 * `data.meta` value or a `data-meta`-style property. Returns null for any
 * other language.
 */
export function parseVisualizeInfo(
	lang: string | null | undefined,
	meta?: unknown,
): VisualizeInfo | null {
	if (lang !== "visualize") return null;
	const metaText = typeof meta === "string" ? meta : "";
	const wide = metaText
		.trim()
		.split(/\s+/)
		.some((token) => token === "wide");
	return { mode: wide ? "wide" : "standard" };
}

/**
 * Decide whether a fenced code block in `source` is closed. `position` is the
 * mdast/hast position of the enclosing <pre> node (offsets are UTF-16 code
 * units into the source string). An unclosed fence (still streaming) runs to
 * EOF, so its source slice cannot end on a closing fence line.
 *
 * Missing position data fails open (treated as closed): streaming blocks are
 * always the last node and always carry positions in this renderer.
 */
export function isFenceClosed(
	source: string,
	position?: {
		start?: { offset?: number };
		end?: { offset?: number };
	} | null,
): boolean {
	const start = position?.start?.offset;
	const end = position?.end?.offset;
	if (typeof start !== "number" || typeof end !== "number") return true;
	const slice = source.slice(start, end).replace(/\s+$/, "");
	if (!slice) return true;
	const open = /^(`{3,}|~{3,})/.exec(slice);
	if (!open) return true;
	const lastLine = slice.slice(slice.lastIndexOf("\n") + 1).trim();
	const close = /^(`{3,}|~{3,})$/.exec(lastLine);
	if (!close) return false;
	// A closing marker must reuse the opening char and be at least as long.
	return close[1][0] === open[1][0] && close[1].length >= open[1].length;
}

/** Clamp a reported iframe content height to a sane pixel range. */
export function clampVizHeight(height: unknown): number {
	const n = typeof height === "number" ? height : Number(height);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.min(MAX_VIZ_HEIGHT, Math.ceil(n));
}

/** UTF-8 byte length of a string (for the widget-state budget). */
export function utf8Length(text: string): number {
	return new TextEncoder().encode(text).length;
}

/**
 * Serialize a value for embedding inside an inline <script> element. `<` is
 * escaped so a payload can never terminate the script early (`</script>`) or
 * open an HTML comment (`<!--`); U+2028/29 are escaped for older parsers.
 */
export function escapeScriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

export interface SrcDocOptions {
	/** The model-authored HTML fragment (inserted raw). */
	html: string;
	/** Resolved app theme. */
	theme: "light" | "dark";
	/** Theme CSS variables resolved from the host document. */
	themeVars: Record<string, string>;
	/** Persisted widget state to expose as window.openai.widgetState. */
	widgetState?: unknown;
	/** Bridge source injected before the fragment runs. */
	bridgeSource: string;
}

/**
 * Assemble the sandboxed iframe document. The CSP meta must precede every
 * other element so it applies to all loads; the bridge script runs before the
 * fragment so `window.openai` exists when fragment scripts execute.
 */
export function buildSrcDoc({
	html,
	theme,
	themeVars,
	widgetState,
	bridgeSource,
}: SrcDocOptions): string {
	const varsCss = Object.entries(themeVars)
		.map(([name, value]) => `${name}:${value}`)
		.join(";");
	const stateJson =
		widgetState === undefined ? "null" : escapeScriptJson(widgetState);
	return [
		"<!doctype html>",
		`<html data-theme="${theme}">`,
		"<head>",
		'<meta charset="utf-8">',
		`<meta http-equiv="Content-Security-Policy" content="${VISUALIZE_CSP}">`,
		`<style>:root{color-scheme:${theme};${varsCss}}html,body{margin:0;padding:0;background:transparent}body{overflow-wrap:anywhere}*{box-sizing:border-box}</style>`,
		"</head>",
		"<body>",
		`<script type="application/json" id="omp-visualize-widget-state">${stateJson}</script>`,
		`<script>${bridgeSource}</script>`,
		html,
		"</body>",
		"</html>",
	].join("\n");
}

/** FNV-1a hash → stable storage key for a block's widget state. */
export function widgetStateKey(html: string, mode: VisualizeMode): string {
	let h = 0x811c9dc5;
	const text = `${mode}${html}`;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return `ompws:viz-state:${(h >>> 0).toString(36)}`;
}
