/** Height estimates for not-yet-measured transcript blocks.
 *
 * The virtualizer replaces an estimate with the measured height when a row
 * first renders; for rows above the viewport it then bumps scrollTop by the
 * difference. A flat 100px estimate made those corrections thousands of px
 * large, which reads as the list jumping while scrolling up. A content-based
 * guess keeps the corrections small. Constants assume the ~700px reading
 * column at 15px text; they only need to be roughly right.
 */
import type { DisplayBlock } from "./turnGrouping";

const PROTOCOL_ROW = 36;
const ROW_PADDING = 8;
const MIN_TURN = 60;
const USER_BUBBLE_BASE = 44;
const USER_LINE = 24;
const DISCLOSURE_ROW = 40;
const FOOTER_ROW = 52;
const TEXT_LINE = 26;
const PARAGRAPH_GAP = 12;
const CODE_LINE = 20;
const TABLE_ROW = 36;
const HEADING_ROW = 40;
/** Display columns per wrapped line; CJK glyphs count 1, other glyphs 0.5. */
const COLUMNS_PER_LINE = 46;

function displayWidth(line: string): number {
	let w = 0;
	for (const ch of line) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.5;
	return w;
}

function wrappedLines(line: string): number {
	return Math.max(1, Math.ceil(displayWidth(line) / COLUMNS_PER_LINE));
}

/** Rough rendered height (px) of markdown-ish text. */
export function estimateTextHeight(text: string | null | undefined): number {
	if (!text) return 0;
	let h = 0;
	let inFence = false;
	let prevBlank = true;
	for (const line of text.split("\n")) {
		if (line.trimStart().startsWith("```")) {
			inFence = !inFence;
			h += PARAGRAPH_GAP;
			continue;
		}
		if (inFence) {
			h += CODE_LINE;
			continue;
		}
		const t = line.trim();
		if (t === "") {
			prevBlank = true;
			continue;
		}
		if (prevBlank) h += PARAGRAPH_GAP;
		prevBlank = false;
		if (t.startsWith("|")) h += TABLE_ROW;
		else if (t.startsWith("#")) h += HEADING_ROW;
		else h += wrappedLines(t) * TEXT_LINE;
	}
	return h;
}

export function estimateBlockHeight(block: DisplayBlock | undefined): number {
	if (!block || block.type === "protocol") return PROTOCOL_ROW;
	let h = ROW_PADDING;
	if (block.userItem) {
		const text = block.userItem.text ?? "";
		const lines = text
			.split("\n")
			.reduce((n, l) => n + wrappedLines(l.trim() === "" ? "x" : l), 0);
		h += USER_BUBBLE_BASE + lines * USER_LINE;
	}
	if (block.intermediateSteps.length > 0) h += DISCLOSURE_ROW;
	if (block.answerItem) {
		h += estimateTextHeight(block.answerItem.text) + FOOTER_ROW;
	}
	return Math.max(MIN_TURN, h);
}
