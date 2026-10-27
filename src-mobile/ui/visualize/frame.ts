/**
 * Pure helpers for the mobile visualize feature:
 * fenced-block parsing, closed fence detection, srcdoc assembly,
 * size limits and CSP definition. DOM-free for vitest tests.
 */

export type VisualizeMode = "standard" | "wide";

export interface VisualizeInfo {
	mode: VisualizeMode;
}

export const MAX_VIZ_HEIGHT = 10_000;
export const MIN_VIZ_HEIGHT = 120;
export const MAX_WIDGET_STATE_BYTES = 16 * 1024;

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

export function parseVisualizeInfo(
	lang: string | null | undefined,
	meta?: unknown,
): VisualizeInfo | null {
	if (!lang) return null;
	const trimmedLang = lang.trim();
	if (trimmedLang !== "visualize" && !trimmedLang.startsWith("visualize ")) return null;
	const metaText = typeof meta === "string" ? meta : "";
	const combined = `${trimmedLang} ${metaText}`;
	const wide = combined.split(/\s+/).includes("wide");
	return { mode: wide ? "wide" : "standard" };
}

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
	return close[1][0] === open[1][0] && close[1].length >= open[1].length;
}

const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/;
const VISUALIZE_FENCE_RE = /^ {0,3}(?:`{3,}|~{3,})[ \t]*visualize(?=[\s]|$)/;

export function findVisualizeFence(text: string): number {
	if (!text.includes("visualize")) return -1;
	let offset = 0;
	let open: { char: string; len: number } | null = null;
	for (const line of text.split("\n")) {
		const fence = FENCE_LINE_RE.exec(line);
		if (open) {
			if (fence && fence[1][0] === open.char && fence[1].length >= open.len && !line.slice(fence[0].length).trim()) {
				open = null;
			}
		} else if (fence) {
			if (VISUALIZE_FENCE_RE.test(line)) return offset;
			open = { char: fence[1][0], len: fence[1].length };
		}
		offset += line.length + 1;
	}
	return -1;
}

export function clampVizHeight(height: unknown): number {
	const n = typeof height === "number" ? height : Number(height);
	if (!Number.isFinite(n) || n <= 0) return 0;
	return Math.min(MAX_VIZ_HEIGHT, Math.max(MIN_VIZ_HEIGHT, Math.ceil(n)));
}

export function utf8Length(text: string): number {
	return new TextEncoder().encode(text).length;
}

export function escapeScriptJson(value: unknown): string {
	return JSON.stringify(value)
		.replace(/</g, "\\u003c")
		.replace(/\u2028/g, "\\u2028")
		.replace(/\u2029/g, "\\u2029");
}

export function parseStoredWidgetState(serialized: string | null): unknown {
	if (serialized === null) return undefined;
	try {
		return JSON.parse(serialized);
	} catch {
		return undefined;
	}
}

export interface SrcDocOptions {
	html: string;
	theme: "light" | "dark";
	themeVars: Record<string, string>;
	widgetState?: unknown;
	bridgeSource: string;
}

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
	const stateJson = widgetState === undefined ? "null" : escapeScriptJson(widgetState);
	return [
		"<!doctype html>",
		`<html data-theme="${theme}">`,
		"<head>",
		'<meta charset="utf-8">',
		'<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">',
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

export function widgetStateKey(html: string, mode: VisualizeMode): string {
	let h = 0x811c9dc5;
	const text = `${mode}${html}`;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return `ompm:viz-state:${(h >>> 0).toString(36)}`;
}
