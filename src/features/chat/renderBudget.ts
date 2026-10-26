/** Render budget of the virtualized transcript.
 *
 * A fixed `overscan: N` mounts N rows no matter how heavy they are: with a few
 * huge turns around the viewport that is seconds of markdown/highlight work,
 * with many tiny rows it is needlessly little. Instead every row has a cost
 * (≈ how much it takes to mount) and neighbours of the visible range are
 * mounted until a per-side height or cost budget is used up.
 */
import type { HistoryRow } from "./turnGrouping";

/** Neighbour rows are mounted until this much height is covered per side… */
export const MAX_OVERSCAN_HEIGHT_PX = 900;
/** …or until adding the next one would exceed this cost per side. */
export const MAX_OVERSCAN_COST = 25;

export interface BlockCostInput {
	/** Measured height when known, else the estimate (px). */
	height: number;
	/** Characters of markdown/prose the row renders. */
	chars: number;
	codeBlocks: number;
	toolCalls: number;
}

/** Mount cost of a row: height/100 + chars/800 + codeBlocks*1.5 + toolCalls*0.3. */
export function calculateBlockCost(m: BlockCostInput): number {
	return m.height / 100 + m.chars / 800 + m.codeBlocks * 1.5 + m.toolCalls * 0.3;
}

type StaticMetrics = Omit<BlockCostInput, "height">;

const FENCE_RE = /^ {0,3}(```|~~~)/gm;

function countCodeBlocks(text: string): number {
	let fences = 0;
	FENCE_RE.lastIndex = 0;
	while (FENCE_RE.exec(text) !== null) fences++;
	return Math.ceil(fences / 2);
}

const metricsCache = new WeakMap<object, StaticMetrics>();

/** Height-independent cost inputs of a row (cached per row object). */
export function rowStaticMetrics(row: HistoryRow): StaticMetrics {
	const cached = metricsCache.get(row);
	if (cached) return cached;
	let chars = 0;
	let codeBlocks = 0;
	let toolCalls = 0;
	const add = (text: string | null | undefined) => {
		if (!text) return;
		chars += text.length;
		codeBlocks += countCodeBlocks(text);
	};
	if (row.type === "protocol") {
		add(row.item.text);
	} else {
		add(row.userItem?.text);
		for (const step of row.intermediateSteps) {
			if (step.kind === "tool") toolCalls++;
			// Only interim prose is visible while the fold is collapsed.
			else if (step.kind === "text") add(step.text);
		}
		if (row.answerItem) add(row.answerSlice ?? row.answerItem.text);
	}
	const metrics = { chars, codeBlocks, toolCalls };
	metricsCache.set(row, metrics);
	return metrics;
}

export interface RenderWindow {
	count: number;
	/** The virtualizer's visible range (inclusive). */
	startIndex: number;
	endIndex: number;
	heightOf: (index: number) => number;
	costOf: (index: number) => number;
}

/**
 * Indexes to mount: the visible range plus neighbours on each side until the
 * side's height budget is covered or the next neighbour would break the cost
 * budget. Ascending, no duplicates.
 */
export function selectRenderIndexes(w: RenderWindow): number[] {
	if (w.count <= 0) return [];
	const start = Math.max(0, Math.min(w.startIndex, w.count - 1));
	const end = Math.max(start, Math.min(w.endIndex, w.count - 1));
	let first = start;
	let height = 0;
	let cost = 0;
	for (let i = start - 1; i >= 0 && height < MAX_OVERSCAN_HEIGHT_PX; i--) {
		const c = w.costOf(i);
		if (cost + c > MAX_OVERSCAN_COST) break;
		cost += c;
		height += w.heightOf(i);
		first = i;
	}
	let last = end;
	height = 0;
	cost = 0;
	for (let i = end + 1; i < w.count && height < MAX_OVERSCAN_HEIGHT_PX; i++) {
		const c = w.costOf(i);
		if (cost + c > MAX_OVERSCAN_COST) break;
		cost += c;
		height += w.heightOf(i);
		last = i;
	}
	const out: number[] = [];
	for (let i = first; i <= last; i++) out.push(i);
	return out;
}

/**
 * Indexes to mount while the viewport is pinned to the bottom: the newest rows
 * covering `viewportPx`, plus the usual overscan budget above them. Used for a
 * cold open, where the virtualizer's own range still points at the (stale or
 * default) top and would mount the oldest turns first.
 */
export function selectTailIndexes(
	w: Pick<RenderWindow, "count" | "heightOf" | "costOf"> & { viewportPx: number },
): number[] {
	if (w.count <= 0) return [];
	let startIndex = w.count - 1;
	let covered = w.heightOf(startIndex);
	while (startIndex > 0 && covered < w.viewportPx) {
		startIndex--;
		covered += w.heightOf(startIndex);
	}
	return selectRenderIndexes({
		count: w.count,
		startIndex,
		endIndex: w.count - 1,
		heightOf: w.heightOf,
		costOf: w.costOf,
	});
}
