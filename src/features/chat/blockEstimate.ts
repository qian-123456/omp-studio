/** Height estimates for not-yet-measured transcript blocks.
 *
 * The virtualizer replaces an estimate with the measured height when a row
 * first renders; for rows above the viewport it then bumps scrollTop by the
 * difference. A flat 100px estimate made those corrections thousands of px
 * large, which reads as the list jumping while scrolling up. A content-based
 * guess keeps the corrections small. Constants assume the ~700px reading
 * column at 15px text; they only need to be roughly right.
 */
import type { TranscriptItem } from "../../lib/contracts";
import { type DisplayBlock, splitInterimProse } from "./turnGrouping";

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

function userBubbleHeight(text: string): number {
	const lines = text
		.split("\n")
		.reduce((n, l) => n + wrappedLines(l.trim() === "" ? "x" : l), 0);
	const shown = Math.min(lines, USER_CLAMP_LINES);
	return USER_BUBBLE_BASE + shown * USER_LINE + (lines > USER_CLAMP_LINES ? USER_CLAMP_PILL : 0);
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

/** UserRow clamps the bubble to this many lines (plus a 「查看更多」 pill). */
const USER_CLAMP_LINES = 4;
const USER_CLAMP_PILL = 24;
/** Local-row cards (command output) are capped and scroll inside. */
const LOCAL_ROW_MAX = 280;

export function estimateBlockHeight(block: DisplayBlock | undefined): number {
	if (!block) return PROTOCOL_ROW;
	if (block.type === "protocol") {
		const item = block.item as TranscriptItem & { localRow?: { type: string } };
		// Local command-output cards are tall; echoes are a user bubble.
		if (item.localRow?.type === "output") {
			const lines = estimateTextHeight(item.text) || CODE_LINE;
			return Math.min(LOCAL_ROW_MAX, ROW_PADDING + 40 + lines);
		}
		if (item.localRow?.type === "echo") {
			return ROW_PADDING + userBubbleHeight(item.text ?? "");
		}
		return PROTOCOL_ROW;
	}
	let h = ROW_PADDING;
	if (block.userItem) h += userBubbleHeight(block.userItem.text ?? "");
	const { folded, prose } = splitInterimProse(block.intermediateSteps);
	if (folded.length > 0) h += DISCLOSURE_ROW;
	for (const step of prose) {
		// Long interim prose is clamped (ClampedProse) to ~320px plus its pill.
		if (step.kind === "text") h += Math.min(estimateTextHeight(step.text), 360);
	}
	if (block.answerItem) {
		h += estimateTextHeight(block.answerItem.text) + FOOTER_ROW;
	}
	return Math.max(MIN_TURN, h);
}
