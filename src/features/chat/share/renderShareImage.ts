import { toPng } from "html-to-image";
import { tNow } from "../../../stores/language";
const PIXEL_RATIO = 2;
/** Conservative browser canvas edge limit (WebKit caps around 16384px). */
const MAX_CANVAS_EDGE = 16000;

export interface ShareImage {
	/** `data:image/png;base64,...` for the preview `<img>`. */
	dataUrl: string;
	/** Raw PNG bytes for the clipboard. */
	bytes: Uint8Array;
	/** Base64 payload without the data-URL prefix, for `save_share_image`. */
	base64: string;
	width: number;
	height: number;
}

function decodeBase64(base64: string): Uint8Array {
	const bin = atob(base64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

/**
 * KaTeX never wraps, and in the app a wide formula scrolls inside its own block.
 * A PNG cannot scroll, so shrink each overflowing formula to the card width for
 * the export. Returns a function that restores the live DOM.
 */
function fitMathToWidth(root: HTMLElement): () => void {
	const restores: Array<() => void> = [];
	for (const block of root.querySelectorAll<HTMLElement>(".katex-display")) {
		const inner = block.querySelector<HTMLElement>(":scope > .katex");
		if (!inner) continue;
		// `.katex` is display:block inside a display formula, so its box is always
		// the container width; the natural (unwrapped) width is the content overflow.
		const available = block.clientWidth;
		const needed = inner.scrollWidth;
		if (available <= 0 || needed <= available) continue;
		// The framed MathBlock body scrolls too; neutralise it so no scrollbar is painted.
		const body = block.closest<HTMLElement>("[data-math-body]");
		const prevBodyOverflow = body?.style.overflow ?? "";
		const prevOverflow = block.style.overflow;
		const prevZoom = inner.style.zoom;
		if (body) body.style.overflow = "visible";
		block.style.overflow = "visible";
		inner.style.zoom = String(available / needed);
		restores.push(() => {
			if (body) body.style.overflow = prevBodyOverflow;
			block.style.overflow = prevOverflow;
			inner.style.zoom = prevZoom;
		});
	}
	return () => {
		for (const restore of restores) restore();
	};
}

/** Rasterise `node` to a PNG. Throws a Chinese message when the content is too tall. */
export async function renderShareImage(node: HTMLElement): Promise<ShareImage> {
	if (document.fonts?.ready) await document.fonts.ready;
	const restoreMath = fitMathToWidth(node);
	try {
		// Measured after the math fit: shrinking formulas can change the height.
		const width = node.offsetWidth;
		const height = node.offsetHeight;
		if (height * PIXEL_RATIO > MAX_CANVAS_EDGE) {
			throw new Error(tNow("share.contentTooLong"));
		}
		const backgroundColor = getComputedStyle(node).backgroundColor;
		const options = { cacheBust: true, backgroundColor };
		// WKWebView/Safari frequently returns a blank first render (resources are
		// inlined lazily), so do one throwaway pass before the real one.
		await toPng(node, { ...options, pixelRatio: 1 });
		const dataUrl = await toPng(node, { ...options, pixelRatio: PIXEL_RATIO });
		const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
		return { dataUrl, base64, bytes: decodeBase64(base64), width, height };
	} finally {
		restoreMath();
	}
}
