export type Point = readonly [number, number];

export interface Stroke {
	color: string;
	width: number;
	pts: Point[];
}

export const SKETCH_COLORS = ["#111111", "#e5372e", "#f59e0b", "#22a559", "#2f6fed", "#8b5cf6", "#ffffff"] as const;
export const SKETCH_PAPER = SKETCH_COLORS[SKETCH_COLORS.length - 1];
export const SKETCH_WIDTHS = [3, 6, 12] as const;
export const COLOR_NAMES: Record<string, string> = {
	"#111111": "黑色",
	"#e5372e": "红色",
	"#f59e0b": "橙色",
	"#22a559": "绿色",
	"#2f6fed": "蓝色",
	"#8b5cf6": "紫色",
	"#ffffff": "白色",
};

/** Immutable stroke list operations. */
export const startStroke = (strokes: readonly Stroke[], color: string, width: number, p: Point): Stroke[] => [
	...strokes,
	{ color, width, pts: [p] },
];

/** Append a point to the newest stroke (mutates that stroke: called per pointermove). */
export function extendStroke(strokes: readonly Stroke[], p: Point): void {
	strokes[strokes.length - 1]?.pts.push(p);
}

export const undoStroke = (strokes: readonly Stroke[]): Stroke[] => strokes.slice(0, -1);

/** Device-pixel ratio capped at 2 (bigger canvases blow up PNG size on phones). */
export const cappedDpr = (dpr: number): number => Math.min(dpr > 0 ? dpr : 1, 2);
