/** Splits grouped turns into virtualizer rows.
 *
 * One TurnBlock used to be one row, so a single huge turn (long answer, many
 * interim paragraphs) was mounted as a whole the moment any pixel of it was
 * visible. A turn is now cut at *render-neutral* boundaries into parts of
 * about `PART_TARGET_PX` each:
 *
 *   user bubble | fold | interim prose paragraphs / steers … | answer slices
 *
 * The cuts never change what is rendered: a run's fold (one disclosure) stays
 * whole, interim prose is cut between paragraphs-items, and the answer is cut
 * between top-level markdown paragraphs outside fenced code. Every source item
 * lands in exactly one part.
 */
import {
	DISCLOSURE_ROW,
	estimateTextHeight,
	estimateUserBubbleHeight,
	INTERIM_PROSE_MAX,
	ROW_PADDING,
	STEER_ROW,
} from "./blockEstimate";
import {
	type DisplayBlock,
	type HistoryRow,
	type HistoryTurnRow,
	splitInterimProseBySteer,
	type TurnBlock,
	type TurnStep,
} from "./turnGrouping";

/** Estimated height a part may reach before the next piece opens a new part. */
export const PART_TARGET_PX = 700;
/** An answer shorter than this (estimated px) is never sliced. */
export const ANSWER_SLICE_PX = 600;

type Piece =
	| { kind: "user"; height: number }
	| { kind: "fold"; steps: TurnStep[]; height: number }
	| { kind: "prose"; step: TurnStep; height: number }
	| { kind: "steer"; step: TurnStep; height: number }
	| { kind: "answer"; text: string | null; index: number; count: number; height: number };

/** Blocks that make top-level splitting unsafe (cross-paragraph syntax). */
const NO_SPLIT_RE = /^\s{0,3}\[[^\]]+\]:\s|<\/?(?:details|summary|div|table|pre|blockquote)\b/im;
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})/;
/** A line that may continue a list / quote across a blank line. */
const CONTINUES_BLOCK_RE = /^(\s|[-*+]\s|\d+[.)]\s|>)/;

/**
 * Cuts markdown into slices of about `targetPx` at blank lines outside fenced
 * code whose next line starts a fresh top-level paragraph (not indented, not a
 * list item, not a quote). `slices.join("\n") === text` always holds.
 */
export function splitAnswerText(text: string, targetPx: number = ANSWER_SLICE_PX): string[] {
	if (!text || estimateTextHeight(text) <= targetPx * 1.5 || NO_SPLIT_RE.test(text)) return [text];
	const lines = text.split("\n");
	const slices: string[] = [];
	let from = 0;
	let fence: string | null = null;
	for (let i = 0; i < lines.length - 1; i++) {
		const line = lines[i];
		const m = FENCE_LINE_RE.exec(line);
		if (m) {
			if (fence === null) fence = m[1][0];
			else if (m[1][0] === fence) fence = null;
			continue;
		}
		if (fence !== null || line.trim() !== "") continue;
		let j = i + 1;
		while (j < lines.length && lines[j].trim() === "") j++;
		if (j >= lines.length || CONTINUES_BLOCK_RE.test(lines[j])) continue;
		// Keep a meaningful remainder instead of a tiny orphan tail.
		if (lines.length - (i + 1) < 6) break;
		const head = lines.slice(from, i + 1).join("\n");
		if (estimateTextHeight(head) < targetPx) continue;
		slices.push(head);
		from = i + 1;
	}
	slices.push(lines.slice(from).join("\n"));
	return slices;
}

function turnPieces(turn: TurnBlock): Piece[] {
	const pieces: Piece[] = [];
	if (turn.userItem) {
		pieces.push({ kind: "user", height: estimateUserBubbleHeight(turn.userItem.text ?? "") });
	}
	for (const seg of splitInterimProseBySteer(turn.intermediateSteps)) {
		if (seg.type === "steer") {
			pieces.push({ kind: "steer", step: seg.step, height: STEER_ROW });
			continue;
		}
		if (seg.folded.length > 0) {
			pieces.push({ kind: "fold", steps: seg.folded, height: DISCLOSURE_ROW });
		}
		for (const step of seg.prose) {
			const h = step.kind === "text" ? Math.min(estimateTextHeight(step.text), INTERIM_PROSE_MAX) : 0;
			pieces.push({ kind: "prose", step, height: h });
		}
	}
	if (turn.answerItem) {
		// A stopped turn renders no answer text, so there is nothing to slice.
		const text = turn.answerItem.text ?? "";
		const slices = turn.answerItem.stopReason === "aborted" ? [text] : splitAnswerText(text);
		slices.forEach((slice, index) => {
			pieces.push({
				kind: "answer",
				text: slices.length > 1 ? slice : null,
				index,
				count: slices.length,
				height: estimateTextHeight(slice),
			});
		});
	}
	return pieces;
}

