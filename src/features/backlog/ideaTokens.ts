import type { BacklogRef } from "../../lib/contracts";

// Pure token <-> text logic for ideas with inline image placeholders.
//
// Stored form (BacklogItem.text): images live inline as `[图片: path]` tags, which
// `ideaImages` / the dispatch prompt already understand. Legacy items keep images in
// `refs` (kind "image") with no tag in the text.
// Editable form: each image is a `🖼️ #N` token (N = 1-based index into `images`),
// the same inline token the chat composer uses.

export interface TokenDoc {
	text: string;
	images: string[];
}

const STORED_TAG = /\[图片:\s*([^\]]+?)\s*\]/g;
const DOC_TOKEN = /🖼️\s*#(\d+)/gu;

export const imageToken = (n: number): string => `🖼️ #${n}`;

/** Pattern matching one editable image token (fresh instance; has the `g` flag). */
export const imageTokenRegex = (): RegExp => new RegExp(DOC_TOKEN.source, "gu");

export type TokenSegment = { kind: "text"; value: string } | { kind: "image"; index: number; raw: string };

/** Split editable text into plain-text and image-token segments. */
export function splitTokens(text: string): TokenSegment[] {
	const out: TokenSegment[] = [];
	let last = 0;
	for (const m of text.matchAll(imageTokenRegex())) {
		const at = m.index ?? 0;
		if (at > last) out.push({ kind: "text", value: text.slice(last, at) });
		out.push({ kind: "image", index: Number(m[1]), raw: m[0] });
		last = at + m[0].length;
	}
	if (last < text.length) out.push({ kind: "text", value: text.slice(last) });
	return out;
}

/**
 * Stored text (+ legacy image refs) → editable doc. Inline tags become tokens in order of
 * first appearance; ref images without a tag get tokens appended at the end.
 */
export function storedToDoc(stored: string, refImages: readonly string[] = []): TokenDoc {
	const images: string[] = [];
	const indexOf = (p: string) => {
		let i = images.indexOf(p);
		if (i < 0) {
			images.push(p);
			i = images.length - 1;
		}
		return i + 1;
	};
	let text = stored.replace(STORED_TAG, (_m, p: string) => imageToken(indexOf(p)));
	const extra = refImages.filter((p) => !images.includes(p));
	if (extra.length > 0) {
		const tokens = extra.map((p) => imageToken(indexOf(p))).join(" ");
		text = text.trim().length > 0 ? `${text.trimEnd()} ${tokens}` : tokens;
	}
	return { text, images };
}

/** Editable doc → stored text with inline `[图片: path]` tags. Tokens pointing nowhere are dropped. */
export function docToStored(doc: TokenDoc): string {
	return doc.text
		.replace(imageTokenRegex(), (_m, n: string) => {
			const p = doc.images[Number(n) - 1];
			return p ? `[图片: ${p}]` : "";
		})
		.trim();
}

/**
 * After a text edit: drop images whose token vanished, drop tokens that point nowhere,
 * and renumber the survivors so `#N` always equals position + 1.
 */
export function reconcileDoc(doc: TokenDoc): TokenDoc {
	const used = new Set<number>();
	for (const m of doc.text.matchAll(imageTokenRegex())) {
		const n = Number(m[1]);
		if (n >= 1 && n <= doc.images.length) used.add(n);
	}
	const keep = [...used].sort((a, b) => a - b);
	const remap = new Map(keep.map((old, i) => [old, i + 1]));
	const text = doc.text.replace(imageTokenRegex(), (_m, n: string) => {
		const next = remap.get(Number(n));
		return next ? imageToken(next) : "";
	});
	return { text, images: keep.map((n) => doc.images[n - 1]) };
}

/** Remove image `n` (1-based): delete its tokens, then renumber the rest. */
export function removeImage(doc: TokenDoc, n: number): TokenDoc {
	const text = doc.text.replace(imageTokenRegex(), (m, k: string) => (Number(k) === n ? "" : m));
	return reconcileDoc({ text, images: doc.images });
}

/** Paths of `image` refs (legacy storage), in order. */
export const refImagePaths = (refs: readonly BacklogRef[]): string[] =>
	refs.flatMap((r) => (r.kind === "image" && r.path ? [r.path] : []));

/** Append tokens for images that no token references (legacy drafts / buffers). */
export function ensureTokens(doc: TokenDoc): TokenDoc {
	const present = new Set([...doc.text.matchAll(imageTokenRegex())].map((m) => Number(m[1])));
	const missing = doc.images.flatMap((_p, i) => (present.has(i + 1) ? [] : [imageToken(i + 1)]));
	if (missing.length === 0) return doc;
	const tokens = missing.join(" ");
	return { ...doc, text: doc.text.trim().length > 0 ? `${doc.text.trimEnd()} ${tokens}` : tokens };
}

/**
 * Insert tokens for `paths` at `caret` (already attached images are reused). Returns the new
 * doc and the caret position right after the inserted tokens.
 */
export function insertImages(doc: TokenDoc, caret: number, paths: readonly string[]): { doc: TokenDoc; caret: number } {
	const images = [...doc.images];
	const tokens: string[] = [];
	for (const p of paths) {
		let i = images.indexOf(p);
		if (i < 0) {
			images.push(p);
			i = images.length - 1;
		}
		tokens.push(imageToken(i + 1));
	}
	const at = Math.max(0, Math.min(caret, doc.text.length));
	const before = doc.text.slice(0, at);
	const after = doc.text.slice(at);
	const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
	const trail = after.length > 0 && !/^\s/.test(after) ? " " : "";
	const ins = `${lead}${tokens.join(" ")}${trail}`;
	return { doc: { text: before + ins + after, images }, caret: before.length + ins.length };
}

/**
 * Stored idea text → chat composer draft text. Each inline `[图片: path]` tag (and each legacy
 * ref image, appended at the end) becomes the composer's own `🖼️#N` token, where N comes from
 * `numberOf(path)` — the image's slot in the composer's attachment list.
 */
export function toComposerText(
	stored: string,
	refImages: readonly string[],
	numberOf: (path: string) => number,
): string {
	const seen = new Set<string>();
	const text = stored.replace(STORED_TAG, (_m, p: string) => {
		seen.add(p);
		return `🖼️#${numberOf(p)}`;
	});
	const extra = refImages.filter((p) => !seen.has(p)).map((p) => `🖼️#${numberOf(p)}`);
	return extra.length > 0 ? `${text} ${extra.join(" ")}`.trim() : text;
}

/** Every image path an item references (inline tags first, then legacy refs), deduped, in order. */
export function storedImagePaths(stored: string, refImages: readonly string[]): string[] {
	const paths = [...stored.matchAll(STORED_TAG)].map((m) => m[1]);
	return [...new Set([...paths, ...refImages])];
}
