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
import { type DisplayBlock, type HistoryRow, splitInterimProseBySteer } from "./turnGrouping";

const PROTOCOL_ROW = 36;
export const ROW_PADDING = 8;
const MIN_TURN = 60;
const USER_BUBBLE_BASE = 44;
const USER_LINE = 24;
/** Collapsed 「已处理」 header + hairline + margins. */
export const DISCLOSURE_ROW = 48;
export const FOOTER_ROW = 56;
/** A steer bubble rendered between activity groups. */
export const STEER_ROW = 64;
export const INTERIM_PROSE_MAX = 360;
const TEXT_LINE = 26;
const PARAGRAPH_GAP = 12;
const CODE_LINE = 20;
/** Code block chrome (header strip + padding + margins) beyond its lines. */
const CODE_BLOCK_CHROME = 44;
const LIST_ITEM_GAP = 6;
const TABLE_ROW = 36;
const HEADING_ROW = 40;
/** Display columns per wrapped line; CJK glyphs count 1, other glyphs 0.5. */
const COLUMNS_PER_LINE = 40;

function displayWidth(line: string): number {
	let w = 0;
	for (const ch of line) w += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.5;
	return w;
}

function wrappedLines(line: string): number {
	return Math.max(1, Math.ceil(displayWidth(line) / COLUMNS_PER_LINE));
}

export function estimateUserBubbleHeight(text: string): number {
	const lines = text
		.split("\n")
		.reduce((n, l) => n + wrappedLines(l.trim() === "" ? "x" : l), 0);
	const shown = Math.min(lines, USER_CLAMP_LINES);
	return USER_BUBBLE_BASE + shown * USER_LINE + (lines > USER_CLAMP_LINES ? USER_CLAMP_PILL : 0);
}
const LIST_ITEM_RE = /^([-*+]|\d+[.)])\s/;

/** Rough rendered height (px) of markdown-ish text. */
export function estimateTextHeight(text: string | null | undefined): number {
	if (!text) return 0;
	let h = 0;
	let inFence = false;
	let prevBlank = true;
	for (const line of text.split("\n")) {
		if (line.trimStart().startsWith("```")) {
			inFence = !inFence;
			// The opening fence pays for the block chrome; the closing one only a gap.
			h += inFence ? CODE_BLOCK_CHROME : PARAGRAPH_GAP;
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
		else if (LIST_ITEM_RE.test(t)) h += wrappedLines(t) * TEXT_LINE + LIST_ITEM_GAP;
		else h += wrappedLines(t) * TEXT_LINE;
	}
	return h;
}

/** UserRow clamps the bubble to this many lines (plus a 「查看更多」 pill). */
const USER_CLAMP_LINES = 4;
const USER_CLAMP_PILL = 24;
/** Local-row cards (command output) are capped and scroll inside. */
const LOCAL_ROW_MAX = 280;

export function estimateBlockHeight(block: DisplayBlock | HistoryRow | undefined): number {
	if (!block) return PROTOCOL_ROW;
	if (block.type === "protocol") {
		const item = block.item as TranscriptItem & { localRow?: { type: string } };
		// Local command-output cards are tall; echoes are a user bubble.
		if (item.localRow?.type === "output") {
			const lines = estimateTextHeight(item.text) || CODE_LINE;
			return Math.min(LOCAL_ROW_MAX, ROW_PADDING + 40 + lines);
		}
		if (item.localRow?.type === "echo") {
			return ROW_PADDING + estimateUserBubbleHeight(item.text ?? "");
		}
		return PROTOCOL_ROW;
	}
	// A part of a split turn: only what this part renders, footer on the last.
	const part = "turnId" in block ? block : null;
	let h = ROW_PADDING;
	if (block.userItem) h += estimateUserBubbleHeight(block.userItem.text ?? "");
	for (const seg of splitInterimProseBySteer(block.intermediateSteps)) {
		if (seg.type === "steer") continue;
		if (seg.folded.length > 0) h += DISCLOSURE_ROW;
		for (const step of seg.prose) {
			if (step.kind === "text") h += Math.min(estimateTextHeight(step.text), INTERIM_PROSE_MAX);
		}
	}
	for (const step of block.intermediateSteps) if (step.kind === "steer") h += STEER_ROW;
	if (block.answerItem) {
		h += estimateTextHeight(part?.answerSlice ?? block.answerItem.text);
		if (!part || part.isLastTurnPart) h += FOOTER_ROW;
	}
	return Math.max(part?.isContinuation ? ROW_PADDING + 24 : MIN_TURN, h);
}