/** Greedy packing: a piece opens a new part when it would overflow a non-empty one. */
function packParts(pieces: Piece[]): Piece[][] {
	const parts: Piece[][] = [];
	let cur: Piece[] = [];
	let height = ROW_PADDING;
	for (const p of pieces) {
		// A lone user bubble is too small to be a row of its own: the next piece joins it.
		const loneUser = cur.length === 1 && cur[0].kind === "user";
		if (cur.length > 0 && !loneUser && height + p.height > PART_TARGET_PX) {
			parts.push(cur);
			cur = [];
			height = ROW_PADDING;
		}
		cur.push(p);
		height += p.height;
	}
	if (cur.length > 0) parts.push(cur);
	return parts;
}

function buildTurnRows(turn: TurnBlock): HistoryTurnRow[] {
	const parts = packParts(turnPieces(turn));
	const partCount = Math.max(1, parts.length);
	if (partCount === 1) {
		// The whole turn is one row: keep the block itself (stable identity,
		// id, item ids) and only add the part info.
		return [
			{
				...turn,
				turnId: turn.id,
				partIndex: 0,
				partCount: 1,
				isFirstTurnPart: true,
				isLastTurnPart: true,
				isContinuation: false,
				renderAnswerAnchor: Boolean(turn.answerItem),
				ownsFirstFold: true,
				ownsLastFold: true,
				turn,
			},
		];
	}

	const claimed = new Set<string>();
	const claim = (ids: Array<string | undefined | null>): string[] => {
		const out: string[] = [];
		for (const id of ids) {
			if (id && !claimed.has(id)) {
				claimed.add(id);
				out.push(id);
			}
		}
		return out;
	};
	let foldSeen = 0;
	const foldTotal = parts.reduce((n, p) => n + p.filter((x) => x.kind === "fold").length, 0);
	let answerAnchorGiven = false;

	const rows = parts.map((pieces, partIndex): HistoryTurnRow => {
		const steps: TurnStep[] = [];
		const ids: Array<string | undefined> = [];
		let userItem: TurnBlock["userItem"] = null;
		let answerItem: TurnBlock["answerItem"];
		const sliceTexts: string[] = [];
		let answerSliceIndex: number | undefined;
		let answerSliceCount: number | undefined;
		let ownsFirstFold = false;
		let ownsLastFold = false;
		let renderAnswerAnchor = false;
		for (const p of pieces) {
			switch (p.kind) {
				case "user":
					userItem = turn.userItem;
					ids.push(turn.userItem?.id);
					break;
				case "fold":
					steps.push(...p.steps);
					for (const s of p.steps) ids.push(s.item.id);
					if (foldSeen === 0) ownsFirstFold = true;
					foldSeen++;
					if (foldSeen === foldTotal) ownsLastFold = true;
					break;
				case "prose":
				case "steer":
					steps.push(p.step);
					ids.push(p.step.item.id);
					break;
				case "answer":
					answerItem = turn.answerItem;
					if (p.count > 1) {
						sliceTexts.push(p.text ?? "");
						answerSliceIndex ??= p.index;
						answerSliceCount = p.count;
					}
					if (!answerAnchorGiven) {
						answerAnchorGiven = true;
						renderAnswerAnchor = true;
						ids.push(turn.answerItem?.id);
					}
					break;
			}
		}
		return {
			...turn,
			id: `${turn.id}#${partIndex}`,
			turnId: turn.id,
			userItem,
			intermediateSteps: steps,
			answerItem,
			allItemIds: claim(ids),
			partIndex,
			partCount,
			isFirstTurnPart: partIndex === 0,
			isLastTurnPart: partIndex === partCount - 1,
			isContinuation: partIndex > 0,
			renderAnswerAnchor,
			ownsFirstFold,
			ownsLastFold,
			answerSlice: sliceTexts.length > 0 ? sliceTexts.join("\n") : undefined,
			answerSliceIndex,
			answerSliceCount,
			turn,
		};
	});

	// Source ids no part claimed (tool-result items, hidden items) ride on part 0
	// so every jump target still resolves to a row.
	const leftover = turn.allItemIds.filter((id) => !claimed.has(id));
	if (leftover.length > 0) rows[0].allItemIds = [...rows[0].allItemIds, ...claim(leftover)];
	return rows;
}

/** Virtualizer rows for the grouped transcript (protocol blocks pass through). */
export function buildHistoryRows(blocks: readonly DisplayBlock[]): HistoryRow[] {
	const out: HistoryRow[] = [];
	for (const b of blocks) {
		if (b.type === "protocol") out.push(b);
		else out.push(...buildTurnRows(b));
	}
	return out;
}

/** Index of the first row holding `itemId` (a message id or any grouped item id). */
export function findRowIndexByItemId(rows: readonly HistoryRow[], itemId: string): number {
	return rows.findIndex((r) => r.allItemIds.includes(itemId));
}
