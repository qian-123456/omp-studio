export type Point = readonly [number, number];
export type SketchTool = "pen" | "eraser";

export interface SketchSize {
	width: number;
	height: number;
}

export interface Stroke {
	color: string;
	width: number;
	pts: Point[];
	/** Older strokes without a tool are ordinary ink. */
	tool?: SketchTool;
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
export const startStroke = (
	strokes: readonly Stroke[],
	color: string,
	width: number,
	p: Point,
	tool: SketchTool = "pen",
): Stroke[] => [...strokes, { color, width, pts: [p], tool }];

/** Append a point to the newest stroke (mutates that stroke: called per pointermove). */
export function extendStroke(strokes: readonly Stroke[], p: Point): void {
	strokes[strokes.length - 1]?.pts.push(p);
}

export const undoStroke = (strokes: readonly Stroke[]): Stroke[] => strokes.slice(0, -1);

/** Device-pixel ratio capped at 2 (bigger canvases blow up PNG size on phones). */
export const cappedDpr = (dpr: number): number => Math.min(dpr > 0 ? dpr : 1, 2);

/** Keep the original paper coordinates and fit them uniformly into the current stage. */
export function resizeSketchCanvas(canvas: HTMLCanvasElement, stage: SketchSize, model: SketchSize, dpr: number): void {
	const scale = Math.min(stage.width / model.width, stage.height / model.height);
	const width = model.width * scale;
	const height = model.height * scale;
	const pixelWidth = Math.max(1, Math.round(width * dpr));
	const pixelHeight = Math.max(1, Math.round(height * dpr));
	if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
	if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	canvas.style.left = `${(stage.width - width) / 2}px`;
	canvas.style.top = `${(stage.height - height) / 2}px`;
}

/** Pointer coordinates are in logical paper units, never backing pixels. */
export function sketchPoint(canvas: HTMLCanvasElement, model: SketchSize, clientX: number, clientY: number): Point {
	const rect = canvas.getBoundingClientRect();
	return [
		Math.max(0, Math.min(model.width, ((clientX - rect.left) / rect.width) * model.width)),
		Math.max(0, Math.min(model.height, ((clientY - rect.top) / rect.height) * model.height)),
	];
}

function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
	const first = stroke.pts[0];
	if (!first) return;
	ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
	ctx.strokeStyle = stroke.tool === "eraser" ? "#000000" : stroke.color;
	ctx.fillStyle = ctx.strokeStyle;
	ctx.lineWidth = stroke.width;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.beginPath();
	if (stroke.pts.length === 1) {
		ctx.arc(first[0], first[1], stroke.width / 2, 0, Math.PI * 2);
		ctx.fill();
		return;
	}
	ctx.moveTo(first[0], first[1]);
	for (let i = 1; i < stroke.pts.length; i++) ctx.lineTo(stroke.pts[i][0], stroke.pts[i][1]);
	ctx.stroke();
}

/** Replay ink and erasers before adding paper, so erasing never paints a theme colour. */
export function replaySketch(canvas: HTMLCanvasElement, strokes: readonly Stroke[], model: SketchSize, paper: string): void {
	const ctx = canvas.getContext("2d");
	if (!ctx) return;
	ctx.save();
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.clearRect(0, 0, canvas.width, canvas.height);
	ctx.scale(canvas.width / model.width, canvas.height / model.height);
	for (const stroke of strokes) drawStroke(ctx, stroke);
	ctx.setTransform(1, 0, 0, 1, 0, 0);
	ctx.globalCompositeOperation = "destination-over";
	ctx.fillStyle = paper;
	ctx.fillRect(0, 0, canvas.width, canvas.height);
	ctx.restore();
}
