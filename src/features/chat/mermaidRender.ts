/**
 * Lazy Mermaid rendering for ```mermaid fences. The library (~1 MB) is imported
 * on first use only. Output is an SVG string that callers show through an
 * <img data:…> so nothing inside it can run script or touch the page's CSS.
 */

import type mermaidDefault from "mermaid";

type MermaidApi = typeof mermaidDefault;

let mermaidLoad: Promise<MermaidApi> | null = null;
/** Theme the library was last initialised with (initialize is global state). */
let initializedFor: "dark" | "light" | null = null;
let seq = 0;
/** Mermaid renders through a shared scratch element; run one render at a time. */
let queue: Promise<unknown> = Promise.resolve();

const CACHE_LIMIT = 100;
const cache = new Map<string, string>();

function load(): Promise<MermaidApi> {
	mermaidLoad ??= import("mermaid").then(
		(m) => m.default,
		(err) => {
			// A failed import must not stay cached as a rejected promise.
			mermaidLoad = null;
			throw err;
		},
	);
	return mermaidLoad;
}

function configure(mermaid: MermaidApi, mode: "dark" | "light"): void {
	if (initializedFor === mode) return;
	mermaid.initialize({
		startOnLoad: false,
		// "strict" encodes HTML in labels and disables click handlers/scripts.
		securityLevel: "strict",
		// Failures reject; without this mermaid also leaves an error graphic in <body>.
		suppressErrorRendering: true,
		theme: mode === "dark" ? "dark" : "default",
		// Plain SVG <text> instead of <foreignObject>: renders reliably in <img>.
		flowchart: { htmlLabels: false },
		fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif",
	});
	initializedFor = mode;
}

/** Current app color mode (`data-mode` on <html>); dark when unknown or outside a DOM (static render). */
export function currentMermaidMode(): "dark" | "light" {
	return typeof document !== "undefined" && document.documentElement.dataset.mode === "light" ? "light" : "dark";
}

/** Render Mermaid source to an SVG string. Rejects with the parser's message on bad syntax. */
export function renderMermaidSvg(source: string, mode: "dark" | "light"): Promise<string> {
	const key = `${mode}\0${source}`;
	const hit = cache.get(key);
	if (hit !== undefined) return Promise.resolve(hit);
	const run = async (): Promise<string> => {
		const cached = cache.get(key);
		if (cached !== undefined) return cached;
		const mermaid = await load();
		configure(mermaid, mode);
		const { svg } = await mermaid.render(`omp-mermaid-${++seq}`, source);
		cache.set(key, svg);
		if (cache.size > CACHE_LIMIT) {
			const oldest = cache.keys().next().value;
			if (oldest !== undefined) cache.delete(oldest);
		}
		return svg;
	};
	const result = queue.then(run, run);
	queue = result.catch(() => undefined);
	return result;
}

/** Intrinsic size from the SVG's viewBox, used to size the <img> (the SVG itself is `width=100%`). */
export function svgViewBoxSize(svg: string): { width: number; height: number } | null {
	const m = /viewBox="\s*[-\d.e]+[ ,]+[-\d.e]+[ ,]+([\d.e]+)[ ,]+([\d.e]+)\s*"/i.exec(svg);
	if (!m) return null;
	const width = Number(m[1]);
	const height = Number(m[2]);
	return width > 0 && height > 0 ? { width, height } : null;
}
