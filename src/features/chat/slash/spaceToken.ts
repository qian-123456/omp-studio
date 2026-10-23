/** [B] Pure helpers for the composer's "space turns a typed token into a chip"
 * behaviour. */

export interface TypedSlashToken {
	/** Index of the `/` in the text before the space was typed. */
	start: number;
	/** Index just past the token (where the space was inserted). */
	end: number;
	/** Token name without the leading slash. */
	query: string;
}

/** Index at which exactly one space was inserted (`prev` → `next`, caret
 * right after it), or null for any other edit. */
export function insertedSpaceIndex(prev: string, next: string, cursor: number): number | null {
	if (next.length !== prev.length + 1 || cursor < 1 || next[cursor - 1] !== " ") return null;
	if (next.slice(0, cursor - 1) + next.slice(cursor) !== prev) return null;
	return cursor - 1;
}

/** A single space typed right after a `/token` (token at start or after
 * whitespace); the returned token indexes `prev`. */
export function detectSpaceToken(prev: string, next: string, cursor: number): TypedSlashToken | null {
	const idx = insertedSpaceIndex(prev, next, cursor);
	if (idx === null) return null;
	const m = /(?:^|\s)(\/([^\s/]+))$/.exec(prev.slice(0, idx));
	if (!m) return null;
	return { start: idx - m[1].length, end: idx, query: m[2] };
}

/** A single space typed after the first word of the draft: `word` is that
 * word (no whitespace) and `rest` the draft remainder past the space with
 * leading whitespace dropped. */
export function detectFirstWordSpace(
	prev: string,
	next: string,
	cursor: number,
): { word: string; rest: string } | null {
	const idx = insertedSpaceIndex(prev, next, cursor);
	if (idx === null) return null;
	const word = prev.slice(0, idx);
	if (!word || /\s/.test(word)) return null;
	return { word, rest: prev.slice(idx).replace(/^\s+/, "") };
}

/** First whitespace-delimited word of the draft start, with the remainder
 * (leading whitespace dropped). */
export function splitFirstWord(text: string): { word: string; rest: string } {
	const m = /^(\S*)\s*/.exec(text);
	const word = m?.[1] ?? "";
	return { word, rest: text.slice(m?.[0].length ?? 0) };
}
