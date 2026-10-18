/** [B] Reasoning that a provider delivers inside plain `text` content
 * (`<think>…</think>` / `<thinking>…</thinking>`) is moved into thinking parts,
 * so it renders as a collapsible thinking row instead of reply prose. Works on
 * streaming partials: an unclosed opener keeps everything after it as thinking,
 * and a half-typed tag at the very end is held back until it completes. */

const TAG_RE = /<(\/?)think(?:ing)?>/gi;
const TAG_NAMES = ["think>", "thinking>"];

export interface ThinkSplit {
	/** Reply prose with all reasoning removed. */
	text: string;
	/** Reasoning chunks joined by a blank line; "" when none. */
	thinking: string;
	/** An opener was seen and never closed (still reasoning). */
	open: boolean;
}

/** Index ranges covered by ``` fenced code blocks (tags inside are literal). */
function fenceRanges(raw: string): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	let start = -1;
	let pos = 0;
	for (const line of raw.split("\n")) {
		if (/^\s{0,3}(```|~~~)/.test(line)) {
			if (start < 0) start = pos;
			else {
				out.push([start, pos + line.length]);
				start = -1;
			}
		}
		pos += line.length + 1;
	}
	if (start >= 0) out.push([start, raw.length]);
	return out;
}

/** A trailing "<", "</", "<thi" … that could still become a think tag. */
function partialTagTail(raw: string): number {
	const i = raw.lastIndexOf("<");
	if (i < 0) return -1;
	const rest = raw.slice(i + 1).toLowerCase();
	const body = rest.startsWith("/") ? rest.slice(1) : rest;
	if (body === "" || TAG_NAMES.some((n) => n.startsWith(body) && body !== n)) {
		return i;
	}
	return -1;
}

export function splitThinkTags(
	raw: string,
	opts: { streaming?: boolean } = {},
): ThinkSplit {
	if (!/<\/?t|<\/?$/i.test(raw)) return { text: raw, thinking: "", open: false };
	let src = raw;
	if (opts.streaming) {
		const cut = partialTagTail(src);
		if (cut >= 0) src = src.slice(0, cut);
	}
	const fences = fenceRanges(src);

	let text = "";
	const chunks: string[] = [];
	let inThink = false;
	let seenOpener = false;
	let pos = 0;
	for (const m of src.matchAll(TAG_RE)) {
		const at = m.index ?? 0;
		if (fences.some(([a, b]) => at >= a && at < b)) continue;
		const piece = src.slice(pos, at);
		pos = at + m[0].length;
		if (m[1] === "") {
			// Opener: what came before is prose (or still-open reasoning).
			if (inThink) chunks[chunks.length - 1] += piece;
			else text += piece;
			chunks.push("");
			inThink = true;
			seenOpener = true;
		} else if (inThink) {
			chunks[chunks.length - 1] += piece;
			inThink = false;
		} else if (!seenOpener && chunks.length === 0) {
			// Closer with no opener: the chat template swallowed `<think>`, so
			// everything before the closer is reasoning.
			chunks.push(text + piece);
			text = "";
			seenOpener = true;
		} else {
			// Stray closer after reasoning already closed: drop the tag only.
			text += piece;
		}
	}
	const rest = src.slice(pos);
	if (inThink) chunks[chunks.length - 1] += rest;
	else text += rest;

	const thinking = chunks
		.map((c) => c.trim())
		.filter(Boolean)
		.join("\n\n");
	if (chunks.length > 0) text = text.replace(/^\s+/, "");
	return { text, thinking, open: inThink };
}

type Part = Record<string, unknown>;

/**
 * Expands `text` parts that carry think tags into [thinking, text] part pairs.
 * Content without tags is returned as the same array (no allocation), so
 * memoised consumers keep their identity.
 */
export function normalizeThinkContent(
	content: unknown[],
	opts: { streaming?: boolean } = {},
): unknown[] {
	let out: unknown[] | null = null;
	content.forEach((part, i) => {
		const p = part as Part | null;
		let expanded: unknown[] | null = null;
		if (p && p.type === "text" && typeof p.text === "string") {
			// Only the newest part can still be mid-tag while streaming.
			const split = splitThinkTags(p.text, {
				streaming: opts.streaming && i === content.length - 1,
			});
			if (split.thinking !== "" || split.open || split.text !== p.text) {
				expanded = [];
				if (split.thinking !== "") {
					expanded.push({ type: "thinking", thinking: split.thinking });
				}
				if (split.text !== "") expanded.push({ ...p, text: split.text });
			}
		}
		if (expanded && !out) out = content.slice(0, i);
		if (out) out.push(...(expanded ?? [part]));
	});
	return out ?? content;
}
