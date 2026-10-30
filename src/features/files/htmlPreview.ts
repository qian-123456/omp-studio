/**
 * Helpers for the rendered HTML/SVG preview in FilePreviewPanel. The preview
 * iframe is sandboxed WITHOUT allow-same-origin (opaque origin, same boundary
 * as chat Visualize blocks), so http(s) link clicks are relayed to the host via
 * postMessage and opened in the system browser by the parent.
 */

export const HTML_PREVIEW_OPEN_MSG = "omp-html-preview-open";
export const HTML_PREVIEW_SANDBOX = "allow-scripts";

const HTML_PATH_RE = /\.(html?|svg)$/i;
const SVG_PATH_RE = /\.svg$/i;

export function isHtmlPreviewPath(path: string): boolean {
	return HTML_PATH_RE.test(path);
}

const RELAY_SCRIPT =
	'<script>document.addEventListener("click",function(e){var t=e.target;var a=t&&t.closest&&t.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";if(/^https?:\\/\\//i.test(h)){e.preventDefault();parent.postMessage({type:"' +
	HTML_PREVIEW_OPEN_MSG +
	'",href:a.href},"*")}},true)</script>';

export function buildHtmlPreviewDoc(path: string, source: string): string {
	if (SVG_PATH_RE.test(path)) {
		const svg = source.replace(/^\s*<\?xml[^>]*\?>/i, "");
		return [
			"<!doctype html>",
			'<html><head><meta charset="utf-8">',
			"<style>html,body{margin:0;height:100%;background:#fff}body{display:flex;align-items:center;justify-content:center}svg{max-width:100%;max-height:100%}</style>",
			RELAY_SCRIPT,
			"</head><body>",
			svg,
			"</body></html>",
		].join("");
	}
	const head = /<head[^>]*>/i.exec(source);
	if (head) {
		const at = head.index + head[0].length;
		return source.slice(0, at) + RELAY_SCRIPT + source.slice(at);
	}
	const doctype = /^\s*<!doctype[^>]*>/i.exec(source);
	if (doctype) {
		const at = doctype[0].length;
		return source.slice(0, at) + RELAY_SCRIPT + source.slice(at);
	}
	return RELAY_SCRIPT + source;
}

/** The http(s) URL carried by a relay message, or null for anything else. */
export function relayedExternalUrl(data: unknown): string | null {
	if (typeof data !== "object" || data === null) return null;
	const msg = data as { type?: unknown; href?: unknown };
	if (msg.type !== HTML_PREVIEW_OPEN_MSG || typeof msg.href !== "string") return null;
	try {
		const u = new URL(msg.href);
		return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
	} catch {
		return null;
	}
}
