/**
 * Display-only parser for the quote blocks `formatWithAnnotations` (stores/composer)
 * writes at the top of an outgoing message:
 *
 *   [1] (label)            ← header, `(label)` optional; side-chat echoes prefix "> "
 *   > quoted line          ← zero or more quote lines
 *   批注：comment           ← optional (may continue over following non-blank lines)
 *
 *   [2] 文件 path 第 3-4 行：comment   ← diff annotations carry the comment in the header
 *
 *   the user's own message
 *
 * The message sent to the agent is never changed; this only lets the bubble draw the
 * blocks as structured cards. Text that does not look like that exact shape parses to
 * `null` and keeps rendering as plain text.
 */

export interface QuoteCard {
	n: number;
	/** Location label from the header: `(label)` or `path 第 x 行` for diffs. */
	label?: string;
	/** Quoted text, `> ` prefixes removed. */
	quote: string;
	comment?: string;
}

export interface ParsedQuotes {
	cards: QuoteCard[];
	/** The user's own message after the quote blocks. */
	body: string;
}

const HEADER_RE = /^(?:>\s?)?\[(\d+)\](.*)$/;
const DIFF_HEADER_RE = /^\s*文件 (.+?)(?: 第 (.+?) 行)?：(.*)$/;
const NOTE_PREFIX = "批注：";
const IMAGE_HEADER_RE = /\.(?:png|jpe?g|gif|webp|svg|bmp)\b/i;

export function parseAnnotationQuotes(text: string): ParsedQuotes | null {
	const lines = text.split("\n");
	const cards: QuoteCard[] = [];
	let i = 0;
	while (i < lines.length) {
		const head = HEADER_RE.exec(lines[i]);
		if (!head || Number(head[1]) !== cards.length + 1) break;
		const rest = head[2];
		if (IMAGE_HEADER_RE.test(rest)) return null;
		const card: QuoteCard = { n: cards.length + 1, quote: "" };
		let isDiff = false;
		const diff = DIFF_HEADER_RE.exec(rest);
		if (diff) {
			isDiff = true;
			card.label = diff[2] ? `${diff[1]} 第 ${diff[2]} 行` : diff[1];
			card.comment = diff[3].trim() || undefined;
		} else {
			const loc = /^\s*\((.*)\)\s*$/.exec(rest);
			if (loc) card.label = loc[1];
			else if (rest.trim() !== "") break;
		}
		let j = i + 1;
		const quote: string[] = [];
		while (j < lines.length && lines[j].startsWith(">")) {
			quote.push(lines[j].replace(/^>\s?/, ""));
			j++;
		}
		card.quote = quote.join("\n");
		if (!isDiff && j < lines.length && lines[j].startsWith(NOTE_PREFIX)) {
			const note = [lines[j].slice(NOTE_PREFIX.length)];
			j++;
			while (j < lines.length && lines[j].trim() !== "") note.push(lines[j++]);
			card.comment = note.join("\n") || undefined;
		}
		// A bare "[1]" the user typed is not a quote block.
		if (!card.quote && !card.comment && !isDiff) break;
		cards.push(card);
		i = j;
		while (i < lines.length && lines[i].trim() === "") i++;
	}
	if (cards.length === 0) return null;
	return { cards, body: lines.slice(i).join("\n").trim() };
}
