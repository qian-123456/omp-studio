/**
 * Pure helpers for privacy placeholders (§4 [P]): placeholder parsing and
 * value matching (whole-word for `risky` entries, longest value first).
 */

import type { SecretEntry } from "./contracts";

/** `⟦LABEL_xxxx⟧`; global + unicode — reset `lastIndex` or use `matchAll`. */
export const PLACEHOLDER_RE =
	/⟦([\p{Script=Han}A-Za-z0-9_]{1,24})_([0-9a-f]{4})⟧/gu;

export type PlaceholderPart = { text: string } | { placeholder: string };

export interface ValueMatch<E extends Pick<SecretEntry, "value" | "risk"> = SecretEntry> {
	start: number;
	end: number;
	entry: E;
}

/** Split text into plain runs and placeholder tokens (in order, no empty text parts). */
export function splitPlaceholders(text: string): PlaceholderPart[] {
	const parts: PlaceholderPart[] = [];
	let last = 0;
	for (const m of text.matchAll(PLACEHOLDER_RE)) {
		const start = m.index ?? 0;
		if (start > last) parts.push({ text: text.slice(last, start) });
		parts.push({ placeholder: m[0] });
		last = start + m[0].length;
	}
	if (last < text.length) parts.push({ text: text.slice(last) });
	return parts;
}

const WORD_CHAR = /[A-Za-z0-9_]/;

/**
 * Non-overlapping occurrences of entry values in `text`, sorted by start.
 * Longer values claim ranges first; `risky` entries match whole words only.
 */
export function findValueMatches<E extends Pick<SecretEntry, "value" | "risk">>(
	text: string,
	entries: readonly E[],
): ValueMatch<E>[] {
	const sorted = [...entries]
		.filter((e) => e.value.length > 0)
		.sort((a, b) => b.value.length - a.value.length);
	const taken: ValueMatch<E>[] = [];
	for (const entry of sorted) {
		const wholeWord = entry.risk === "risky";
		let from = 0;
		for (;;) {
			const start = text.indexOf(entry.value, from);
			if (start < 0) break;
			const end = start + entry.value.length;
			const boundaryOk =
				!wholeWord ||
				(!WORD_CHAR.test(text.charAt(start - 1)) && !WORD_CHAR.test(text.charAt(end)));
			const overlaps = taken.some((t) => start < t.end && end > t.start);
			if (boundaryOk && !overlaps) {
				taken.push({ start, end, entry });
				from = end;
			} else {
				from = start + 1;
			}
		}
	}
	return taken.sort((a, b) => a.start - b.start);
}

/** Replace each (non-overlapping) range with its entry's current placeholder. */
export function applyReplacements(
	text: string,
	ranges: readonly { start: number; end: number; entry: Pick<SecretEntry, "placeholder"> }[],
): string {
	let out = "";
	let last = 0;
	for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
		if (r.start < last) continue;
		out += text.slice(last, r.start) + r.entry.placeholder;
		last = r.end;
	}
	return out + text.slice(last);
}
