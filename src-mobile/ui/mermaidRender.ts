/**
 * Lazy Mermaid rendering for ```mermaid fences in mobile web app.
 * Mermaid (~1 MB) is dynamically imported on first diagram only.
 * Output is an SVG string rendered via <img src="data:image/svg+xml;...">
 * so scripts and external styles cannot run or leak.
 */

import type mermaidDefault from "mermaid";

type MermaidApi = typeof mermaidDefault;

let mermaidLoad: Promise<MermaidApi> | null = null;
let initializedFor: "dark" | "light" | null = null;
let seq = 0;
let queue: Promise<unknown> = Promise.resolve();

const CACHE_LIMIT = 100;
const cache = new Map<string, string>();

function load(): Promise<MermaidApi> {
	mermaidLoad ??= import("mermaid").then(
		(m) => m.default,
		(err) => {
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
		securityLevel: "strict",
		suppressErrorRendering: true,
		theme: mode === "dark" ? "dark" : "default",
		flowchart: { htmlLabels: false },
		fontFamily: "-apple-system, BlinkMacSystemFont, 'PingFang SC', 'Segoe UI', sans-serif",
	});
	initializedFor = mode;
}

/** Current color scheme on mobile: checks data-scheme / data-mode or prefers-color-scheme. */
export function currentMermaidMode(): "dark" | "light" {
	if (typeof document === "undefined") return "dark";
	const root = document.documentElement;
	const scheme = root.dataset.scheme || root.dataset.mode;
	if (scheme === "light" || scheme === "dark") return scheme;
	return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Render Mermaid source to an SVG string. Rejects on syntax error. */
export function renderMermaidSvg(source: string, mode: "dark" | "light"): Promise<string> {
	const key = `${mode}\0${source}`;
	const hit = cache.get(key);
	if (hit !== undefined) return Promise.resolve(hit);
	const run = async (): Promise<string> => {
		const cached = cache.get(key);
		if (cached !== undefined) return cached;
		const mermaid = await load();
		configure(mermaid, mode);
		const { svg } = await mermaid.render(`ompm-mermaid-${++seq}`, source);
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

/** Intrinsic size from the SVG viewBox, if present. */
export function svgViewBoxSize(svg: string): { width: number; height: number } | null {
	const m = /viewBox="\s*[-\d.e]+[ ,]+[-\d.e]+[ ,]+([\d.e]+)[ ,]+([\d.e]+)\s*"/i.exec(svg);
	if (!m) return null;
	const width = Number(m[1]);
	const height = Number(m[2]);
	return width > 0 && height > 0 ? { width, height } : null;
}
