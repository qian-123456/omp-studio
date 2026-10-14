/**
 * Locates a quoted annotation inside a rendered message so its numbered marker
 * can sit next to the quoted text. The search itself is pure string work
 * (`normalizeWithMap` / `locateQuote` / `segmentRange`); only `collectTextSegments`
 * and `segmentRange`'s Range construction touch the DOM.
 */

/** Whitespace-normalised text plus, per normalised char, its raw index. */
export interface NormalizedText {
	text: string;
	/** `map[i]` = raw index of normalised char `i`; `map[text.length]` = raw length. */
	map: number[];
}

const SPACE_RE = /\s/;

/**
 * Collapses every whitespace run to one space and trims both ends, keeping an
 * offset map back into the raw string so matches can be mapped to raw offsets.
 */
export function normalizeWithMap(raw: string): NormalizedText {
	let text = "";
	const map: number[] = [];
	let pendingSpace = -1;
	for (let i = 0; i < raw.length; i++) {
		const ch = raw[i];
		if (SPACE_RE.test(ch)) {
			// Leading whitespace is dropped; runs collapse to the first index.
			if (text.length > 0 && pendingSpace < 0) pendingSpace = i;
			continue;
		}
		if (pendingSpace >= 0) {
			text += " ";
			map.push(pendingSpace);
			pendingSpace = -1;
		}
		text += ch;
		map.push(i);
	}
	map.push(raw.length);
	return { text, map };
}

/** Longest-first search strings for a quote: its first non-empty line, then prefixes. */
export function quoteNeedles(quote: string): string[] {
	const firstLine = quote
		.split(/\r?\n/)
		.map((line) => normalizeWithMap(line).text)
		.find((line) => line.length > 0);
	if (!firstLine) return [];
	const needles = [firstLine];
	for (const len of [80, 40, 20]) {
		if (firstLine.length <= len) continue;
		const prefix = firstLine.slice(0, len).trimEnd();
		if (prefix.length > 0 && !needles.includes(prefix)) needles.push(prefix);
	}
	return needles;
}

/**
 * Finds `quote` inside `haystack` ignoring whitespace differences (newlines vs
 * spaces, runs of spaces, leading/trailing space). Tries the full first line
 * first, then shorter prefixes. Returns raw `[start, end)` offsets into
 * `haystack`, or null when nothing matches.
 */
export function locateQuote(
	haystack: string,
	quote: string,
): { start: number; end: number } | null {
	const needles = quoteNeedles(quote);
	if (needles.length === 0) return null;
	const hay = normalizeWithMap(haystack);
	for (const needle of needles) {
		const idx = hay.text.indexOf(needle);
		if (idx < 0) continue;
		return {
			start: hay.map[idx],
			// The last matched char is non-whitespace, so +1 is its exact raw end.
			end: hay.map[idx + needle.length - 1] + 1,
		};
	}
	return null;
}

/** A text node's slice of the concatenated text: `[start, start + length)`. */
export interface TextSegment<T> {
	node: T;
	start: number;
	length: number;
}

/** Start/end of a raw `[start, end)` match expressed as node + offset pairs. */
export interface SegmentEndpoints<T> {
	startNode: T;
	startOffset: number;
	endNode: T;
	endOffset: number;
}

/** Maps a raw `[start, end)` range over concatenated text back onto text nodes. */
export function segmentEndpoints<T>(
	segments: readonly TextSegment<T>[],
	start: number,
	end: number,
): SegmentEndpoints<T> | null {
	if (end <= start) return null;
	const first = segments.find(
		(s) => start >= s.start && start < s.start + s.length,
	);
	const last = segments.find(
		(s) => end - 1 >= s.start && end - 1 < s.start + s.length,
	);
	if (!first || !last) return null;
	return {
		startNode: first.node,
		startOffset: start - first.start,
		endNode: last.node,
		endOffset: end - last.start,
	};
}

/** Text nodes that never appear in a user's selection (or duplicate visible text). */
const SKIPPED_ANCESTOR = "script, style, .katex-mathml";

/**
 * Concatenates the visible text nodes under `root` in document order. Returns
 * the joined text together with the per-node segments needed by
 * `segmentEndpoints`.
 */
export function collectTextSegments(root: Element): {
	text: string;
	segments: TextSegment<Text>[];
} {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (parent?.closest(SKIPPED_ANCESTOR)) return NodeFilter.FILTER_REJECT;
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	const segments: TextSegment<Text>[] = [];
	const parts: string[] = [];
	let offset = 0;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		const data = (node as Text).data;
		if (data.length === 0) continue;
		segments.push({ node: node as Text, start: offset, length: data.length });
		parts.push(data);
		offset += data.length;
	}
	return { text: parts.join(""), segments };
}

/** DOM Range covering a raw `[start, end)` match, or null if it cannot be built. */
export function segmentRange<T extends Node>(
	segments: readonly TextSegment<T>[],
	start: number,
	end: number,
): Range | null {
	const ends = segmentEndpoints(segments, start, end);
	if (!ends) return null;
	const range = document.createRange();
	range.setStart(ends.startNode, ends.startOffset);
	range.setEnd(ends.endNode, ends.endOffset);
	return range;
}
