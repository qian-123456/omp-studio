/**
 * Vector sketch model + editor store for the SketchPad, a faithful port of the
 * ChatGPT sketch editor core (see .cache/sketch-task/SPEC.md and the reference
 * bundle asar/sketch-c03aa3f9daba.js). No React, no paper.js: geometry is
 * implemented directly so the whole editor is unit-testable in vitest.
 *
 * Layers:
 *   - data model + geometry helpers (bounds, hit tests, transforms)
 *   - pressure simulation + stroke smoothing
 *   - vector erasure (segment cutting -> `ink` residuals)
 *   - text layout estimator (DOM-free, grapheme-aware)
 *   - the editor store (tools, gestures, history, selection, snapping)
 *   - canvas rendering + PNG export
 *
 * Comment objects and DOM-backed glyph measurement from the original are
 * intentionally omitted (see SPEC "非目标"/simplifications).
 */

// ---------------------------------------------------------------------------
// Contract types (frozen — do not change; see SPEC.md "Contract")
// ---------------------------------------------------------------------------

export type SketchTool = "select" | "pen" | "text" | "shapes" | "eraser";
export type ShapeKind =
	| "line"
	| "arrow"
	| "rectangle"
	| "ellipse"
	| "triangle"
	| "diamond"
	| "star"
	| "heart";

export interface SketchPoint {
	x: number;
	y: number;
	pressure?: number;
	breakBefore?: boolean;
}

export interface StrokeStyle {
	color: string;
	width: number;
}

export interface TextFormat {
	bold: boolean;
	italic: boolean;
	underline: boolean;
}

export interface Bounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

export type SketchItem =
	| {
			kind: "stroke";
			id: string;
			points: SketchPoint[];
			style: StrokeStyle;
			// Normalized per-axis basis captured when a resize collapses a
			// dimension to zero; lets re-expansion recover original ratios. (`rt`)
			resizeBasis?: { x?: number[]; y?: number[] };
	  }
	| {
			// Residual produced by the vector eraser. Shares the stroke shape.
			kind: "ink";
			id: string;
			points: SketchPoint[];
			style: StrokeStyle;
	  }
	| {
			kind: "line";
			id: string;
			from: SketchPoint;
			to: SketchPoint;
			style: StrokeStyle;
	  }
	| {
			kind: "arrow";
			id: string;
			from: SketchPoint;
			to: SketchPoint;
			style: StrokeStyle;
	  }
	| {
			kind:
				| "rectangle"
				| "ellipse"
				| "triangle"
				| "diamond"
				| "star"
				| "heart";
			id: string;
			bounds: Bounds;
			style: StrokeStyle;
			flipX?: boolean;
			flipY?: boolean;
	  }
	| {
			kind: "text";
			id: string;
			text: string;
			bounds: Bounds;
			// style.width is the font size for text objects.
			style: StrokeStyle;
			format: TextFormat;
	  };

export interface SketchDoc {
	schemaVersion: 1;
	objects: SketchItem[];
}

/** Transient live-eraser object exposed through PreviewInfo.object. */
export interface SketchEraserPreview {
	kind: "eraser";
	id: string;
	points: SketchPoint[];
	width: number;
}

export interface PreviewInfo {
	object: SketchItem | SketchEraserPreview;
	replaceObjectId: string | null;
	transformKind: "move" | "resize" | undefined;
}

export interface SnapGuide {
	kind: "alignment";
	axis: "x" | "y";
	coordinate: number;
	start: number;
	end: number;
}

export interface PointerSample {
	pointerId: number;
	point: { x: number; y: number };
	viewportScale: number;
	tolerance: number;
	handleTolerance: number;
	snapTolerance: number;
	shiftKey: boolean;
	altKey: boolean;
	pressure: number | null;
	pointerType: string;
	timestamp: number | null;
	surfaceBounds: Bounds;
}

/** Pending text-edit input; `objectId: null` creates a new text object. */
export interface SketchTextEditInput {
	text: string;
	objectId?: string | null;
	/** Bounds in document space. When omitted, computed from `point`. */
	bounds?: Bounds;
	/** Tap position used to place a new text box when `bounds` is omitted. */
	point?: { x: number; y: number };
	style?: Partial<StrokeStyle>;
	format?: Partial<TextFormat>;
}

/** Normalized pending-edit input (bounds always present). */
export interface SketchTextEdit extends SketchTextEditInput {
	objectId: string | null;
	bounds: Bounds;
}

export interface SketchSnapshot {
	document: SketchDoc;
	/** Document with the pending text edit applied (for rendering). */
	effectiveDocument: SketchDoc;
	activeTool: SketchTool;
	/** Currently armed shape for the "shapes" tool. */
	shapeKind: ShapeKind;
	style: StrokeStyle;
	drawingWidthPx: number | null;
	eraserSizePx: number;
	textSizePx: number | null;
	textFormat: TextFormat;
	selectionId: string | null;
	canUndo: boolean;
	canRedo: boolean;
	hasActiveGesture: boolean;
	hasPendingTextEdit: boolean;
	preview: PreviewInfo | null;
	/** Live "document after current eraser drag", or null. */
	erasurePreview: SketchDoc | null;
	snapGuides: SnapGuide[];
	cursor: string;
}

export type SketchExportResult =
	| { kind: "success"; dataUrl: string; width: number; height: number }
	| { kind: "empty" }
	| { kind: "busy" }
	| { kind: "unavailable" };

export interface SketchEditor {
	getSnapshot(): SketchSnapshot;
	subscribe(fn: () => void): () => void;
	setTool(tool: SketchTool | ShapeKind): void;
	setShapeKind(kind: ShapeKind): void;
	setEraserSize(px: number): void;
	setDrawingWidth(px: number): void;
	setTextSize(px: number): void;
	setStyle(
		partial: Partial<StrokeStyle>,
		opts?: { historyGroup?: string },
	): void;
	setTextFormat(
		partial: Partial<TextFormat>,
		opts?: { historyGroup?: string },
	): void;
	undo(): boolean;
	redo(): boolean;
	clear(): boolean;
	selectObject(id: string): boolean;
	clearSelection(): void;
	deleteSelection(): boolean;
	deleteObject(id: string): boolean;
	nudgeSelection(
		delta: { x: number; y: number },
		opts?: { historyGroup?: string },
	): boolean;
	pointerDown(sample: PointerSample): boolean;
	pointerMove(sample: PointerSample): boolean;
	pointerMoves(samples: PointerSample[]): boolean;
	pointerUp(sample: PointerSample): boolean;
	pointerCommit(pointerId?: number): boolean;
	pointerCancel(
		pointerId?: number,
		opts?: { preserveReleasedErasure?: boolean },
	): boolean;
	pointerLeave(): void;
	getObjectAtPoint(
		point: { x: number; y: number },
		tolerance?: number,
	): SketchItem | null;
	pasteObject(
		item: SketchItem,
		opts?: { offset?: { x: number; y: number } },
	): string | null;
	setSurfaceBounds(bounds: Bounds | null): void;
	setPendingTextEdit(input: SketchTextEditInput | null): void;
	commitPendingTextEdit(): boolean;
	discardPendingTextEdit(): boolean;
	insertTextBox(input: {
		text: string;
		bounds: Bounds;
		style?: Partial<StrokeStyle>;
		format?: Partial<TextFormat>;
	}): string | null;
	updateTextBox(
		id: string,
		patch: { text?: string; bounds?: Bounds },
		opts?: { historyGroup?: string },
	): boolean;
	export(opts?: {
		backgroundColor?: string;
		padding?: number;
		scale?: number;
		mimeType?: string;
	}): Promise<SketchExportResult>;
	replaceDocument(doc: SketchDoc): void;
}

// ---------------------------------------------------------------------------
// Constants (all values from the reference implementation)
// ---------------------------------------------------------------------------

const DEFAULT_STYLE: StrokeStyle = { color: "#111827", width: 12 };
const DEFAULT_FORMAT: TextFormat = { bold: false, italic: false, underline: false };

// Clamps.
const ERASER_MIN = 4;
const ERASER_MAX = 96;
const ERASER_DEFAULT = 32;
const DRAWING_WIDTH_MIN = 1;
const DRAWING_WIDTH_MAX = 32;
const STYLE_WIDTH_MIN = 2;
const STYLE_WIDTH_MAX = 48;
const TEXT_SIZE_MIN = 8;
const TEXT_SIZE_MAX = 128;
const TEXT_SIZE_DEFAULT = 24;

// Interaction.
const HIT_TOLERANCE = 10;
const HANDLE_TOLERANCE_MOUSE = 7;
const HANDLE_TOLERANCE_TOUCH = 14;
const SIDE_HANDLE_MIN_SPACING = 20;
const CORNER_HANDLE_MIN_SPACING = 28;
const SNAP_TOLERANCE = 6;
const PASTE_OFFSET = 12;
const SHAPE_MIN_SIZE = 2;
const TEXT_INITIAL_WIDTH = 240;
const TEXT_PADDING = 8;
const TEXT_LINE_HEIGHT_RATIO = 1.25;
const TEXT_RENDER_SIZE = 24; // text is rasterized at 24px and scaled
export const TEXT_FONT_FAMILY =
	'ui-sans-serif, -apple-system, "Segoe UI", sans-serif';

// Stroke smoothing.
const SMOOTH_CORNER = 0.025;
const SMOOTH_PRESSURE = 0.01;
const SMOOTH_MAX_SUBDIVISIONS = 512;
const MIN_SAMPLE_DISTANCE = 0.5; // divided by viewportScale
const PRESSURE_MIN_FACTOR = 0.42; // width *= lerp(0.42,1,sin(p*pi/2))

// Pressure simulation.
const PRESSURE_MIN = 0.08;
const PRESSURE_DEFAULT = 0.58;
const SPEED_PRESSURE_FLOOR = 0.35;
const SPEED_OFFSET = 0.06; // px/ms dead zone
const SPEED_RANGE = 1.54; // px/ms normalization
const DT_DEFAULT = 16;
const DT_MIN = 4;
const DT_MAX = 50;
const TAU_ACCEL = 24; // velocity low-pass, accelerating
const TAU_DECEL = 48; // velocity low-pass, decelerating
const TAU_PRESSURE_DOWN = 22;
const TAU_PRESSURE_UP = 72;
const TAU_PRESSURE_STYLUS = 18;
const SPEED_NORM = 40; // px normalization scale (o/40 per dt)
const WIDTH_SPEED_FACTOR = 4;
const MAX_PRESSURE_DROP = 0.275;

// Arrowhead.
const ARROW_HEAD_MIN = 12;
const ARROW_HEAD_WIDTH_FACTOR = 3;
const ARROW_HEAD_MAX_RATIO = 0.6;
const ARROW_HEAD_HALF_ANGLE = Math.PI / 6;

// Ellipse polygonization.
const ELLIPSE_MIN_SEGMENTS = 32;
const ELLIPSE_MAX_SEGMENTS = 2048;
const ELLIPSE_RESOLUTION = 0.025;

// Eraser.
const ERASURE_FRAGMENT_MIN_AREA = 4; // px^2
const ERASURE_FRAGMENT_MIN_SIZE = 4; // px (screen)
const ERASURE_BATCH = 8;

// Export caps.
const EXPORT_MAX_DIMENSION = 2048;
const EXPORT_MAX_PIXELS = 4_000_000;
const EXPORT_DEFAULT_PADDING = 24;

// ---------------------------------------------------------------------------
// Scalar / geometry helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) =>
	Math.min(Math.max(v, lo), hi);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const nonNegative = (v: number) => (Number.isFinite(v) ? Math.max(v, 0) : 0);
const isFiniteNumber = (v: unknown): v is number =>
	typeof v === "number" && Number.isFinite(v);

/** Normalize possibly-negative width/height. (`U`) */
function normalizeBounds(b: Bounds): Bounds {
	return {
		x: Math.min(b.x, b.x + b.width),
		y: Math.min(b.y, b.y + b.height),
		width: Math.abs(b.width),
		height: Math.abs(b.height),
	};
}

/** Bounds spanning two points. (`W`) */
function boundsFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): Bounds {
	return normalizeBounds({
		x: a.x,
		y: a.y,
		width: b.x - a.x,
		height: b.y - a.y,
	});
}

/** Bounds of points inflated by pad on every side. (`q`) */
function pointsBounds(
	points: readonly { x: number; y: number }[],
	pad = 0,
): Bounds | null {
	if (points.length === 0) return null;
	const first = points[0];
	if (first == null) return null;
	let minX = first.x;
	let maxX = first.x;
	let minY = first.y;
	let maxY = first.y;
	for (const p of points) {
		minX = Math.min(minX, p.x);
		maxX = Math.max(maxX, p.x);
		minY = Math.min(minY, p.y);
		maxY = Math.max(maxY, p.y);
	}
	const s = nonNegative(pad);
	return {
		x: minX - s,
		y: minY - s,
		width: Math.max(maxX - minX + s * 2, s * 2),
		height: Math.max(maxY - minY + s * 2, s * 2),
	};
}

/** Inflate bounds by pad. (`J`) */
function inflateBounds(b: Bounds, pad: number): Bounds {
	const n = normalizeBounds(b);
	const r = nonNegative(pad);
	return {
		x: n.x - r,
		y: n.y - r,
		width: n.width + r * 2,
		height: n.height + r * 2,
	};
}

/** Union of two bounds. (`ne`) */
function boundsUnion(a: Bounds, b: Bounds): Bounds {
	const n = normalizeBounds(a);
	const r = normalizeBounds(b);
	const x = Math.min(n.x, r.x);
	const y = Math.min(n.y, r.y);
	const w = Math.max(n.x + n.width, r.x + r.width);
	const h = Math.max(n.y + n.height, r.y + r.height);
	return { x, y, width: w - x, height: h - y };
}

/** Intersection of two bounds, or null. (`re`) */
function boundsIntersect(a: Bounds, b: Bounds): Bounds | null {
	const n = normalizeBounds(a);
	const r = normalizeBounds(b);
	const x = Math.max(n.x, r.x);
	const y = Math.max(n.y, r.y);
	const w = Math.min(n.x + n.width, r.x + r.width);
	const h = Math.min(n.y + n.height, r.y + r.height);
	return w <= x || h <= y ? null : { x, y, width: w - x, height: h - y };
}

/** Point inside bounds. (`ae`) */
function pointInBounds(b: Bounds, p: { x: number; y: number }): boolean {
	const n = normalizeBounds(b);
	return (
		p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height
	);
}

/** `inner` fully inside `outer`. (`oe`) */
function boundsContain(outer: Bounds, inner: Bounds): boolean {
	const n = normalizeBounds(outer);
	const r = normalizeBounds(inner);
	return (
		r.x >= n.x &&
		r.y >= n.y &&
		r.x + r.width <= n.x + n.width &&
		r.y + r.height <= n.y + n.height
	);
}

/** Bounds equality after normalization. (`ie`) */
function boundsEqual(a: Bounds | null, b: Bounds | null): boolean {
	if (a == null || b == null) return a === b;
	const n = normalizeBounds(a);
	const r = normalizeBounds(b);
	return (
		n.x === r.x && n.y === r.y && n.width === r.width && n.height === r.height
	);
}

/** Clamp a point into bounds (null bounds = no clamp). (`Y`) */
function clampPointToBounds<T extends { x: number; y: number }>(
	p: T,
	b: Bounds | null,
): T {
	if (b == null) return p;
	const n = normalizeBounds(b);
	return {
		...p,
		x: clamp(p.x, n.x, n.x + n.width),
		y: clamp(p.y, n.y, n.y + n.height),
	};
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
	Math.hypot(a.x - b.x, a.y - b.y);

/** Distance from p to segment ab. (`se`) */
function distToSegment(
	p: { x: number; y: number },
	a: { x: number; y: number },
	b: { x: number; y: number },
): number {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	if (dx === 0 && dy === 0) return dist(p, a);
	const t = clamp(
		((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy),
		0,
		1,
	);
	return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

const translatePoint = <T extends { x: number; y: number }>(
	p: T,
	d: { x: number; y: number },
): T => ({ ...p, x: p.x + d.x, y: p.y + d.y });

/** Split points into runs at `breakBefore` boundaries. (`Z`) */
function splitPointRuns(points: readonly SketchPoint[]): SketchPoint[][] {
	const runs: SketchPoint[][] = [];
	for (const p of points) {
		const last = runs[runs.length - 1];
		if (last == null || p.breakBefore === true) {
			runs.push([p]);
			continue;
		}
		last.push(p);
	}
	return runs;
}

// ---------------------------------------------------------------------------
// Shape templates and outline geometry
// ---------------------------------------------------------------------------

/** Star template: 10 points on the unit box, radii 1 / 0.45. (`De`) */
function starTemplate(): { x: number; y: number }[] {
	const pts: { x: number; y: number }[] = [];
	for (let i = 0; i < 10; i += 1) {
		const a = -Math.PI / 2 + (i * Math.PI) / 5;
		const r = i % 2 === 0 ? 1 : 0.45;
		pts.push({ x: 0.5 + Math.cos(a) * 0.5 * r, y: 0.5 + Math.sin(a) * 0.5 * r });
	}
	return pts;
}
const STAR_POINTS = starTemplate();

type HeartStep =
	| { kind: "line"; end: { x: number; y: number } }
	| {
			kind: "curve";
			control1: { x: number; y: number };
			control2: { x: number; y: number };
			end: { x: number; y: number };
	  };

function cubicAt(
	p0: { x: number; y: number },
	c1: { x: number; y: number },
	c2: { x: number; y: number },
	p1: { x: number; y: number },
	t: number,
): { x: number; y: number } {
	const u = 1 - t;
	const a = u ** 3;
	const b = 3 * u ** 2 * t;
	const c = 3 * u * t ** 2;
	const d = t ** 3;
	return {
		x: p0.x * a + c1.x * b + c2.x * c + p1.x * d,
		y: p0.y * a + c1.y * b + c2.y * c + p1.y * d,
	};
}

/**
 * Heart template (`Oe`): 24x24 bezier silhouette sampled to a polygon and
 * normalized to its own bounding box.
 */
function heartTemplate(): { x: number; y: number }[] {
	const tip = { x: 12, y: 20.25 };
	const steps: HeartStep[] = [
		{ kind: "line", end: { x: 4.73, y: 13.5 } },
		{
			kind: "curve",
			control1: { x: 1.5, y: 10.5 },
			control2: { x: 3.65, y: 5.25 },
			end: { x: 7.5, y: 5.25 },
		},
		{
			kind: "curve",
			control1: { x: 9.55, y: 5.25 },
			control2: { x: 11.04, y: 6.32 },
			end: { x: 12, y: 7.75 },
		},
		{
			kind: "curve",
			control1: { x: 12.96, y: 6.32 },
			control2: { x: 14.45, y: 5.25 },
			end: { x: 16.5, y: 5.25 },
		},
		{
			kind: "curve",
			control1: { x: 20.35, y: 5.25 },
			control2: { x: 22.5, y: 10.5 },
			end: { x: 19.27, y: 13.5 },
		},
		{ kind: "line", end: tip },
	];
	const pts: { x: number; y: number }[] = [tip];
	let prev = tip;
	for (const step of steps) {
		if (step.kind === "line") {
			pts.push(step.end);
		} else {
			for (let i = 1; i <= 16; i += 1) {
				pts.push(cubicAt(prev, step.control1, step.control2, step.end, i / 16));
			}
		}
		prev = step.end;
	}
	const b = pointsBounds(pts);
	if (b == null || b.width === 0 || b.height === 0) return [];
	return pts.map((p) => ({
		x: (p.x - b.x) / b.width,
		y: (p.y - b.y) / b.height,
	}));
}
const HEART_POINTS = heartTemplate();

const scaleToBounds = (
	p: { x: number; y: number },
	b: Bounds,
): { x: number; y: number } => ({ x: b.x + p.x * b.width, y: b.y + p.y * b.height });

/**
 * Base polygon points for a shape's `bounds` (template-based shapes only).
 * (`K`)
 */
function shapeTemplatePoints(kind: ShapeKind, b: Bounds): { x: number; y: number }[] {
	const n = { x: b.x, y: b.y };
	const l = b.x;
	const t = b.y;
	const r = b.x + b.width;
	const bo = b.y + b.height;
	const cx = l + b.width / 2;
	const cy = t + b.height / 2;
	switch (kind) {
		case "triangle":
			return [
				{ x: cx, y: t },
				{ x: r, y: bo },
				{ x: l, y: bo },
			];
		case "diamond":
			return [
				{ x: cx, y: t },
				{ x: r, y: cy },
				{ x: cx, y: bo },
				{ x: l, y: cy },
			];
		case "star":
			return STAR_POINTS.map((p) => scaleToBounds(p, b));
		case "heart":
			return HEART_POINTS.map((p) => scaleToBounds(p, b));
		default:
			return [n];
	}
}

/**
 * Shape outline polygon in document space, honoring flips. (`G`)
 * Works for rectangle/ellipse (rectangle corners/ellipse sampled) too when
 * needed by callers via `shapeOutline`.
 */
function shapePoints(
	kind: ShapeKind,
	bounds: Bounds,
	opts?: { flipX?: boolean; flipY?: boolean },
): { x: number; y: number }[] {
	const b = normalizeBounds(bounds);
	const pts = shapeTemplatePoints(kind, b);
	const { flipX, flipY } = opts ?? {};
	if (!flipX && !flipY) return pts;
	return pts.map((p) => ({
		x: flipX ? b.x * 2 + b.width - p.x : p.x,
		y: flipY ? b.y * 2 + b.height - p.y : p.y,
	}));
}

/**
 * Outline polyline used by hit-testing/erasure. Rectangle → 4 corners,
 * ellipse → adaptive polygon, template shapes → template points. Closed
 * outlines return `closed: true` via the `closed` flag on the array wrapper.
 */
export function shapeOutlinePoints(item: SketchItem): {
	points: { x: number; y: number }[];
	closed: boolean;
} {
	switch (item.kind) {
		case "rectangle": {
			const b = normalizeBounds(item.bounds);
			return {
				points: [
					{ x: b.x, y: b.y },
					{ x: b.x + b.width, y: b.y },
					{ x: b.x + b.width, y: b.y + b.height },
					{ x: b.x, y: b.y + b.height },
				],
				closed: true,
			};
		}
		case "ellipse": {
			const b = normalizeBounds(item.bounds);
			const rx = b.width / 2;
			const ry = b.height / 2;
			const n = Math.max(
				ELLIPSE_MIN_SEGMENTS,
				Math.min(
					ELLIPSE_MAX_SEGMENTS,
					Math.ceil(Math.PI * Math.sqrt(Math.max(rx, ry) / ELLIPSE_RESOLUTION)),
				),
			);
			const pts: { x: number; y: number }[] = [];
			for (let i = 0; i < n; i += 1) {
				const a = (i * 2 * Math.PI) / n;
				pts.push({
					x: b.x + rx + Math.cos(a) * rx,
					y: b.y + ry + Math.sin(a) * ry,
				});
			}
			return { points: pts, closed: true };
		}
		case "triangle":
		case "diamond":
		case "star":
		case "heart":
			return {
				points: shapePoints(item.kind, item.bounds, item),
				closed: true,
			};
		default:
			return { points: [], closed: false };
	}
}

/** Arrowhead wing endpoints. (`ce`) */
function arrowHead(arrow: {
	from: { x: number; y: number };
	to: { x: number; y: number };
	style: StrokeStyle;
}): { left: { x: number; y: number }; right: { x: number; y: number } } {
	const angle = Math.atan2(
		arrow.to.y - arrow.from.y,
		arrow.to.x - arrow.from.x,
	);
	const len = dist(arrow.from, arrow.to);
	const headLen = Math.min(
		Math.max(Math.max(arrow.style.width, 0) * ARROW_HEAD_WIDTH_FACTOR, ARROW_HEAD_MIN),
		len * ARROW_HEAD_MAX_RATIO,
	);
	return {
		left: {
			x: arrow.to.x - Math.cos(angle - ARROW_HEAD_HALF_ANGLE) * headLen,
			y: arrow.to.y - Math.sin(angle - ARROW_HEAD_HALF_ANGLE) * headLen,
		},
		right: {
			x: arrow.to.x - Math.cos(angle + ARROW_HEAD_HALF_ANGLE) * headLen,
			y: arrow.to.y - Math.sin(angle + ARROW_HEAD_HALF_ANGLE) * headLen,
		},
	};
}

/** Midpoint of the arrowhead base — where the shaft ends. (`Q`) */
function arrowShaftEnd(arrow: {
	from: { x: number; y: number };
	to: { x: number; y: number };
	style: StrokeStyle;
}): { x: number; y: number } {
	const { left, right } = arrowHead(arrow);
	return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

/** Point strictly inside triangle abc? (`Ne`) */
function pointInTriangle(
	p: { x: number; y: number },
	a: { x: number; y: number },
	b: { x: number; y: number },
	c: { x: number; y: number },
): boolean {
	if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) === 0) return false;
	const s = crossSign(p, a, b);
	const t = crossSign(p, b, c);
	const u = crossSign(p, c, a);
	return !((s < 0 || t < 0 || u < 0) && (s > 0 || t > 0 || u > 0));
}
function crossSign(
	p: { x: number; y: number },
	a: { x: number; y: number },
	b: { x: number; y: number },
): number {
	return (p.x - b.x) * (a.y - b.y) - (a.x - b.x) * (p.y - b.y);
}

/** Distance from p to ellipse (center cx,cy, radii rx,ry). (`je`/`Me`) */
function distToEllipse(
	p: { x: number; y: number },
	cx: number,
	cy: number,
	rx: number,
	ry: number,
): number {
	const ax = Math.abs(p.x - cx);
	const ay = Math.abs(p.y - cy);
	let lo = 0;
	let hi = Math.PI / 2;
	for (let i = 0; i < 32; i += 1) {
		const third = (hi - lo) / 3;
		const t1 = lo + third;
		const t2 = hi - third;
		if (ellipseDistSq(ax, ay, rx, ry, t1) <= ellipseDistSq(ax, ay, rx, ry, t2))
			hi = t2;
		else lo = t1;
	}
	return Math.sqrt(ellipseDistSq(ax, ay, rx, ry, (lo + hi) / 2));
}
function ellipseDistSq(
	x: number,
	y: number,
	rx: number,
	ry: number,
	t: number,
): number {
	const ex = rx * Math.cos(t);
	const ey = ry * Math.sin(t);
	const dx = ex - x;
	const dy = ey - y;
	return dx * dx + dy * dy;
}

// ---------------------------------------------------------------------------
// Stroke smoothing (`h`/`g`/`_`/`v`/`y`) — midpoint quadratic subdivision
// ---------------------------------------------------------------------------

/** Pressure-scaled stroke width at one point. (`te`) */
function pressureWidth(p: SketchPoint, width: number): number {
	if (p.pressure == null) return width;
	const n = clamp(p.pressure, 0, 1);
	return width * lerp(PRESSURE_MIN_FACTOR, 1, Math.sin((n * Math.PI) / 2));
}

/** Smoothed polyline for a stroke/ink point list. (`h`) */
export function smoothStrokePoints(
	points: readonly SketchPoint[],
	width: number,
): SketchPoint[] {
	const out: SketchPoint[] = [];
	for (let i = 0; i < points.length; i += 1) {
		out.push(...subdividePoint(points, i, width));
	}
	return out;
}

/** Relaxed sample: pulls a point toward the curve through its neighbours. (`_`) */
function relaxedPoint(
	points: readonly SketchPoint[],
	i: number,
	width: number,
): SketchPoint | null {
	const p = points[i];
	const prev = points[i - 1];
	const next = points[i + 1];
	if (
		p == null ||
		p.breakBefore === true ||
		prev == null ||
		next == null ||
		next.breakBefore === true
	)
		return p ?? null;
	const dx = (prev.x - 2 * p.x + next.x) / 4;
	const dy = (prev.y - 2 * p.y + next.y) / 4;
	const len = Math.hypot(dx, dy);
	const k = len > width / 2 ? width / 2 / len : 1;
	return { ...p, x: p.x + dx * k, y: p.y + dy * k };
}

const midpoint = (a: SketchPoint, b: SketchPoint): SketchPoint => ({
	x: (a.x + b.x) / 2,
	y: (a.y + b.y) / 2,
	...(a.pressure != null || b.pressure != null
		? { pressure: ((a.pressure ?? 1) + (b.pressure ?? 1)) / 2 }
		: {}),
});

/** Quadratic subdivision of the curve through point i. (`g`) */
function subdividePoint(
	points: readonly SketchPoint[],
	i: number,
	width: number,
): SketchPoint[] {
	const p = relaxedPoint(points, i, width);
	if (p == null) return [];
	const prev = p.breakBefore === true ? undefined : relaxedPoint(points, i - 1, width);
	const nextRaw = relaxedPoint(points, i + 1, width);
	const next = nextRaw?.breakBefore === true ? undefined : nextRaw;
	if (prev == null && next == null) return [p];
	const s = prev == null ? p : midpoint(prev, p);
	const c = next == null ? p : midpoint(p, next);
	const hasPressure =
		s.pressure != null || p.pressure != null || c.pressure != null;
	const pu = s.pressure ?? 1;
	const pd = p.pressure ?? 1;
	const pf = c.pressure ?? 1;
	const curveDist = Math.hypot(s.x - 2 * p.x + c.x, s.y - 2 * p.y + c.y);
	const pressureDist = Math.abs(pu - 2 * pd + pf);
	const subdivisions = collinear(s, p, c)
		? 1
		: Math.min(
				SMOOTH_MAX_SUBDIVISIONS,
				Math.max(
					1,
					Math.ceil(
						Math.sqrt(
							Math.max(
								curveDist / (4 * SMOOTH_CORNER),
								pressureDist / (4 * SMOOTH_PRESSURE),
							),
						),
					),
				),
			);
	const out: SketchPoint[] = prev == null ? [p] : [];
	for (let k = 1; k < subdivisions; k += 1) {
		const t = k / subdivisions;
		const a = (1 - t) ** 2;
		const b = 2 * (1 - t) * t;
		const cc = t ** 2;
		out.push({
			x: a * s.x + b * p.x + cc * c.x,
			y: a * s.y + b * p.y + cc * c.y,
			...(hasPressure ? { pressure: a * pu + b * pd + cc * pf } : {}),
		});
	}
	out.push(c);
	return out;
}

/** True when b lies on segment ac within fp tolerance (pressure included). (`y`) */
function collinear(a: SketchPoint, b: SketchPoint, c: SketchPoint): boolean {
	const dx = c.x - a.x;
	const dy = c.y - a.y;
	const dp = (c.pressure ?? 1) - (a.pressure ?? 1);
	const bx = b.x - a.x;
	const by = b.y - a.y;
	const bp = (b.pressure ?? 1) - (a.pressure ?? 1);
	const scale = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dp));
	if (scale === 0) return bx === 0 && by === 0 && bp === 0;
	const t =
		scale === Math.abs(dx) ? bx / dx : scale === Math.abs(dy) ? by / dy : bp / dp;
	const eps = 2 ** -52 * 16;
	return (
		t >= 0 &&
		t <= 1 &&
		Math.abs(bx - t * dx) <= eps * Math.max(1, Math.abs(dx)) &&
		Math.abs(by - t * dy) <= eps * Math.max(1, Math.abs(dy)) &&
		Math.abs(bp - t * dp) <= eps
	);
}

// ---------------------------------------------------------------------------
// Pressure simulation (`Hi`/`Ui`/`Wi`/`Ji`/`Yi`/`Xi`)
// ---------------------------------------------------------------------------

interface PressureState {
	point: { x: number; y: number };
	timestamp: number | null;
	velocity: number | null;
	pressure: number;
	source: "speed" | "stylus";
}

/** Stylus pressure from a sample; rejects ~0.5 neutral values. (`Ji`) */
function stylusPressure(
	sample: PointerSample,
	keepNeutral: boolean,
): number | null {
	const p = sample.pressure;
	if (
		sample.pointerType !== "pen" ||
		p == null ||
		!Number.isFinite(p) ||
		p <= 0 ||
		(!keepNeutral && Math.abs(p - 0.5) < 0.001)
	)
		return null;
	return clamp(p, PRESSURE_MIN, 1);
}

/** Initial pressure tracker state from pointerdown. (`Hi`) */
function initialPressure(sample: PointerSample): PressureState {
	const stylus = stylusPressure(sample, false);
	return {
		point: sample.point,
		timestamp: isFiniteNumber(sample.timestamp) ? sample.timestamp : null,
		velocity: null,
		pressure: stylus ?? PRESSURE_DEFAULT,
		source: stylus == null ? "speed" : "stylus",
	};
}

const lowpass = (dt: number, tau: number) => 1 - Math.exp(-dt / tau); // `Xi`

/** Speed-simulated pressure for a given velocity and screen width. (`Yi`) */
function speedPressure(velocity: number, width: number): number {
	const n = clamp((velocity - SPEED_OFFSET) / SPEED_RANGE, 0, 1);
	const floor = lerp(PRESSURE_MIN, SPEED_PRESSURE_FLOOR, clamp((width - 8) / 24, 0, 1));
	return clamp(1 - Math.sqrt(n), floor, 1);
}

/** Advance the pressure tracker for a new sample. (`Ui`) */
function nextPressure(
	state: PressureState,
	sample: PointerSample,
	screenWidth: number,
): PressureState {
	const point = sample.point;
	const timestamp = isFiniteNumber(sample.timestamp) ? sample.timestamp : null;
	if (
		timestamp != null &&
		state.timestamp === timestamp &&
		point.x === state.point.x &&
		point.y === state.point.y
	)
		return state;
	const dt =
		state.timestamp == null || timestamp == null
			? DT_DEFAULT
			: clamp(timestamp - state.timestamp, DT_MIN, DT_MAX); // `qi`
	const travel = dist(state.point, point);
	const speed = travel / dt;
	const velocity =
		state.velocity == null
			? speed
			: lerp(
					state.velocity,
					speed,
					lowpass(dt, speed > state.velocity ? TAU_ACCEL : TAU_DECEL),
				);
	const stylus = stylusPressure(sample, state.source === "stylus");
	const source =
		state.source === "stylus" || stylus != null ? "stylus" : "speed";
	const target =
		source === "stylus" ? (stylus ?? state.pressure) : speedPressure(velocity, screenWidth);
	const alpha = lowpass(
		dt,
		source === "stylus"
			? TAU_PRESSURE_STYLUS
			: target < state.pressure
				? TAU_PRESSURE_DOWN
				: TAU_PRESSURE_UP,
	);
	const smoothed = clamp(lerp(state.pressure, target, alpha), PRESSURE_MIN, 1);
	const drop = clamp(travel / SPEED_NORM, 0, MAX_PRESSURE_DROP);
	const rise = Math.min(
		drop,
		travel / Math.max(SPEED_NORM, screenWidth * WIDTH_SPEED_FACTOR),
	);
	return {
		point,
		timestamp,
		velocity,
		pressure:
			source === "speed"
				? clamp(smoothed, state.pressure - drop, state.pressure + rise)
				: smoothed,
		source,
	};
}

/** Attach a clamped pressure to a point. (`Wi`) */
function withPressure(p: SketchPoint, pressure: number | null): SketchPoint {
	return pressure == null || pressure === 0 || !Number.isFinite(pressure)
		? p
		: { ...p, pressure: clamp(pressure, PRESSURE_MIN, 1) };
}

// ---------------------------------------------------------------------------
// Object bounds and hit testing (`fe`/`pe`/`he`/`ve`/`be`/`ge`/`xe`/`Se`)
// ---------------------------------------------------------------------------

/** Ink bounds, pressure-aware. (`pe`) */
function strokeInkBounds(item: {
	points: SketchPoint[];
	style: StrokeStyle;
}): Bounds | null {
	const w = item.style.width;
	const pts = smoothStrokePoints(item.points, w);
	if (pts.length === 0) return null;
	let minX = Infinity;
	let minY = Infinity;
	let maxX = -Infinity;
	let maxY = -Infinity;
	for (const p of pts) {
		const r = pressureWidth(p, w) / 2;
		minX = Math.min(minX, p.x - r);
		minY = Math.min(minY, p.y - r);
		maxX = Math.max(maxX, p.x + r);
		maxY = Math.max(maxY, p.y + r);
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Drawing bounds incl. stroke half-width. (`fe`) */
function drawingBounds(item: SketchItem): Bounds | null {
	switch (item.kind) {
		case "stroke":
			return pointsBounds(item.points, item.style.width / 2);
		case "line":
			return pointsBounds([item.from, item.to], item.style.width / 2);
		case "arrow": {
			const head = arrowHead(item);
			const shaft = pointsBounds([item.from, arrowShaftEnd(item)], item.style.width / 2);
			const headB = pointsBounds([item.to, head.left, head.right]);
			return shaft == null ? headB : headB == null ? shaft : boundsUnion(shaft, headB);
		}
		case "rectangle":
		case "ellipse":
		case "triangle":
		case "diamond":
		case "star":
		case "heart":
			return inflateBounds(normalizeBounds(item.bounds), item.style.width / 2);
		case "ink":
			return pointsBounds(item.points, item.style.width / 2);
		case "text":
			return normalizeBounds(item.bounds);
	}
}

/** Selection bounds: stroke-aware, template-aware. (`he`) */
function selectionBounds(item: SketchItem): Bounds | null {
	if (item.kind === "stroke") return strokeInkBounds(item);
	if (
		item.kind === "rectangle" ||
		item.kind === "ellipse" ||
		item.kind === "triangle" ||
		item.kind === "diamond" ||
		item.kind === "star" ||
		item.kind === "heart"
	) {
		const inner =
			item.kind === "rectangle" || item.kind === "ellipse"
				? null
				: pointsBounds(shapePoints(item.kind, item.bounds, item));
		return inflateBounds(inner ?? normalizeBounds(item.bounds), item.style.width / 2);
	}
	return drawingBounds(item);
}

type ResizeHandle =
	| "nw"
	| "n"
	| "ne"
	| "e"
	| "se"
	| "s"
	| "w"
	| "sw"
	| "start"
	| "end";

/** Handle list for an object (line/arrow → endpoints). (`ge`) */
function objectHandles(
	item: SketchItem,
	opts?: {
		minimumSideHandleSpacing?: number;
		minimumCornerHandleSpacing?: number;
	},
): { handle: ResizeHandle; point: { x: number; y: number } }[] {
	if (item.kind === "line" || item.kind === "arrow") {
		return [
			{ handle: "start", point: item.from },
			{ handle: "end", point: item.to },
		];
	}
	const b = selectionBounds(item);
	if (b == null) return [];
	const l = b.x;
	const t = b.y;
	const r = b.x + b.width;
	const bo = b.y + b.height;
	const cx = (l + r) / 2;
	const cy = (t + bo) / 2;
	const corners = [
		{ handle: "nw" as const, point: { x: l, y: t } },
		{ handle: "ne" as const, point: { x: r, y: t } },
		{ handle: "se" as const, point: { x: r, y: bo } },
		{ handle: "sw" as const, point: { x: l, y: bo } },
	];
	const d = Math.max(
		nonNegative(opts?.minimumSideHandleSpacing ?? 0),
		nonNegative(opts?.minimumCornerHandleSpacing ?? 0),
	);
	return (
		[
			corners[0]!,
			{ handle: "n", point: { x: cx, y: t } },
			corners[1]!,
			{ handle: "e", point: { x: r, y: cy } },
			corners[2]!,
			{ handle: "s", point: { x: cx, y: bo } },
			corners[3]!,
			{ handle: "w", point: { x: l, y: cy } },
		] as { handle: ResizeHandle; point: { x: number; y: number } }[]
	).filter(({ handle }) =>
		d === 0
			? true
			: handle === "n" || handle === "s"
				? b.width > d
				: handle === "e" || handle === "w"
					? b.height > d
					: true,
	);
}

/** Polyline hit: distance to any segment <= r (dots as points). (`_e`) */
function polylineHit(
	points: readonly SketchPoint[],
	p: { x: number; y: number },
	r: number,
): boolean {
	const tol = nonNegative(r);
	for (const run of splitPointRuns(points)) {
		const first = run[0];
		if (first == null) continue;
		if (run.length === 1) {
			if (dist(first, p) <= tol) return true;
			continue;
		}
		for (let i = 1; i < run.length; i += 1) {
			const a = run[i - 1];
			const b = run[i];
			if (a != null && b != null && distToSegment(p, a, b) <= tol) return true;
		}
	}
	return false;
}

/** Outline (closed polygon) hit: perimeter or any vertex proximity. (`Ee`) */
function outlineHit(
	points: readonly { x: number; y: number }[],
	p: { x: number; y: number },
	r: number,
): boolean {
	if (polylineHit(points, p, r)) return true;
	const first = points[0];
	const last = points[points.length - 1];
	return first != null && last != null && distToSegment(p, last, first) <= r;
}

/** Rectangle outline hit. (`we`) */
function rectOutlineHit(
	bounds: Bounds,
	p: { x: number; y: number },
	r: number,
): boolean {
	const b = normalizeBounds(bounds);
	if (!pointInBounds(inflateBounds(b, r), p)) return false;
	if (!pointInBounds(b, p)) return true;
	return (
		Math.min(p.x - b.x, b.x + b.width - p.x, p.y - b.y, b.y + b.height - p.y) <=
		r
	);
}

/** Ellipse outline hit. (`Te`) */
function ellipseOutlineHit(
	bounds: Bounds,
	p: { x: number; y: number },
	r: number,
): boolean {
	const b = normalizeBounds(bounds);
	const rx = b.width / 2;
	const ry = b.height / 2;
	return rx === 0 || ry === 0
		? distToSegment(
				p,
				{ x: b.x, y: b.y },
				{ x: b.x + b.width, y: b.y + b.height },
			) <= r
		: distToEllipse(p, b.x + rx, b.y + ry, rx, ry) <= r;
}

/** Arrow hit: shaft segment or head triangle. (`Ce`) */
function arrowHit(
	arrow: {
		from: { x: number; y: number };
		to: { x: number; y: number };
		style: StrokeStyle;
	},
	p: { x: number; y: number },
	r: number,
): boolean {
	if (distToSegment(p, arrow.from, arrowShaftEnd(arrow)) <= arrow.style.width / 2 + r)
		return true;
	const head = arrowHead(arrow);
	return pointInTriangle(p, arrow.to, head.left, head.right);
}

/** Hit test one object. (`ve`) */
export function hitTestItem(
	item: SketchItem,
	p: { x: number; y: number },
	tolerance = 0,
): boolean {
	const r = nonNegative(tolerance);
	const outer = drawingBounds(item);
	if (outer == null || !pointInBounds(inflateBounds(outer, r), p)) return false;
	switch (item.kind) {
		case "ink":
		case "stroke":
			return polylineHit(
				item.kind === "stroke"
					? smoothStrokePoints(item.points, item.style.width)
					: item.points,
				p,
				item.style.width / 2 + r,
			);
		case "line":
			return distToSegment(p, item.from, item.to) <= item.style.width / 2 + r;
		case "arrow":
			return arrowHit(item, p, r);
		case "text":
			return pointInBounds(inflateBounds(item.bounds, r), p);
		case "rectangle":
			return rectOutlineHit(item.bounds, p, item.style.width / 2 + r);
		case "ellipse":
			return ellipseOutlineHit(item.bounds, p, item.style.width / 2 + r);
		case "triangle":
		case "diamond":
		case "star":
		case "heart":
			return outlineHit(
				shapePoints(item.kind, item.bounds, item),
				p,
				item.style.width / 2 + r,
			);
	}
}

/** Topmost object at point: texts first, then other objects. (`be`) */
function hitTestDocument(
	doc: SketchDoc,
	p: { x: number; y: number },
	tolerance = 0,
	filter?: (item: SketchItem) => boolean,
): SketchItem | null {
	for (let i = doc.objects.length - 1; i >= 0; --i) {
		const o = doc.objects[i];
		if (
			o?.kind === "text" &&
			hitTestItem(o, p, tolerance) &&
			(filter?.(o) ?? true)
		)
			return o;
	}
	for (let i = doc.objects.length - 1; i >= 0; --i) {
		const o = doc.objects[i];
		if (o != null && o.kind !== "text" && hitTestItem(o, p, tolerance))
			return o;
	}
	return null;
}

/** Nearest handle of `item` to `point` within tolerance. (`xe`) */
function pickHandle(
	item: SketchItem,
	point: { x: number; y: number },
	tolerance: number,
	opts?: {
		minimumSideHandleSpacing?: number;
		minimumCornerHandleSpacing?: number;
	},
): ResizeHandle | null {
	const tol = nonNegative(tolerance);
	let best: ResizeHandle | null = null;
	let bestDist = tol;
	for (const h of objectHandles(item, opts)) {
		const d = dist(h.point, point);
		if (d <= tol && (best == null || d < bestDist)) {
			best = h.handle;
			bestDist = d;
		}
	}
	return best;
}

/** Point for a handle. (`An`) */
function handlePoint(item: SketchItem, handle: ResizeHandle) {
	return objectHandles(item).find((h) => h.handle === handle)?.point ?? null;
}

/** "Grab" hit: bounds for most kinds, outline for line/arrow. (`Se`) */
function grabHit(
	item: SketchItem,
	point: { x: number; y: number },
	tolerance = 0,
): boolean {
	if (item.kind === "line" || item.kind === "arrow")
		return hitTestItem(item, point, tolerance);
	const b = selectionBounds(item);
	return b != null && pointInBounds(b, point);
}

/** Document content bounds (stroke-aware). (`me`) */
function contentBounds(doc: SketchDoc): Bounds | null {
	let acc: Bounds | null = null;
	for (const item of doc.objects) {
		if (item.kind === "text" && item.text.length === 0) continue;
		const b = drawingBounds(item);
		if (b != null) acc = acc == null ? b : boundsUnion(acc, b);
	}
	return acc;
}

// ---------------------------------------------------------------------------
// Transforms (`rn`/`rt`/`en`/`Qe`/`$e`/`ot`/`at`/`et`/`tt`/`nt`/`it`/`nn`)
// ---------------------------------------------------------------------------

/** Raw geometric bounds used for resize math. (`nt`) */
function rawGeometryBounds(item: SketchItem): Bounds | null {
	switch (item.kind) {
		case "stroke":
			return isDotStroke(item)
				? selectionBounds(item)
				: pointsBounds(item.points);
		case "line":
		case "arrow":
			return pointsBounds([item.from, item.to]);
		case "ink":
			return pointsBounds(item.points);
		case "rectangle":
		case "ellipse":
		case "text":
			return normalizeBounds(item.bounds);
		case "triangle":
		case "diamond":
		case "star":
		case "heart":
			return pointsBounds(shapePoints(item.kind, item.bounds, item));
	}
}

/** True for a stroke whose points all coincide. (`it`) */
function isDotStroke(item: { kind: string; points?: SketchPoint[] }): boolean {
	if (item.kind !== "stroke" || item.points == null) return false;
	const first = item.points[0];
	return (
		first != null &&
		item.points.every((p) => p.x === first.x && p.y === first.y)
	);
}

/** Translate an object. (`rn`) */
function translateItem(
	item: SketchItem,
	delta: { x: number; y: number },
): SketchItem {
	switch (item.kind) {
		case "stroke":
		case "ink":
			return {
				...item,
				points: item.points.map((p) => translatePoint(p, delta)),
			};
		case "line":
		case "arrow":
			return {
				...item,
				from: translatePoint(item.from, delta),
				to: translatePoint(item.to, delta),
			};
		case "rectangle":
		case "ellipse":
		case "triangle":
		case "diamond":
		case "star":
		case "heart":
		case "text":
			return {
				...item,
				bounds: {
					...item.bounds,
					x: item.bounds.x + delta.x,
					y: item.bounds.y + delta.y,
				},
			};
	}
}

/** Remap stroke points between two bounds (per-axis normalization). (`rt`) */
function remapStroke(
	item: Extract<SketchItem, { kind: "stroke" }>,
	from: Bounds,
	to: Bounds,
): SketchItem {
	if (isDotStroke(item)) {
		return {
			...item,
			style: {
				...item.style,
				width: (item.style.width * Math.abs(to.width)) / from.width,
			},
			points: item.points.map((p) => ({
				...p,
				x: to.x + to.width / 2,
				y: to.y + to.height / 2,
			})),
		};
	}
	const hasX = from.width > 0 || item.resizeBasis?.x != null;
	const hasY = from.height > 0 || item.resizeBasis?.y != null;
	const doX = hasX && (to.x !== from.x || to.width !== from.width);
	const doY = hasY && (to.y !== from.y || to.height !== from.height);
	if (!doX && !doY) return item;
	const nx = item.points.map((p, i) =>
		from.width === 0 ? (item.resizeBasis?.x?.[i] ?? 0) : (p.x - from.x) / from.width,
	);
	const ny = item.points.map((p, i) =>
		from.height === 0 ? (item.resizeBasis?.y?.[i] ?? 0) : (p.y - from.y) / from.height,
	);
	const basisX = to.width === 0 && hasX ? nx : undefined;
	const basisY = to.height === 0 && hasY ? ny : undefined;
	return {
		...item,
		resizeBasis:
			basisX == null && basisY == null ? undefined : { x: basisX, y: basisY },
		points: item.points.map((p, i) => ({
			...p,
			x: doX ? to.x + to.width * (nx[i] ?? 0) : p.x,
			y: doY ? to.y + to.height * (ny[i] ?? 0) : p.y,
		})),
	};
}

/**
 * Bounds for a shape such that its template polygon fits `target`.
 * (`et`) — inverse of `shapePoints` scaling.
 */
function shapeBoundsFromTarget(
	itemLike: {
		kind: ShapeKind;
		flipX?: boolean;
		flipY?: boolean;
	},
	target: Bounds,
): Bounds {
	const unit: Bounds = { x: 0, y: 0, width: 1, height: 1 };
	const basis =
		itemLike.kind === "rectangle" || itemLike.kind === "ellipse"
			? unit
			: pointsBounds(shapeTemplatePoints(itemLike.kind, unit));
	if (basis == null) return normalizeBounds(target);
	const sx = target.width / basis.width;
	const sy = target.height / basis.height;
	return normalizeBounds({
		x: target.x - basis.x * sx,
		y: target.y - basis.y * sy,
		width: sx,
		height: sy,
	});
}

/** Bounds shrunk by `width` on every side (clamped at center). (`tt`) */
function insetBounds(b: Bounds | null, width: number): Bounds | null {
	if (b == null) return null;
	const n = normalizeBounds(b);
	const r = width / 2;
	return {
		x: n.x + Math.min(r, n.width / 2),
		y: n.y + Math.min(r, n.height / 2),
		width: Math.max(0, n.width - width),
		height: Math.max(0, n.height - width),
	};
}

/**
 * New raw bounds when dragging `handle` to `point`. Corner drags preserve
 * aspect ratio (`ot`); single-axis handles (`at`) keep a centered square.
 */
function resizedBounds(
	item: SketchItem,
	handle: ResizeHandle,
	point: { x: number; y: number },
	limit: Bounds | null = null,
): Bounds | null {
	const raw = rawGeometryBounds(item);
	const sel = selectionBounds(item);
	if (raw == null || sel == null) return null;
	if (isDotStroke(item)) return centeredSquareResize(sel, handle, point);
	const west = handle.includes("w");
	const north = handle.includes("n");
	return boxDrag(
		raw,
		handle,
		{
			x: point.x + raw.x - sel.x + (west ? 0 : raw.width - sel.width),
			y: point.y + raw.y - sel.y + (north ? 0 : raw.height - sel.height),
		},
		item.kind === "ink"
			? limit
			: item.kind === "stroke"
				? null
				: insetBounds(limit, item.kind === "text" ? 0 : item.style.width),
	);
}

/** Dot stroke resize: stays a centered square on the dragged axis. (`at`) */
function centeredSquareResize(
	b: Bounds,
	handle: ResizeHandle,
	point: { x: number; y: number },
): Bounds {
	const raw = boxDrag(b, handle, point, null);
	const horiz = handle === "e" || handle === "w";
	const vert = handle === "n" || handle === "s";
	const extent = vert ? raw.height : raw.width;
	const side = Math.max(Math.min(b.width, 1), Math.abs(extent));
	const signed = extent < 0 ? -side : side;
	return {
		x: vert
			? b.x + (b.width - side) / 2
			: handle.includes("w")
				? b.x + b.width - signed
				: b.x,
		y: horiz
			? b.y + (b.height - side) / 2
			: handle.includes("n")
				? b.y + b.height - signed
				: b.y,
		width: vert ? side : signed,
		height: horiz ? side : signed,
	};
}

/** Drag one side/corner of a box; corners preserve aspect ratio. (`ot`) */
function boxDrag(
	b: Bounds,
	handle: ResizeHandle,
	point: { x: number; y: number },
	limit: Bounds | null,
): Bounds {
	const west = handle.includes("w");
	const north = handle.includes("n");
	const anchorX = b.x + (west ? b.width : 0);
	const anchorY = b.y + (north ? b.height : 0);
	const c = clampPointToBounds(point, limit);
	if (handle.length !== 2 || b.width === 0 || b.height === 0) {
		const x = west ? c.x : b.x;
		const y = north ? c.y : b.y;
		return {
			x,
			y,
			width: (handle.includes("e") ? c.x : b.x + b.width) - x,
			height: (handle.includes("s") ? c.y : b.y + b.height) - y,
		};
	}
	const lx = west ? anchorX - c.x : c.x - anchorX;
	const ly = north ? anchorY - c.y : c.y - anchorY;
	let d =
		(lx * b.width + ly * b.height) / (b.width ** 2 + b.height ** 2);
	if (limit != null) {
		const flipX = west !== d < 0;
		const flipY = north !== d < 0;
		const maxX = flipX ? anchorX - limit.x : limit.x + limit.width - anchorX;
		const maxY = flipY ? anchorY - limit.y : limit.y + limit.height - anchorY;
		d = Math.sign(d) * Math.min(Math.abs(d), maxX / b.width, maxY / b.height);
	}
	const w = b.width * d;
	const h = b.height * d;
	return {
		x: west ? anchorX - w : anchorX,
		y: north ? anchorY - h : anchorY,
		width: w,
		height: h,
	};
}

/**
 * Resize an object through `handle` so the dragged point lands at `point`,
 * keeping the result inside `surfaceBounds` (binary search fallback). (`Qe`)
 */
function resizeObject(
	item: SketchItem,
	handle: ResizeHandle,
	point: { x: number; y: number },
	surfaceBounds: Bounds | null,
): SketchItem {
	const sel = selectionBounds(item);
	if (sel == null) return item;
	const limit = surfaceBounds == null ? null : boundsUnion(surfaceBounds, sel);
	const apply = (p: { x: number; y: number }): SketchItem => {
		switch (item.kind) {
			case "line":
			case "arrow": {
				if (handle !== "start" && handle !== "end") return item;
				const key = handle === "start" ? "from" : "to";
				const clamped = clampPointToBounds(
					p,
					insetBounds(
						limit,
						item.kind === "arrow" && handle === "end" ? 0 : item.style.width,
					),
				);
				return clamped.x === item[key].x && clamped.y === item[key].y
					? item
					: ({ ...item, [key]: clamped } as SketchItem);
			}
		}
		if (handle === "start" || handle === "end") return item;
		const raw = rawGeometryBounds(item);
		const next = resizedBounds(item, handle, p, limit);
		if (
			raw == null ||
			next == null ||
			(next.x === raw.x &&
				next.y === raw.y &&
				next.width === raw.width &&
				next.height === raw.height)
		)
			return item;
		if (item.kind === "stroke") return remapStroke(item, raw, next);
		if (item.kind === "ink") {
			// Points remap onto the (possibly flipped) target rect directly.
			return {
				...item,
				points:
					raw.width === 0 || raw.height === 0
						? item.points
						: item.points.map((p) => ({
								...p,
								x: next.x + ((p.x - raw.x) / raw.width) * next.width,
								y: next.y + ((p.y - raw.y) / raw.height) * next.height,
							})),
			};
		}
		if (item.kind === "text") {
			return resizeTextObject(item, handle, point, surfaceBounds);
		}
		const flipped = {
			...item,
			flipX: (item.flipX === true) !== next.width < 0 || undefined,
			flipY: (item.flipY === true) !== next.height < 0 || undefined,
		};
		return {
			...flipped,
			bounds: shapeBoundsFromTarget(flipped, normalizeBounds(next)),
		};
	};
	const direct = apply(point);
	const fits = (candidate: SketchItem) => {
		const b = selectionBounds(candidate);
		return limit == null || b == null || boundsContain(limit, b);
	};
	if (fits(direct)) return direct;
	const anchor =
		item.kind === "line" || item.kind === "arrow"
			? handle === "start"
				? item.from
				: item.to
			: {
					x: sel.x + (handle.includes("w") ? 0 : sel.width),
					y: sel.y + (handle.includes("n") ? 0 : sel.height),
				};
	let best = item;
	let lo = 0;
	let hi = 1;
	for (let i = 0; i < 24; i += 1) {
		const t = (lo + hi) / 2;
		const candidate = apply({
			x: lerp(anchor.x, point.x, t),
			y: lerp(anchor.y, point.y, t),
		});
		if (fits(candidate)) {
			lo = t;
			best = candidate;
		} else {
			hi = t;
		}
	}
	return best;
}


/** Remap a text box given a new bounds rect (raw box drag). (`nn`) */
function textDragBounds(
	b: Bounds,
	handle: ResizeHandle,
	point: { x: number; y: number },
): Bounds {
	let l = b.x;
	let t = b.y;
	let r = b.x + b.width;
	let bo = b.y + b.height;
	if (handle.includes("w")) l = point.x;
	if (handle.includes("e")) r = point.x;
	if (handle.includes("n")) t = point.y;
	if (handle.includes("s")) bo = point.y;
	return { x: l, y: t, width: r - l, height: bo - t };
}

/** Handle actually grabbed after flip normalization. (`$t`) */
function effectiveHandle(
	item: SketchItem,
	handle: ResizeHandle,
	point: { x: number; y: number },
): ResizeHandle {
	const b = selectionBounds(item);
	if (b == null || handle === "start" || handle === "end") return handle;
	const next =
		item.kind === "text"
			? textDragBounds(b, handle, point)
			: resizedBounds(item, handle, point);
	if (next == null) return handle;
	const flipX = next.width < 0;
	const flipY = next.height < 0;
	const north = handle.includes("n") !== flipY;
	const west = handle.includes("w") !== flipX;
	if (handle.length === 2) {
		if (north) return west ? "nw" : "ne";
		return west ? "sw" : "se";
	}
	if (handle === "n" || handle === "s") return north ? "n" : "s";
	return west ? "w" : "e";
}

/** Clone an object under a new id. (`an`) */
function cloneItem(item: SketchItem, id: string): SketchItem {
	switch (item.kind) {
		case "stroke":
		case "ink":
			return { ...item, id, points: item.points.map((p) => ({ ...p })) };
		case "line":
		case "arrow":
			return { ...item, id, from: { ...item.from }, to: { ...item.to } };
		case "rectangle":
		case "ellipse":
		case "triangle":
		case "diamond":
		case "star":
		case "heart":
		case "text":
			return { ...item, id, bounds: { ...item.bounds } };
	}
}

// ---------------------------------------------------------------------------
// Text layout (DOM-free estimator; `jt`/`Mt`/`Ot`/`D`-style normalization)
// ---------------------------------------------------------------------------

interface GraphemeSegmenterLike {
	segment(text: string): Iterable<{ segment: string }>;
}

let graphemeSegmenter: GraphemeSegmenterLike | null | undefined;
function graphemes(text: string): string[] {
	if (graphemeSegmenter === undefined) {
		const intl: typeof Intl & { Segmenter?: unknown } = Intl;
		const candidate = intl.Segmenter;
		// Intl.Segmenter lacks lib types in ES2021; validate it is a constructor.
		graphemeSegmenter =
			typeof candidate === "function"
				? (Reflect.construct(candidate, [
						undefined,
						{ granularity: "grapheme" },
					]) as GraphemeSegmenterLike)
				: null;
	}
	if (graphemeSegmenter == null) return Array.from(text);
	return Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
}

const isFormattingOnly = (g: string) =>
	/^[\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]+$/u.test(g);
const isBreakable = (g: string) => /\s/.test(g) || g === "-";

/** Estimated grapheme advance at `fontSize`. (`jt`) */
export function measureTextWidth(text: string, fontSize: number): number {
	let w = 0;
	for (const g of graphemes(text)) {
		if (isFormattingOnly(g)) continue;
		if (/^\s+$/u.test(g)) w += fontSize * 0.32;
		else if (/^[ilI.,'!|]$/u.test(g)) w += fontSize * 0.28;
		else if (/^[MW@#%&]$/u.test(g)) w += fontSize * 0.82;
		else if (/[^ -~]/u.test(g)) w += fontSize;
		else w += fontSize * 0.56;
	}
	return w;
}


/** Wrap + line-height → layout. (`w`/`Ot` simplified, estimator only) */
export function layoutText(opts: {
	text: string;
	boxWidth: number;
	fontSize: number;
}): { lines: string[]; lineHeight: number; height: number } {
	const fontSize = normalizeFontSize(opts.fontSize);
	const innerWidth = Math.max(opts.boxWidth - TEXT_PADDING * 2, fontSize / 8);
	const lineHeight = fontSize * TEXT_LINE_HEIGHT_RATIO;
	const paragraphs = normalizeLineEndings(opts.text).split("\n");
	const lines: string[] = [];
	for (const para of paragraphs) {
		if (para.length === 0) {
			lines.push("");
			continue;
		}
		// Greedy wrap in fontSize units.
		const gs = graphemes(para);
		let start = 0;
		while (start < gs.length) {
			let end = start;
			let breakAt = -1;
			let w = 0;
			for (let i = start; i < gs.length; i += 1) {
				const gw = measureTextWidth(gs[i] ?? "", fontSize);
				if (w + gw > innerWidth && i > start) break;
				w += gw;
				end = i + 1;
				const g = gs[i];
				if (g != null && isBreakable(g)) breakAt = i + 1;
			}
			if (end <= start) end = start + 1;
			const stop = end < gs.length && breakAt > start ? breakAt : end;
			lines.push(gs.slice(start, stop).join("").trimEnd());
			start = stop;
			while (start < gs.length) {
				const g = gs[start];
				if (g == null || !/\s/.test(g)) break;
				start += 1;
			}
		}
	}
	if (lines.length === 0) lines.push("");
	return { lines, lineHeight, height: Math.max(lines.length * lineHeight, lineHeight) };
}

const normalizeFontSize = (v: number) =>
	Number.isFinite(v) && v > 0 ? v : TEXT_SIZE_DEFAULT;
const normalizeLineEndings = (s: string) => s.replace(/\r\n?/g, "\n");

/** Minimum box width: widest grapheme + padding. (`y` fallback path) */
function textMinimumWidth(opts: {
	text: string;
	fontSize: number;
	format: TextFormat;
}): number {
	const fontSize = normalizeFontSize(opts.fontSize);
	let widest = 0;
	for (const g of new Set(graphemes(normalizeLineEndings(opts.text)))) {
		if (isFormattingOnly(g)) continue;
		const w = measureTextWidth(g, fontSize);
		if (Number.isFinite(w)) widest = Math.max(widest, w);
	}
	if (widest === 0) widest = fontSize;
	return widest + TEXT_PADDING * 2;
}

/**
 * Normalize a text object: width grown to fit the widest grapheme, height
 * relaid out. (`D`/`Tt` simplified — padding fixed at TEXT_PADDING.)
 */
function normalizeTextObject<
	T extends Extract<SketchItem, { kind: "text" }>,
>(item: T): T {
	const bounds = normalizeBounds(item.bounds);
	const text = normalizeLineEndings(item.text);
	const width = Math.max(
		bounds.width,
		textMinimumWidth({
			text,
			fontSize: item.style.width,
			format: item.format,
		}),
	);
	const layout = layoutText({ text, boxWidth: width, fontSize: item.style.width });
	return {
		...item,
		text,
		bounds: { x: bounds.x, y: bounds.y, width, height: layout.height + TEXT_PADDING * 2 },
	};
}

/** Default bounds for a fresh text box at `point` inside `existing`. (`wt`) */
function defaultTextBounds(
	point: { x: number; y: number },
	existing: Bounds,
	fontSize: number,
): Bounds {
	const fs = normalizeFontSize(fontSize);
	const minW = fs + TEXT_PADDING * 2;
	const w = Math.max(existing.width, minW);
	const h = Math.max(existing.height, 0);
	const x = clamp(point.x, 0, w);
	const left = Math.max(x - TEXT_PADDING, 0);
	const spaceRight = w - left;
	const width = Math.min(
		Math.max(TEXT_INITIAL_WIDTH, minW),
		Math.max(spaceRight, minW),
	);
	const minH = fs * TEXT_LINE_HEIGHT_RATIO + TEXT_PADDING * 2;
	const top = clamp(
		point.y - TEXT_PADDING - (fs * TEXT_LINE_HEIGHT_RATIO) / 2,
		0,
		Math.max(h - minH, 0),
	);
	return {
		x: spaceRight >= minW ? left : Math.max(w - width, 0),
		y: top,
		width,
		height: minH,
	};
}

/** Inner width when a box of `outer` carries `pad` per side. (`pt`) */
function innerExtent(outer: number, pad: number): number {
	const floor = pad / 8;
	return Math.max(outer - pad * 2, floor);
}

/** Corner/n-s text resize: scale font by drag extent, keep anchor. (`xn`) */
function resizeTextObject(
	item: Extract<SketchItem, { kind: "text" }>,
	handle: ResizeHandle,
	point: { x: number; y: number },
	surfaceBounds: Bounds | null,
): SketchItem {
	if (handle === "e" || handle === "w")
		return resizeTextWidth(item, handle, point);
	const b = normalizeBounds(item.bounds);
	const pad = TEXT_PADDING;
	const fontSize = normalizeFontSize(item.style.width);
	const scale = textScaleRatio(b, handle, point, pad);
	const nextSize = normalizeFontSize(fontSize * scale);
	const c = nextSize / fontSize;
	const width = Math.max(
		textMinimumWidth({ text: item.text, fontSize: nextSize, format: item.format }),
		innerExtent(b.width, pad) * c + pad * 2,
	);
	const relaid = normalizeTextObject({
		...item,
		style: { ...item.style, width: nextSize },
		bounds: { ...b, width },
	});
	const right = b.x + b.width;
	const bottom = b.y + b.height;
	const cx = b.x + b.width / 2;
	const cy = b.y + b.height / 2;
	const eff = effectiveHandle(item, handle, point);
	const anchorX = handle.includes("w") ? right : b.x;
	const anchorY = handle.includes("n") ? bottom : b.y;
	const x =
		handle.includes("w") || handle.includes("e")
			? anchorX - (eff.includes("w") ? relaid.bounds.width : 0)
			: cx - relaid.bounds.width / 2;
	const y =
		handle.includes("n") || handle.includes("s")
			? anchorY - (eff.includes("n") ? relaid.bounds.height : 0)
			: cy - relaid.bounds.height / 2;
	let out: SketchItem = {
		...relaid,
		bounds: { ...relaid.bounds, x, y },
	};
	if (surfaceBounds != null) {
		const limit = normalizeBounds(surfaceBounds);
		const sb = selectionBounds(out);
		if (sb != null && !boundsContain(limit, sb)) {
			// Binary search the drag toward the anchor until it fits. (`tn`-ish)
			const anchor = {
				x: b.x + (handle.includes("w") ? 0 : b.width),
				y: b.y + (handle.includes("n") ? 0 : b.height),
			};
			let lo = 0;
			let hi = 1;
			for (let i = 0; i < 20; i += 1) {
				const t = (lo + hi) / 2;
				const candidate = resizeTextObject(
					item,
					handle,
					{ x: lerp(anchor.x, point.x, t), y: lerp(anchor.y, point.y, t) },
					null,
				);
				const cb = selectionBounds(candidate);
				if (cb == null || boundsContain(limit, cb)) {
					lo = t;
					out = candidate;
				} else {
					hi = t;
				}
			}
		}
	}
	return out;
}

/** (`Sn`) side handles change width only. */
function resizeTextWidth(
	item: Extract<SketchItem, { kind: "text" }>,
	handle: ResizeHandle,
	point: { x: number; y: number },
): SketchItem {
	const b = normalizeBounds(item.bounds);
	const minW = textMinimumWidth({
		text: item.text,
		fontSize: item.style.width,
		format: item.format,
	});
	const anchor = handle === "w" ? b.x + b.width : b.x;
	const width = Math.max(Math.abs(point.x - anchor), minW);
	const eff = effectiveHandle(item, handle, point);
	return normalizeTextObject({
		...item,
		bounds: { ...b, x: eff === "w" ? anchor - width : anchor, width },
	});
}

/** Font-scale ratio for a text drag. (`wn`/`Tn`) */
function textScaleRatio(
	b: Bounds,
	handle: ResizeHandle,
	point: { x: number; y: number },
	pad: number,
): number {
	const right = b.x + b.width;
	const innerW = innerExtent(b.width, pad);
	const horiz = handle.includes("w")
		? scaleFactor(right - point.x, innerW, pad)
		: handle.includes("e")
			? scaleFactor(point.x - b.x, innerW, pad)
			: null;
	return (
		horiz ??
		scaleFactor(
			handle.includes("n") ? b.y + b.height - point.y : point.y - b.y,
			innerExtent(b.height, pad),
			pad,
		)
	);
}
function scaleFactor(extent: number, inner: number, pad: number): number {
	return Math.max(pad / Math.max(inner, pad / 8) / pad, innerExtent(Math.abs(extent), pad) / inner);
}

/** Clamp font size so text still fits surface height. (`fn` simplified) */
function fitTextStyle(
	item: Extract<SketchItem, { kind: "text" }>,
	style: StrokeStyle,
	surfaceBounds: Bounds | null,
): StrokeStyle {
	const next = { ...style, width: normalizeFontSize(style.width) };
	if (surfaceBounds == null) return next;
	const limit = normalizeBounds(surfaceBounds);
	const avail = Math.max(limit.y + limit.height - item.bounds.y, 0);
	const fits = (size: number) => {
		const layout = layoutText({
			text: item.text,
			boxWidth: item.bounds.width,
			fontSize: size,
		});
		return layout.height + TEXT_PADDING * 2 <= avail;
	};
	if (fits(next.width)) return next;
	const minSize = Math.min(TEXT_SIZE_MIN, normalizeFontSize(item.style.width), next.width);
	if (!fits(minSize)) return { ...next, width: minSize };
	let lo = minSize;
	let hi = next.width;
	for (let i = 0; i < 16; i += 1) {
		const mid = (lo + hi) / 2;
		if (fits(mid)) lo = mid;
		else hi = mid;
	}
	return { ...next, width: lo };
}

// ---------------------------------------------------------------------------
// Shift constraints (`hn`/`Nn`/`Pn`) and move clamping (`sn`/`kn`)
// ---------------------------------------------------------------------------

const isShapeObject = (k: string) =>
	k === "rectangle" ||
	k === "ellipse" ||
	k === "triangle" ||
	k === "diamond" ||
	k === "star" ||
	k === "heart";
const isDrawableShapeTool = (tool: string) =>
	tool === "line" || tool === "arrow" || isShapeObject(tool);

/** Remaining distance to bounds edge along sign. (`Nn`) */
function edgeDistance(p: number, dir: number, lo: number, hi: number): number {
	return Math.max(dir >= 0 ? hi - p : p - lo, 0);
}
/** Ray distance to a bounds box. (`Pn`) */
function rayDistance(
	origin: { x: number; y: number },
	cos: number,
	sin: number,
	b: Bounds,
): number {
	const out: number[] = [];
	if (Math.abs(cos) > 2 ** -52)
		out.push(edgeDistance(origin.x, cos, b.x, b.x + b.width) / Math.abs(cos));
	if (Math.abs(sin) > 2 ** -52)
		out.push(edgeDistance(origin.y, sin, b.y, b.y + b.height) / Math.abs(sin));
	return out.length === 0 ? 0 : Math.min(...out);
}

/**
 * Constrain endpoint `to` relative to `from`: shape tools → equal extents
 * (square/circle), line/arrow → 45° angles. (`hn`)
 */
function constrainEndpoint(
	from: { x: number; y: number },
	to: { x: number; y: number },
	kind: ShapeKind,
	surfaceBounds: Bounds | null,
): { x: number; y: number } {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const limit = surfaceBounds == null ? null : normalizeBounds(surfaceBounds);
	if (isShapeObject(kind)) {
		const sx = Math.sign(dx || 1);
		const sy = Math.sign(dy || 1);
		let side = Math.max(Math.abs(dx), Math.abs(dy));
		if (limit != null) {
			side = Math.min(
				side,
				edgeDistance(from.x, sx, limit.x, limit.x + limit.width),
				edgeDistance(from.y, sy, limit.y, limit.y + limit.height),
			);
		}
		return { x: from.x + sx * side, y: from.y + sy * side };
	}
	const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
	const cos = Math.cos(angle);
	const sin = Math.sin(angle);
	let len = Math.hypot(dx, dy);
	if (limit != null) len = Math.min(len, rayDistance(from, cos, sin, limit));
	return { x: from.x + cos * len, y: from.y + sin * len };
}

/** Minimum-size check for committing a drawn object. (`mn`) */
function meetsMinSize(item: SketchItem | SketchEraserPreview, min = SHAPE_MIN_SIZE): boolean {
	if (item.kind === "line" || item.kind === "arrow")
		return dist(item.from, item.to) >= min;
	if (
		item.kind === "rectangle" ||
		item.kind === "ellipse" ||
		item.kind === "triangle" ||
		item.kind === "diamond" ||
		item.kind === "star" ||
		item.kind === "heart"
	)
		return item.bounds.width >= min && item.bounds.height >= min;
	return true;
}

/** Clamp a translate delta so the object stays on the surface. (`sn`) */
function clampMoveDelta(
	item: SketchItem,
	delta: { x: number; y: number },
	surfaceBounds: Bounds | null,
): { x: number; y: number } {
	if (surfaceBounds == null) return delta;
	const basis =
		item.kind === "stroke" || (isShapeObject(item.kind) && item.kind !== "rectangle")
			? selectionBounds(item)
			: drawingBounds(item);
	if (basis == null) return delta;
	const a = normalizeBounds(basis);
	const o = normalizeBounds(surfaceBounds);
	return {
		x: clampDeltaAxis(delta.x, a.x, a.width, o.x, o.width),
		y: clampDeltaAxis(delta.y, a.y, a.height, o.y, o.height),
	};
}
function clampDeltaAxis(
	d: number,
	pos: number,
	size: number,
	surfacePos: number,
	surfaceSize: number,
): number {
	const end = pos + size;
	const surfaceEnd = surfacePos + surfaceSize;
	return clamp(
		d,
		size <= surfaceSize ? Math.min(surfacePos - pos, 0) : surfaceEnd - end,
		size <= surfaceSize ? Math.max(surfaceEnd - end, 0) : surfacePos - pos,
	);
}

/** Keep a pasted object inside the surface when possible. (`on`/`On`) */
function clampPasteOffset(
	item: SketchItem,
	offset: { x: number; y: number },
	surfaceBounds: Bounds | null,
): { x: number; y: number } {
	const b = drawingBounds(item);
	if (b == null || surfaceBounds == null) return offset;
	const i = normalizeBounds(b);
	const a = normalizeBounds(surfaceBounds);
	return {
		x: pasteAxis(i.x, i.width, a.x, a.width, offset.x),
		y: pasteAxis(i.y, i.height, a.y, a.height, offset.y),
	};
}
function pasteAxis(
	pos: number,
	size: number,
	surfacePos: number,
	surfaceSize: number,
	offset: number,
): number {
	const fits = (d: number) => pos + d >= surfacePos && pos + size + d <= surfacePos + surfaceSize;
	return fits(offset) ? offset : fits(-offset) ? -offset : 0;
}

// ---------------------------------------------------------------------------
// Text alignment snapping (`pa`/`ga`/`ha`/`ma`/`fa`) — alignment only
// ---------------------------------------------------------------------------

interface SnapResult {
	delta: { x: number; y: number };
	guides: SnapGuide[];
}

const axisStart = (b: Bounds, axis: "x" | "y") => (axis === "x" ? b.x : b.y);
const axisSize = (b: Bounds, axis: "x" | "y") => (axis === "x" ? b.width : b.height);
const axisEnd = (b: Bounds, axis: "x" | "y") => axisStart(b, axis) + axisSize(b, axis);
const axisCoord = (b: Bounds, axis: "x" | "y", mode: "start" | "center" | "end") => {
	const s = axisStart(b, axis);
	const e = axisEnd(b, axis);
	return mode === "start" ? s : mode === "center" ? s + (e - s) / 2 : e;
};

/** Closest alignment candidate on one axis. (`ga`) */
function alignmentSnap(
	axis: "x" | "y",
	target: Bounds,
	others: Bounds[],
	tolerance: number,
): { offset: number; distance: number; guide: SnapGuide } | null {
	let best: { offset: number; distance: number; guide: SnapGuide } | null = null;
	for (const other of others) {
		for (const mode of ["start", "center", "end"] as const) {
			const offset = axisCoord(other, axis, mode) - axisCoord(target, axis, mode);
			const d = Math.abs(offset);
			if (d > tolerance || (best != null && d >= best.distance)) continue;
			const coordinate = axisCoord(target, axis, mode) + offset;
			const cross = axis === "x" ? "y" : "x";
			const start = Math.min(axisStart(target, cross), axisStart(other, cross));
			const end = Math.max(axisEnd(target, cross), axisEnd(other, cross));
			best = {
				offset,
				distance: d,
				guide: { kind: "alignment", axis, coordinate, start, end },
			};
		}
	}
	return best;
}

/**
 * Snap a text object's translate delta to alignment with other text objects.
 * (`pa` — equal-gap snapping intentionally omitted.)
 */
function snapTextMove(opts: {
	doc: SketchDoc;
	object: SketchItem;
	delta: { x: number; y: number };
	tolerance: number;
	suppressAxes?: { x: boolean; y: boolean };
}): SnapResult {
	const tol = nonNegative(opts.tolerance);
	if (tol === 0 || opts.object.kind !== "text")
		return { delta: opts.delta, guides: [] };
	const moved = normalizeBounds({
		...opts.object.bounds,
		x: opts.object.bounds.x + opts.delta.x,
		y: opts.object.bounds.y + opts.delta.y,
	});
	const others = opts.doc.objects
		.filter(
			(o): o is Extract<SketchItem, { kind: "text" }> =>
				o.kind === "text" && o.id !== opts.object.id,
		)
		.map((o) => normalizeBounds(o.bounds));
	if (others.length === 0) return { delta: opts.delta, guides: [] };
	const suppress = opts.suppressAxes ?? { x: false, y: false };
	const sx = suppress.x ? null : alignmentSnap("x", moved, others, tol);
	const sy = suppress.y ? null : alignmentSnap("y", moved, others, tol);
	return {
		delta: {
			x: opts.delta.x + (sx?.offset ?? 0),
			y: opts.delta.y + (sy?.offset ?? 0),
		},
		guides: [sx?.guide, sy?.guide].filter((g): g is SnapGuide => g != null),
	};
}

/** Initial snap offsets at delta 0 (so the drag can break free). (`fa`) */
function initialSnapOffsets(
	doc: SketchDoc,
	object: SketchItem,
	tolerance: number,
): { x: number | null; y: number | null } {
	if (object.kind !== "text") return { x: null, y: null };
	const r = snapTextMove({
		doc,
		object,
		delta: { x: 0, y: 0 },
		tolerance,
	});
	const snapped = (axis: "x" | "y") => r.guides.some((g) => g.axis === axis);
	return { x: snapped("x") ? r.delta.x : null, y: snapped("y") ? r.delta.y : null };
}

/** Keep only guides whose snap survived surface clamping. (`ma`) */
function filterGuides(
	guides: SnapGuide[],
	preClamp: { x: number; y: number },
	postClamp: { x: number; y: number },
): SnapGuide[] {
	return guides.filter((g) =>
		g.axis === "x" ? preClamp.x === postClamp.x : preClamp.y === postClamp.y,
	);
}

// ---------------------------------------------------------------------------
// Vector erasure (`go` simplified: sync cutting, polyline residuals)
// ---------------------------------------------------------------------------

interface EraserSegment {
	from: { x: number; y: number };
	to: { x: number; y: number };
}

interface ErasePartState {
	changed: boolean;
	runs: SketchPoint[][];
}

interface ErasureSession {
	readonly released: boolean;
	readonly document: SketchDoc;
	append(points: SketchPoint[]): void;
	finish(): void;
	cancel(): void;
}

/**
 * Cut `runs` at `t ∈ [0,1]` intervals where the eraser capsule (segments of
 * radius `r`) covers each polyline segment. Returns residual runs.
 */
function cutPolyline(
	points: readonly SketchPoint[],
	segments: readonly EraserSegment[],
	r: number,
): SketchPoint[][] {
	// Collect erase intervals per source segment.
	const cuts = points.slice(0, -1).map(() => [] as [number, number][]);
	for (let i = 0; i + 1 < points.length; i += 1) {
		const a = points[i];
		const b = points[i + 1];
		if (a == null || b == null) continue;
		for (const seg of segments) {
			for (const interval of segmentEraseIntervals(a, b, seg, r)) {
				cuts[i]?.push(interval);
			}
		}
	}
	// Single-point runs (dot): erased when the capsule covers the center.
	if (points.length === 1) {
		const p = points[0];
		if (p == null) return [];
		for (const seg of segments) {
			if (distToSegment(p, seg.from, seg.to) <= r) return [];
		}
		return [points.slice()];
	}
	// Build residual runs from kept sub-intervals.
	const out: SketchPoint[][] = [];
	let current: SketchPoint[] | null = null;
	for (let i = 0; i + 1 < points.length; i += 1) {
		const a = points[i];
		const b = points[i + 1];
		if (a == null || b == null) continue;
		const kept = subtractIntervals(cuts[i] ?? []);
		for (const [t0, t1] of kept) {
			const p0: SketchPoint = {
				x: a.x + (b.x - a.x) * t0,
				y: a.y + (b.y - a.y) * t0,
				pressure: interpolatePressure(a, b, t0),
			};
			const p1: SketchPoint = {
				x: a.x + (b.x - a.x) * t1,
				y: a.y + (b.y - a.y) * t1,
				pressure: interpolatePressure(a, b, t1),
			};
			const tail = current == null ? null : current[current.length - 1];
			const cont = tail != null && tail.x === p0.x && tail.y === p0.y;
			if (!cont && current != null) out.push(current);
			const run: SketchPoint[] = cont && current != null ? current : [p0];
			run.push(p1);
			current = run;
		}
	}
	if (current != null) out.push(current);
	return out;
}

function interpolatePressure(
	a: SketchPoint,
	b: SketchPoint,
	t: number,
): number | undefined {
	if (a.pressure == null && b.pressure == null) return undefined;
	return lerp(a.pressure ?? 1, b.pressure ?? 1, t);
}

/** Merge erase intervals and return kept complement within [0,1]. */
function subtractIntervals(cuts: [number, number][]): [number, number][] {
	if (cuts.length === 0) return [[0, 1]];
	const sorted = cuts
		.map(([a, b]) => [Math.max(0, Math.min(a, b)), Math.min(1, Math.max(a, b))] as [number, number])
		.sort((a, b) => a[0] - b[0]);
	const kept: [number, number][] = [];
	let cursor = 0;
	for (const [lo, hi] of sorted) {
		if (lo > cursor) kept.push([cursor, Math.min(lo, 1)]);
		cursor = Math.max(cursor, hi);
		if (cursor >= 1) break;
	}
	if (cursor < 1) kept.push([cursor, 1]);
	return kept.filter(([a, b]) => b - a > 1e-9);
}

/**
 * Intervals of `t` on segment ab where the eraser capsule cd (radius r)
 * covers the point. Analytic: chord through the capsule's Minkowski sum
 * approximated by circle-chord at both ends + parallel lines around c→d.
 */
function segmentEraseIntervals(
	a: { x: number; y: number },
	b: { x: number; y: number },
	seg: EraserSegment,
	r: number,
): [number, number][] {
	const intervals: [number, number][] = [];
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const len2 = abx * abx + aby * aby;
	if (len2 === 0) {
		return distToSegment(a, seg.from, seg.to) <= r ? [[0, 1]] : [];
	}
	const addClamped = (lo: number, hi: number) => {
		const l = Math.max(0, Math.min(lo, hi));
		const h = Math.min(1, Math.max(lo, hi));
		if (h - l > 1e-9) intervals.push([l, h]);
	};
	// Rounded ends: chord through each circle.
	for (const c of [seg.from, seg.to]) {
		const cx = c.x - a.x;
		const cy = c.y - a.y;
		const A = len2;
		const B = -2 * (cx * abx + cy * aby);
		const C = cx * cx + cy * cy - r * r;
		const disc = B * B - 4 * A * C;
		if (disc <= 0) continue;
		const sq = Math.sqrt(disc);
		addClamped((-B - sq) / (2 * A), (-B + sq) / (2 * A));
	}
	// Rectangular middle: where |perp distance to the axis| <= r AND the
	// axial projection lands within [0, len] of the capsule's axis segment.
	const cdx = seg.to.x - seg.from.x;
	const cdy = seg.to.y - seg.from.y;
	const clen = Math.hypot(cdx, cdy);
	if (clen > 0) {
		const ux = cdx / clen;
		const uy = cdy / clen;
		const nx = -uy;
		const ny = ux;
		const d0 = (a.x - seg.from.x) * nx + (a.y - seg.from.y) * ny;
		const d1 = (b.x - seg.from.x) * nx + (b.y - seg.from.y) * ny;
		const dd = d1 - d0;
		// Perp-distance interval: roots at |d| = r.
		let strip: [number, number] | null = null;
		if (Math.abs(dd) > 1e-12) {
			const tA = (r - d0) / dd;
			const tB = (-r - d0) / dd;
			if (tA > tB ? tB < 1 && tA > 0 : tA < 1 && tB > 0) {
				strip = [Math.min(tA, tB), Math.max(tA, tB)];
			}
		} else if (Math.abs(d0) <= r) {
			strip = [-Infinity, Infinity];
		}
		if (strip != null) {
			// Axial projection interval: proj(t) ∈ [0, clen].
			const p0 = (a.x - seg.from.x) * ux + (a.y - seg.from.y) * uy;
			const p1 = (b.x - seg.from.x) * ux + (b.y - seg.from.y) * uy;
			const pd = p1 - p0;
			let proj: [number, number] | null = null;
			if (Math.abs(pd) > 1e-12) {
				const tA = (0 - p0) / pd;
				const tB = (clen - p0) / pd;
				if (tA > tB ? tB < 1 && tA > 0 : tA < 1 && tB > 0) {
					proj = [Math.min(tA, tB), Math.max(tA, tB)];
				}
			} else if (p0 >= 0 && p0 <= clen) {
				proj = [-Infinity, Infinity];
			}
			if (proj != null) {
				addClamped(
					Math.max(strip[0], proj[0]),
					Math.min(strip[1], proj[1]),
				);
			}
		}
	}
	return intervals;
}

/** Convert any object to outline polylines for cutting. (`io` simplified) */
function outlinePolylines(item: SketchItem): SketchPoint[][] {
	switch (item.kind) {
		case "stroke":
		case "ink":
			return splitPointRuns(
				item.kind === "stroke"
					? smoothStrokePoints(item.points, item.style.width)
					: item.points,
			);
		case "line":
			return [[item.from, item.to]];
		case "arrow": {
			const head = arrowHead(item);
			return [
				[item.from, arrowShaftEnd(item)],
				[item.to, head.left, head.right],
			];
		}
		case "rectangle":
		case "ellipse":
		case "triangle":
		case "diamond":
		case "star":
		case "heart": {
			const { points, closed } = shapeOutlinePoints(item);
			return closed && points.length > 0 ? [[...points, points[0]!]] : [points];
		}
		case "text":
			return [];
	}
}

/** True when the eraser capsule hits a text object (bounds approximation). */
function eraserHitsText(
	item: Extract<SketchItem, { kind: "text" }>,
	segments: readonly EraserSegment[],
	r: number,
): boolean {
	const b = normalizeBounds(item.bounds);
	const corners = [
		{ x: b.x, y: b.y },
		{ x: b.x + b.width, y: b.y },
		{ x: b.x + b.width, y: b.y + b.height },
		{ x: b.x, y: b.y + b.height },
	];
	for (const seg of segments) {
		if (pointInBounds(b, seg.from) || pointInBounds(b, seg.to)) return true;
		for (let i = 0; i < 4; i += 1) {
			const c1 = corners[i];
			const c2 = corners[(i + 1) % 4];
			if (c1 != null && c2 != null && segmentsIntersect(seg.from, seg.to, c1, c2))
				return true;
			if (c1 != null && distToSegment(c1, seg.from, seg.to) <= r) return true;
		}
	}
	return false;
}

function segmentsIntersect(
	a: { x: number; y: number },
	b: { x: number; y: number },
	c: { x: number; y: number },
	d: { x: number; y: number },
): boolean {
	const s = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }) =>
		(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
	const d1 = s(c, d, a);
	const d2 = s(c, d, b);
	const d3 = s(a, b, c);
	const d4 = s(a, b, d);
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Create a live erasure session over `doc`. Segments arrive via `append`;
 * `document` reflects the residual doc for preview; `finish()` calls
 * `onComplete` with the final doc (one history entry). (`go` simplified)
 */
function createErasure(
	doc: SketchDoc,
	opts: {
		width: number;
		viewportScale: number;
		allocateObjectId: () => string;
		onPreview: () => void;
		onComplete: (doc: SketchDoc) => void;
	},
): ErasureSession {
	const r = opts.width / 2;
	const scale = opts.viewportScale > 0 ? opts.viewportScale : 1;
	const deleted = new Set<string>();
	const parts = new Map<string, ErasePartState>();
	const pendingPoints: SketchPoint[] = [];
	const segments: EraserSegment[] = [];
	let consumedPoints = 0;
	let consumedSegments = 0;
	let released = false;
	let cancelled = false;
	let finished = false;
	let previewDirty = false;
	let preview: SketchDoc = doc;

	const partKey = (id: string, index: number) => `${id}#${index}`;

	/** Lazily explode an object into cuttable runs. */
	function ensureParts(item: SketchItem): ErasePartState | null {
		let state = parts.get(item.id);
		if (state != null) return state;
		const runs = outlinePolylines(item);
		if (runs.length === 0) return null;
		state = { changed: false, runs: runs.map((run) => run.slice()) };
		parts.set(item.id, state);
		return state;
	}

	/** Cut every run overlapping the new segments. */
	function applySegments(batch: EraserSegment[]) {
		if (batch.length === 0) return;
		const bounds = pointsBounds(
			batch.flatMap((s) => [s.from, s.to]),
		);
		if (bounds == null) return;
		const area = inflateBounds(bounds, r);
		for (const item of doc.objects) {
			if (deleted.has(item.id)) continue;
			const ob = drawingBounds(item);
			if (ob == null || boundsIntersect(ob, area) == null) continue;
			if (item.kind === "text") {
				if (eraserHitsText(item, batch, r)) {
					deleted.add(item.id);
					previewDirty = true;
				}
				continue;
			}
			const state = ensureParts(item);
			if (state == null) continue;
			// Touch only runs whose bounds intersect the batch area.
			const nextRuns: SketchPoint[][] = [];
			let changed = false;
			for (const run of state.runs) {
				const rb = pointsBounds(run, item.style.width / 2);
				if (rb == null || boundsIntersect(rb, area) == null) {
					nextRuns.push(run);
					continue;
				}
				const residual = cutPolyline(run, batch, r);
				if (residual.length !== 1 || residual[0] !== run) changed = true;
				nextRuns.push(...residual);
			}
			if (changed) {
				state.runs = nextRuns;
				state.changed = true;
				previewDirty = true;
			}
		}
	}

	/** Residual document for the current cut state. */
	function residualDocument(): SketchDoc {
		const objects: SketchItem[] = [];
		for (const item of doc.objects) {
			if (deleted.has(item.id)) continue;
			const state = parts.get(item.id);
			if (state == null || !state.changed) {
				objects.push(item);
				continue;
			}
			let index = 0;
			for (const run of state.runs) {
				const ink: SketchItem = {
					kind: "ink",
					id: index === 0 ? item.id : partKey(item.id, index),
					points: run,
					style: { ...item.style },
				};
				objects.push(ink);
				index += 1;
			}
		}
		return { schemaVersion: 1, objects };
	}

	/** Fragment discard: tiny ink runs are dropped at finish. (`j`) */
	function keepFragment(points: SketchPoint[], width: number): boolean {
		const b = pointsBounds(points);
		if (b == null) return false;
		let length = 0;
		for (let i = 1; i < points.length; i += 1) {
			const a = points[i - 1];
			const c = points[i];
			if (a != null && c != null) length += dist(a, c);
		}
		if (points.length === 1) length = width;
		const approxArea = length * Math.max(width, 1);
		return !(
			approxArea < ERASURE_FRAGMENT_MIN_AREA &&
			Math.max(b.width, b.height) * scale < ERASURE_FRAGMENT_MIN_SIZE
		);
	}

	/** Final residual doc with real allocated ids and fragment cleanup. (`A`) */
	function finalDocument(): SketchDoc {
		const objects: SketchItem[] = [];
		for (const item of doc.objects) {
			if (deleted.has(item.id)) continue;
			const state = parts.get(item.id);
			if (state == null || !state.changed) {
				objects.push(item);
				continue;
			}
			let index = 0;
			for (const run of state.runs) {
				if (!keepFragment(run, item.style.width)) continue;
				const ink: SketchItem = {
					kind: "ink",
					id: index === 0 ? item.id : opts.allocateObjectId(),
					points: run,
					style: { ...item.style },
				};
				objects.push(ink);
				index += 1;
			}
		}
		return { schemaVersion: 1, objects };
	}

	function drain() {
		// New points: segment from previous relaxed point unless breakBefore.
		while (consumedPoints < pendingPoints.length) {
			const p = pendingPoints[consumedPoints];
			consumedPoints += 1;
			if (p == null) break;
			const prev = pendingPoints[consumedPoints - 2];
			if (consumedPoints >= 2 && prev != null && p.breakBefore !== true) {
				segments.push({ from: prev, to: p });
			} else {
				segments.push({ from: p, to: p }); // degenerate dot segment
			}
		}
		const batch = segments.slice(consumedSegments, consumedSegments + ERASURE_BATCH);
		// Apply all pending segments in batches; all are tiny so run synchronously.
		while (consumedSegments < segments.length) {
			const slice = segments.slice(consumedSegments, consumedSegments + ERASURE_BATCH);
			consumedSegments += slice.length;
			applySegments(slice);
		}
		if (previewDirty) {
			previewDirty = false;
			preview = residualDocument();
			opts.onPreview();
		}
		if (released && !finished) {
			finished = true;
			opts.onComplete(finalDocument());
		}
		void batch;
	}

	return {
		get released() {
			return released;
		},
		get document() {
			return preview;
		},
		append(points: SketchPoint[]) {
			if (released || cancelled || finished) return;
			pendingPoints.length = 0;
			pendingPoints.push(...points);
			// `append` receives the gesture's full point list; only the tail is new.
			while (consumedPoints < pendingPoints.length) {
				/* handled in drain */
				break;
			}
			drain();
		},
		finish() {
			if (released || cancelled || finished) return;
			released = true;
			drain();
		},
		cancel() {
			cancelled = true;
			parts.clear();
			segments.length = 0;
			pendingPoints.length = 0;
		},
	};
}

// ---------------------------------------------------------------------------
// Rendering (`Rn`/`zn`/`qn`/`Jn`/`tr`/`er`/`Kn`) + export (`bo`)
// ---------------------------------------------------------------------------

type Ctx2D = CanvasRenderingContext2D;

/** Draw one object. (`zn` minus comment/ink-coverage branches) */
export function renderSketchObject(ctx: Ctx2D, item: SketchItem): void {
	ctx.save();
	try {
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		if (item.kind !== "ink" && item.kind !== "text" && item.style.width <= 0)
			return;
		ctx.strokeStyle = item.style.color;
		ctx.fillStyle = item.style.color;
		ctx.lineWidth = item.style.width;
		if (
			item.kind !== "ink" &&
			item.kind !== "text" &&
			"bounds" in item &&
			item.bounds.width === 0 &&
			item.bounds.height === 0
		) {
			ctx.beginPath();
			ctx.arc(item.bounds.x, item.bounds.y, item.style.width / 2, 0, Math.PI * 2);
			ctx.fill();
			return;
		}
		switch (item.kind) {
			case "ink":
				drawPolyline(ctx, item.points, item.style.width);
				break;
			case "stroke": {
				const pts = smoothStrokePoints(item.points, item.style.width);
				if (pts.some((p) => p.pressure != null))
					for (const run of splitPointRuns(pts)) drawRibbon(ctx, run, item.style.width);
				else drawPolyline(ctx, pts, item.style.width);
				break;
			}
			case "line":
				drawSegment(ctx, item.from, item.to);
				break;
			case "arrow":
				drawSegment(ctx, item.from, arrowShaftEnd(item));
				drawArrowHead(ctx, item);
				break;
			case "rectangle": {
				const b = normalizeBounds(item.bounds);
				ctx.strokeRect(b.x, b.y, b.width, b.height);
				break;
			}
			case "ellipse": {
				const b = normalizeBounds(item.bounds);
				ctx.beginPath();
				ctx.ellipse(
					b.x + b.width / 2,
					b.y + b.height / 2,
					b.width / 2,
					b.height / 2,
					0,
					0,
					Math.PI * 2,
				);
				ctx.stroke();
				break;
			}
			case "triangle":
			case "diamond":
			case "star":
			case "heart":
				drawClosedPolygon(ctx, shapePoints(item.kind, item.bounds, item));
				break;
			case "text":
				drawText(ctx, item);
		}
	} finally {
		ctx.restore();
	}
}

/** Render a document: non-text first, text last. (`Rn`) */
export function renderSketchDocument(
	ctx: Ctx2D,
	doc: SketchDoc,
	opts?: { excludeIds?: Set<string>; replacement?: { objectId: string; object: SketchItem | SketchEraserPreview } },
): void {
	const objects = doc.objects.flatMap((o) =>
		o.id === opts?.replacement?.objectId
			? opts.replacement.object.kind === "eraser"
				? []
				: [opts.replacement.object]
			: opts?.excludeIds?.has(o.id)
				? []
				: [o],
	);
	for (const o of objects) if (o.kind !== "text") renderSketchObject(ctx, o);
	for (const o of objects) if (o.kind === "text") renderSketchObject(ctx, o);
}

/** Eraser trail drawn with destination-out for the live preview. (`Bn`) */
export function renderEraserTrail(
	ctx: Ctx2D,
	points: readonly SketchPoint[],
	width: number,
): void {
	if (width <= 0 || points.length === 0) return;
	const relaxed: SketchPoint[] = [];
	for (let i = 0; i < points.length; i += 1) {
		const p = relaxedPoint(points, i, width);
		if (p != null) relaxed.push(p);
	}
	ctx.save();
	try {
		ctx.globalCompositeOperation = "destination-out";
		ctx.strokeStyle = "#000000";
		ctx.fillStyle = "#000000";
		ctx.lineWidth = width;
		ctx.lineCap = "round";
		ctx.lineJoin = "round";
		drawPolyline(ctx, relaxed, width);
	} finally {
		ctx.restore();
	}
}

/** Plain polyline; single point → filled circle. (`qn`) */
function drawPolyline(ctx: Ctx2D, points: readonly SketchPoint[], width: number): void {
	if (points.length === 0) return;
	for (const run of splitPointRuns(points)) {
		const first = run[0];
		if (first == null) continue;
		if (run.length === 1) {
			ctx.beginPath();
			ctx.arc(first.x, first.y, width / 2, 0, Math.PI * 2);
			ctx.fill();
			continue;
		}
		ctx.beginPath();
		ctx.moveTo(first.x, first.y);
		for (let i = 1; i < run.length; i += 1) {
			const p = run[i];
			if (p != null) ctx.lineTo(p.x, p.y);
		}
		ctx.stroke();
	}
}

/** Variable-width ribbon + dots for pressure strokes. (`Jn`) */
function drawRibbon(ctx: Ctx2D, points: readonly SketchPoint[], width: number): void {
	const first = points[0];
	if (first == null) return;
	if (points.length === 1) {
		const r = pressureWidth(first, width) / 2;
		ctx.beginPath();
		ctx.arc(first.x, first.y, r, 0, Math.PI * 2);
		ctx.fill();
		return;
	}
	ctx.beginPath();
	for (let i = 1; i < points.length; i += 1) {
		const a = points[i - 1];
		const b = points[i];
		if (a == null || b == null) continue;
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const len = Math.hypot(dx, dy);
		if (len < 1e-4) continue;
		const nx = -dy / len;
		const ny = dx / len;
		const ra = pressureWidth(a, width) / 2;
		const rb = pressureWidth(b, width) / 2;
		ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
		ctx.lineTo(b.x + nx * rb, b.y + ny * rb);
		ctx.lineTo(b.x - nx * rb, b.y - ny * rb);
		ctx.lineTo(a.x - nx * ra, a.y - ny * ra);
		ctx.closePath();
	}
	ctx.fill();
	ctx.beginPath();
	for (const p of points) {
		const r = pressureWidth(p, width) / 2;
		ctx.moveTo(p.x + r, p.y);
		ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
	}
	ctx.fill();
}

function drawSegment(
	ctx: Ctx2D,
	a: { x: number; y: number },
	b: { x: number; y: number },
): void {
	ctx.beginPath();
	ctx.moveTo(a.x, a.y);
	ctx.lineTo(b.x, b.y);
	ctx.stroke();
}

function drawArrowHead(
	ctx: Ctx2D,
	arrow: { from: { x: number; y: number }; to: { x: number; y: number }; style: StrokeStyle },
): void {
	const { left, right } = arrowHead(arrow);
	ctx.beginPath();
	ctx.moveTo(arrow.to.x, arrow.to.y);
	ctx.lineTo(left.x, left.y);
	ctx.lineTo(right.x, right.y);
	ctx.closePath();
	ctx.fill();
}

function drawClosedPolygon(ctx: Ctx2D, points: readonly { x: number; y: number }[]): void {
	const first = points[0];
	if (first == null) return;
	ctx.beginPath();
	ctx.moveTo(first.x, first.y);
	for (let i = 1; i < points.length; i += 1) {
		const p = points[i];
		if (p != null) ctx.lineTo(p.x, p.y);
	}
	ctx.closePath();
	ctx.stroke();
}

/** Text: clip to bounds, render at 24px scaled, underline below baseline. (`Kn`) */
function drawText(ctx: Ctx2D, item: Extract<SketchItem, { kind: "text" }>): void {
	if (item.text.length === 0) return;
	const b = normalizeBounds(item.bounds);
	const fontSize = normalizeFontSize(item.style.width);
	ctx.beginPath();
	ctx.rect(b.x, b.y, b.width, b.height);
	ctx.clip();
	const scale = fontSize / TEXT_RENDER_SIZE;
	ctx.transform(scale, 0, 0, scale, b.x + TEXT_PADDING, b.y + TEXT_PADDING);
	ctx.font = `${item.format.italic ? "italic" : "normal"} ${item.format.bold ? "700" : "400"} ${TEXT_RENDER_SIZE}px ${TEXT_FONT_FAMILY}`;
	ctx.textAlign = "left";
	ctx.textBaseline = "alphabetic";
	const layout = layoutText({
		text: item.text,
		boxWidth: b.width,
		fontSize,
	});
	const lineHeight = layout.lineHeight / scale;
	// Baseline centers the line box under the ascent/descent split. (`Ct`)
	const ascent = TEXT_RENDER_SIZE * 0.8;
	const descent = TEXT_RENDER_SIZE * 0.2;
	const baseline = (lineHeight - ascent - descent) / 2 + ascent;
	layout.lines.forEach((line, i) => {
		const y = baseline + i * lineHeight;
		ctx.fillText(line, 0, y);
		if (item.format.underline && line.length > 0) {
			ctx.lineWidth = TEXT_RENDER_SIZE / 16;
			ctx.beginPath();
			const underline = y + TEXT_RENDER_SIZE * 0.1;
			ctx.moveTo(0, underline);
			ctx.lineTo(measureTextWidth(line, TEXT_RENDER_SIZE), underline);
			ctx.stroke();
		}
	});
}

function createCanvas(width: number, height: number): HTMLCanvasElement | null {
	if (typeof document === "undefined") return null;
	const canvas = document.createElement("canvas");
	if (typeof canvas.getContext !== "function") return null;
	canvas.width = Math.max(1, Math.ceil(width));
	canvas.height = Math.max(1, Math.ceil(height));
	return canvas;
}

/** Shared export pipeline: render doc → canvas. (`bo` minus blob emission) */
function renderExportCanvas(
	doc: SketchDoc,
	opts: {
		backgroundColor?: string;
		padding?: number;
		scale?: number;
		maxDimension?: number;
		maxPixelCount?: number;
	},
): { canvas: HTMLCanvasElement; width: number; height: number } | { kind: "empty" | "unavailable" } {
	const content = contentBounds(doc);
	if (content == null) return { kind: "empty" };
	const scale =
		isFiniteNumber(opts.scale) && opts.scale > 0 ? opts.scale : 1;
	const padding =
		isFiniteNumber(opts.padding) && opts.padding >= 0
			? opts.padding
			: EXPORT_DEFAULT_PADDING;
	const maxDim = Math.max(
		1,
		Math.floor(opts.maxDimension ?? EXPORT_MAX_DIMENSION),
	);
	const maxPixels = Math.max(
		1,
		Math.floor(opts.maxPixelCount ?? EXPORT_MAX_PIXELS),
	);
	const w = content.width + padding * 2;
	const h = content.height + padding * 2;
	const outW = Math.max(1, Math.ceil(w * scale));
	const outH = Math.max(1, Math.ceil(h * scale));
	const finalScale =
		scale *
		Math.min(
			1,
			maxDim / outW,
			maxDim / outH,
			Math.sqrt(maxPixels / (outW * outH)),
		);
	const width = Math.max(1, Math.ceil(w * finalScale));
	const height = Math.max(1, Math.ceil(h * finalScale));
	const canvas = createCanvas(width, height);
	const ctx = canvas?.getContext("2d");
	if (canvas == null || ctx == null) return { kind: "unavailable" };
	if (opts.backgroundColor != null) {
		ctx.fillStyle = opts.backgroundColor;
		ctx.fillRect(0, 0, width, height);
	}
	ctx.setTransform(
		finalScale,
		0,
		0,
		finalScale,
		(padding - content.x) * finalScale,
		(padding - content.y) * finalScale,
	);
	renderSketchDocument(ctx, doc);
	return { canvas, width, height };
}

/** `editor.export` backing: PNG render as a typed result. */
function exportPng(
	doc: SketchDoc,
	opts: {
		backgroundColor?: string;
		padding?: number;
		scale?: number;
		mimeType?: string;
	} = {},
): Promise<SketchExportResult> {
	const rendered = renderExportCanvas(doc, opts);
	if ("kind" in rendered) {
		return Promise.resolve(
			rendered.kind === "empty"
				? { kind: "empty" }
				: ({ kind: "unavailable" } as SketchExportResult),
		);
	}
	try {
		return Promise.resolve({
			kind: "success",
			dataUrl: rendered.canvas.toDataURL(opts.mimeType ?? "image/png"),
			width: rendered.width,
			height: rendered.height,
		});
	} catch {
		return Promise.resolve({ kind: "unavailable" });
	}
}

/**
 * Render the document to a PNG data URL. Content bounds (stroke-aware) get
 * `padding` around them; the result is capped at 2048px / 4MP by shrinking
 * the scale. Returns null when empty or canvas is unavailable. (`bo` core)
 */
export function exportToPng(
	doc: SketchDoc,
	opts: {
		backgroundColor?: string;
		padding?: number;
		scale?: number;
		maxDimension?: number;
		maxPixelCount?: number;
	} = {},
): Promise<string | null> {
	const rendered = renderExportCanvas(doc, opts);
	if ("kind" in rendered) return Promise.resolve(null);
	try {
		return Promise.resolve(rendered.canvas.toDataURL("image/png"));
	} catch {
		return Promise.resolve(null);
	}
}

// ---------------------------------------------------------------------------
// Editor store (`Ko`)
// ---------------------------------------------------------------------------

type GestureTool = ShapeKind | "pen" | "eraser";

interface DrawGesture {
	kind: "draw";
	pointerId: number;
	tool: GestureTool;
	id: string;
	start: SketchPoint;
	points: SketchPoint[];
	current: SketchPoint;
	viewportScale: number;
	style: StrokeStyle;
	shiftKey: boolean;
	pointerWasOutside: boolean;
	latestSampleTimestamp: number | null;
	surfaceBounds: Bounds | null;
	strokePressure: PressureState | null;
	erasure: ErasureSession | null;
}

interface MoveGesture {
	kind: "move";
	pointerId: number;
	objectId: string;
	originalObject: SketchItem;
	start: { x: number; y: number };
	current: { x: number; y: number };
	hasPointerMove: boolean;
	snapGuides: SnapGuide[];
	initialSnapOffsets: { x: number | null; y: number | null };
	releasedInitialSnapAxes: { x: boolean; y: boolean };
}

interface ResizeGesture {
	kind: "resize";
	pointerId: number;
	objectId: string;
	originalObject: SketchItem;
	handle: ResizeHandle;
	current: { x: number; y: number };
	pointerOffset: { x: number; y: number };
	hasPointerMove: boolean;
	surfaceBounds: Bounds | null;
}

type Gesture = DrawGesture | MoveGesture | ResizeGesture;

interface HistoryEntry {
	before: SketchDoc;
	after: SketchDoc;
	selectionBefore: string | null;
	selectionAfter: string | null;
	styleBefore: StrokeStyle;
	styleAfter: StrokeStyle;
	historyGroup?: string;
}

const emptyDoc = (): SketchDoc => ({ schemaVersion: 1, objects: [] });

const clampEraserSize = (v: number | undefined) =>
	clamp(
		v != null && Number.isFinite(v) ? v : ERASER_DEFAULT,
		ERASER_MIN,
		ERASER_MAX,
	);
const clampDrawingWidth = (v: number) =>
	clamp(
		Number.isFinite(v) ? v : DRAWING_WIDTH_MIN,
		DRAWING_WIDTH_MIN,
		DRAWING_WIDTH_MAX,
	);
const clampStyleWidth = (style: StrokeStyle): StrokeStyle => ({
	...style,
	width: Math.min(STYLE_WIDTH_MAX, Math.max(STYLE_WIDTH_MIN, style.width)),
});
const clampTextSize = (v: number) =>
	clamp(
		Number.isFinite(v) ? v : TEXT_SIZE_DEFAULT,
		TEXT_SIZE_MIN,
		TEXT_SIZE_MAX,
	);

/** Style normalization for drawing tools. (`Ge`+`Jo`) */
function normalizeStyle(
	partial: Partial<StrokeStyle> | undefined,
	fallback: StrokeStyle = DEFAULT_STYLE,
): StrokeStyle {
	const color =
		typeof partial?.color === "string" && partial.color.trim().length > 0
			? partial.color
			: fallback.color;
	const width = isFiniteNumber(partial?.width)
			? partial.width
			: fallback.width;
	return { color, width: width > 0 ? width : 1 };
}

/** Text style: width is the font size (uncapped, normalized to 24). (`cn`) */
function normalizeTextStyle(partial: Partial<StrokeStyle>): StrokeStyle {
	return { ...normalizeStyle(partial), width: normalizeFontSize(partial.width ?? NaN) };
}

const normalizeFormat = (f?: Partial<TextFormat>): TextFormat => ({
	bold: f?.bold === true,
	italic: f?.italic === true,
	underline: f?.underline === true,
});

const sameFormat = (a: TextFormat, b: TextFormat) =>
	a.bold === b.bold && a.italic === b.italic && a.underline === b.underline;

/** Object equality for mutation short-circuits. (`Zo`) */
function sameItem(a: SketchItem, b: SketchItem): boolean {
	return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Id allocator producing `sketch-object-N`. (`Gt`) */
function createIdAllocator(existing: string[], prefix = "sketch-object") {
	const used = new Set<string>();
	let next = 1;
	const reserve = (ids: string[]) => {
		for (const id of ids) used.add(id);
	};
	reserve(existing);
	return {
		reserve,
		allocate(): string {
			let id: string;
			do {
				id = `${prefix}-${next}`;
				next += 1;
			} while (used.has(id));
			used.add(id);
			return id;
		},
	};
}

/**
 * Create the sketch editor store. Port of the reference `Ko` factory; see
 * SPEC.md for the frozen contract. Synchronous: erasure cutting runs inline.
 */
export function createSketchEditor(init: {
	document?: SketchDoc;
	tool?: SketchTool | ShapeKind;
	style?: Partial<StrokeStyle>;
	eraserSizePx?: number;
	drawingWidthPx?: number;
	textSizePx?: number;
} = {}): SketchEditor {
	const initTool = init.tool ?? "pen";
	const isShapeInit = (initTool as string) !== "shapes" && isDrawableShapeTool(initTool);
	let doc = init.document ?? emptyDoc();
	let tool: SketchTool = isShapeInit
		? "shapes"
		: isDrawableShapeTool(initTool)
			? "shapes"
			: (initTool as SketchTool);
	let shapeKind: ShapeKind = isDrawableShapeTool(initTool)
		? (initTool as ShapeKind)
		: "line";
	let eraserSize = clampEraserSize(init.eraserSizePx);
	let drawingWidth =
		init.drawingWidthPx == null ? undefined : clampDrawingWidth(init.drawingWidthPx);
	let textSize = init.textSizePx == null ? undefined : clampTextSize(init.textSizePx);
	// Separate style memories for drawing tools vs. text (`f`/`p`/`m`).
	let drawStyle = clampStyleWidth(
		normalizeStyle({ ...DEFAULT_STYLE, color: "#ffffff", ...init.style }),
	);
	let textStyle: StrokeStyle = normalizeTextStyle({
		...init.style,
		width: init.textSizePx ?? init.style?.width,
	});
	let style: StrokeStyle = tool === "text" ? textStyle : drawStyle;
	let format: TextFormat = { ...DEFAULT_FORMAT };
	let selectionId: string | null = null;
	const undoStack: HistoryEntry[] = [];
	let historyIndex = -1;
	let gesture: Gesture | null = null;
	let releasedErasureUndone = false;
	let textEdit: { input: SketchTextEdit; objectId: string | null } | null = null;
	let surfaceBounds: Bounds | null = null;
	let hoverInput: {
		point: { x: number; y: number };
		viewportScale: number;
		tolerance: number;
		handleTolerance: number;
	} | null = null;
	const listeners = new Set<() => void>();
	let batchDepth = 0;
	let batchDirty = false;
	let snapshot = makeSnapshot();
	const ids = createIdAllocator(doc.objects.map((o) => o.id));

	// -- internal helpers -----------------------------------------------------

	const isReleasedErasure = () =>
		gesture?.kind === "draw" && gesture.erasure?.released === true;

	/** Cancel the active gesture; returns true when something was cancelled. (`J`) */
	function cancelGesture(): boolean {
		if (gesture == null) return false;
		const g = gesture;
		gesture = null;
		releasedErasureUndone = false;
		if (g.kind === "draw") g.erasure?.cancel();
		return true;
	}

	const allocateId = () => ids.allocate();

	/** Adopt `style` into the right tool memory. (`I`) */
	function adoptStyle(
		partial: Partial<StrokeStyle>,
		mode: "text" | "drawing",
	): StrokeStyle {
		if (mode === "text") {
			const next = normalizeTextStyle(partial);
			textStyle = { ...next, width: clampTextSize(next.width) };
			drawStyle = { ...drawStyle, color: next.color };
			return next;
		}
		const next = normalizeStyle(partial);
		drawStyle = clampStyleWidth(next);
		textStyle = { ...textStyle, color: next.color };
		return next;
	}

	const modeFor = (item: SketchItem | null): "text" | "drawing" =>
		item?.kind === "text" || (item == null && tool === "text")
			? "text"
			: "drawing";

	/** Restore `style` to the active tool's remembered style. (`R`) */
	function restoreToolStyle(t: SketchTool = tool) {
		style = t === "text" ? textStyle : drawStyle;
	}

	function selectedItem(): SketchItem | null {
		return selectionId == null
			? null
			: (doc.objects.find((o) => o.id === selectionId) ?? null);
	}

	function isSelectable(item: SketchItem | null | undefined): item is SketchItem {
		return item != null;
	}

	/** Adopt an object's style (+ format for text) on selection. (`ee`) */
	function adoptObjectStyle(item: SketchItem, from?: StrokeStyle) {
		if ("style" in item) {
			style = adoptStyle(from ?? item.style, modeFor(item));
		}
		if (item.kind === "text") format = normalizeFormat(item.format);
	}

	function clearSelectionInternal() {
		selectionId = null;
		restoreToolStyle();
	}

	/** Switch tools, accepting a `ShapeKind` directly as `shapes`. (`Ve` call site) */
	function applyToolSwitch(next: SketchTool | ShapeKind) {
		const asShape = isDrawableShapeTool(next as string);
		const nextTool: SketchTool = asShape ? "shapes" : (next as SketchTool);
		const kindChanged = asShape && shapeKind !== (next as ShapeKind);
		const cancelled = !isReleasedErasure() && cancelGesture();
		if (asShape) shapeKind = next as ShapeKind;
		if (tool === nextTool) {
			if (cancelled || kindChanged) notify();
			return;
		}
		if (nextTool === "text") {
			style = { ...textStyle, color: style.color };
			textStyle = style;
		} else if (nextTool === "select") {
			if (selectionId == null) restoreToolStyle(nextTool);
		} else {
			style = { ...drawStyle, color: style.color };
			drawStyle = style;
		}
		tool = nextTool;
		if (nextTool !== "select") selectionId = null;
		notify();
	}

	function clearTextEditState() {
		textEdit = null;
		if (textSize != null) textSize = clampTextSize(textSize);
		if (selectionId == null && tool === "text") restoreToolStyle();
	}

	function makeSnapshot(): SketchSnapshot {
		return {
			document: doc,
			effectiveDocument: effectiveDoc(),
			hasPendingTextEdit: textEdit != null,
			activeTool: tool,
			shapeKind,
			eraserSizePx: eraserSize,
			drawingWidthPx: drawingWidth ?? null,
			textSizePx: textSize ?? null,
			style,
			textFormat: format,
			selectionId,
			canUndo: !releasedErasureUndone && (gesture != null || historyIndex >= 0),
			canRedo:
				releasedErasureUndone ||
				(gesture == null && historyIndex < undoStack.length - 1),
			hasActiveGesture: gesture != null,
			erasurePreview:
				!releasedErasureUndone && gesture?.kind === "draw"
					? (gesture.erasure ? gesture.erasure.document : null)
					: null,
			preview: releasedErasureUndone ? null : gesturePreview(),
			snapGuides: gesture?.kind === "move" ? gesture.snapGuides : [],
			cursor: computeCursor(),
		};
	}

	/** Live preview object for the active gesture. (`Kt`) */
	function gesturePreview(): PreviewInfo | null {
		const g = gesture;
		if (g == null) return null;
		if (g.kind === "move") {
			return {
				object: translateItem(g.originalObject, {
					x: g.current.x - g.start.x,
					y: g.current.y - g.start.y,
				}),
				replaceObjectId: g.objectId,
				transformKind: g.hasPointerMove ? "move" : undefined,
			};
		}
		if (g.kind === "resize") {
			return {
				object: g.hasPointerMove
					? resizeObject(
							g.originalObject,
							g.handle,
							{
								x: g.current.x - g.pointerOffset.x,
								y: g.current.y - g.pointerOffset.y,
							},
							g.surfaceBounds,
						)
					: g.originalObject,
				replaceObjectId: g.objectId,
				transformKind: g.hasPointerMove ? "resize" : undefined,
			};
		}
		// draw gesture
		if (g.tool === "pen") {
			return {
				object: {
					id: g.id,
					kind: "stroke",
					points:
						g.points.length === 1 && g.strokePressure?.source === "speed"
							? g.points.map((p) => ({ ...p, pressure: 1 }))
							: g.points,
					style: g.style,
				},
				replaceObjectId: null,
				transformKind: undefined,
			};
		}
		if (g.tool === "eraser") {
			return {
				object: {
					id: g.id,
					kind: "eraser",
					points: g.points,
					width: g.style.width,
				},
				replaceObjectId: null,
				transformKind: undefined,
			};
		}
		return shapePreviewObject(g);
	}

	/** Preview/commit object for a shape draw gesture. (`Kt` shape branch) */
	function shapePreviewObject(g: DrawGesture): PreviewInfo | null {
		const kind = g.tool as ShapeKind;
		if (g.surfaceBounds != null) {
			const sb = normalizeBounds(g.surfaceBounds);
			if (g.style.width > sb.width || g.style.width > sb.height) return null;
		}
		const inset = insetBounds(g.surfaceBounds, g.style.width);
		const start = clampPointToBounds(g.start, inset);
		if (kind === "arrow") {
			const rawEnd = clampPointToBounds(
				{
					x: g.current.x + (start.x - g.start.x),
					y: g.current.y + (start.y - g.start.y),
				},
				g.surfaceBounds,
			);
			const end = g.shiftKey
				? constrainEndpoint(start, rawEnd, "arrow", g.surfaceBounds)
				: rawEnd;
			const clamped = clampArrowToSurface(
				{ id: g.id, kind: "arrow", from: start, to: end, style: g.style },
				g.surfaceBounds,
			);
			return clamped == null
				? null
				: { object: clamped, replaceObjectId: null, transformKind: undefined };
		}
		const rawEnd = clampPointToBounds(g.current, inset);
		const end = g.shiftKey
			? constrainEndpoint(start, rawEnd, kind, inset)
			: rawEnd;
		if (kind === "line") {
			return {
				object: { id: g.id, kind: "line", from: start, to: end, style: g.style },
				replaceObjectId: null,
				transformKind: undefined,
			};
		}
		return {
			object: {
				id: g.id,
				kind,
				bounds: shapeBoundsFromTarget({ kind }, boundsFromPoints(start, end)),
				style: g.style,
			},
			replaceObjectId: null,
			transformKind: undefined,
		};
	}

	/** Shrink/translate an arrow so its drawing bounds fit the surface. (`qt`) */
	function clampArrowToSurface(
		arrow: Extract<SketchItem, { kind: "arrow" }>,
		surface: Bounds | null,
	): SketchItem | null {
		if (surface == null) return arrow;
		const s = normalizeBounds(surface);
		if (arrow.style.width > s.width || arrow.style.width > s.height)
			return null;
		let b = drawingBounds(arrow);
		if (b == null) return arrow;
		let out = arrow;
		if (b.width > s.width || b.height > s.height) {
			out = { ...arrow, to: { ...arrow.from } };
			b = drawingBounds(out) ?? b;
			let lo = 0;
			let hi = 1;
			for (let i = 0; i < 16; i += 1) {
				const t = (lo + hi) / 2;
				const candidate: SketchItem = {
					...arrow,
					to: {
						x: lerp(arrow.from.x, arrow.to.x, t),
						y: lerp(arrow.from.y, arrow.to.y, t),
					},
				};
				const cb = drawingBounds(candidate);
				if (cb != null && cb.width <= s.width && cb.height <= s.height) {
					lo = t;
					out = candidate;
					b = cb;
				} else {
					hi = t;
				}
			}
		}
		const dx = clamp(b.x, s.x, s.x + s.width - b.width) - b.x;
		const dy = clamp(b.y, s.y, s.y + s.height - b.height) - b.y;
		return dx === 0 && dy === 0
			? out
			: { ...out, from: translatePoint(out.from, { x: dx, y: dy }), to: translatePoint(out.to, { x: dx, y: dy }) };
	}

	function notify() {
		if (batchDepth > 0) {
			batchDirty = true;
			return;
		}
		snapshot = makeSnapshot();
		for (const fn of Array.from(listeners)) fn();
	}

	/** Push history entry; identical-group merge. (`ne`) */
	function commitDoc(
		next: SketchDoc,
		select: string | null | undefined = selectionId,
		opts: {
			historyGroup?: string;
			styleBefore?: StrokeStyle;
			apply?: boolean;
		} = {},
	): boolean {
		cancelGesture();
		if (next === doc) {
			notify();
			return false;
		}
		const sel = select ?? null;
		const top = undoStack[historyIndex];
		const group = opts.historyGroup;
		if (
			group != null &&
			historyIndex === undoStack.length - 1 &&
			top?.historyGroup === group
		) {
			undoStack[historyIndex] = {
				...top,
				after: next,
				selectionAfter: sel,
				styleAfter: style,
			};
		} else {
			const entry: HistoryEntry = {
				before: doc,
				after: next,
				selectionBefore: selectionId,
				selectionAfter: sel,
				styleBefore: opts.styleBefore ?? style,
				styleAfter: style,
				historyGroup: group,
			};
			undoStack.length = historyIndex + 1;
			undoStack.push(entry);
			historyIndex += 1;
		}
		if (opts.apply === false) {
			historyIndex -= 1;
		} else {
			doc = next;
			selectionId = sel;
		}
		notify();
		return true;
	}

	/** Replace one object in the document. (`oe`) */
	function updateItem(id: string, fn: (item: SketchItem) => SketchItem): SketchDoc {
		const index = doc.objects.findIndex((o) => o.id === id);
		if (index < 0) return doc;
		const item = doc.objects[index];
		if (item == null) return doc;
		const next = fn(item);
		if (sameItem(item, next)) return doc;
		const objects = [...doc.objects];
		objects[index] = next;
		return { schemaVersion: 1, objects };
	}

	/** Document with the pending text edit folded in. (`Y`) */
	function effectiveDoc(): SketchDoc {
		const edit = textEdit;
		if (edit == null) return doc;
		const previewObject = textEditObject(edit);
		if (edit.input.objectId == null)
			return previewObject == null
				? doc
				: { schemaVersion: 1, objects: [...doc.objects, previewObject] };
		const index = doc.objects.findIndex(
			(o) => o.id === edit.input.objectId && o.kind === "text",
		);
		if (index < 0) return doc;
		if (previewObject == null)
			return {
				schemaVersion: 1,
				objects: doc.objects.filter((_, i) => i !== index),
			};
		const existing = doc.objects[index];
		if (existing == null || sameItem(existing, previewObject)) return doc;
		const objects = [...doc.objects];
		objects[index] = previewObject;
		return { schemaVersion: 1, objects };
	}

	/** Build the text object for a pending edit (null = empty text). (`se`) */
	function textEditObject(
		edit: { input: SketchTextEdit; objectId: string | null },
	): Extract<SketchItem, { kind: "text" }> | null {
		const input = edit.input;
		const existing =
			input.objectId == null
				? null
				: (doc.objects.find(
						(o) => o.id === input.objectId && o.kind === "text",
					) ?? null);
		if (input.objectId != null && existing?.kind !== "text") return null;
		const text = normalizeLineEndings(input.text);
		if (text.length === 0) return null;
		const base = existing?.kind === "text" ? existing : null;
		return normalizeTextObject({
			...(base ?? {}),
			id: edit.objectId ?? input.objectId ?? "",
			kind: "text",
			text,
			bounds: input.bounds,
			style: normalizeTextStyle({ ...(base?.style ?? style), ...input.style }),
			format: normalizeFormat({ ...(base?.format ?? format), ...input.format }),
		} as Extract<SketchItem, { kind: "text" }>);
	}

	/** Keep the pending text object's bounds inside the surface. (`un` lite) */
	function clampTextToSurface(
		item: Extract<SketchItem, { kind: "text" }>,
		surface: Bounds | null,
	): Extract<SketchItem, { kind: "text" }> {
		if (surface == null) return item;
		const limit = normalizeBounds(surface);
		const minW = Math.min(
			textMinimumWidth({
				text: item.text,
				fontSize: item.style.width,
				format: item.format,
			}),
			limit.width,
		);
		const right = limit.x + limit.width;
		const bottom = limit.y + limit.height;
		const x = clamp(item.bounds.x, limit.x, right - minW);
		const width = clamp(item.bounds.width, minW, right - x);
		const minH = Math.min(
			item.style.width * TEXT_LINE_HEIGHT_RATIO + TEXT_PADDING * 2,
			limit.height,
		);
		const y = clamp(item.bounds.y, limit.y, bottom - minH);
		const maxH = Math.max(bottom - y, 0);
		const relaid = normalizeTextObject({
			...item,
			bounds: { ...item.bounds, x, y, width },
		});
		const height = Math.min(relaid.bounds.height, maxH);
		return x === relaid.bounds.x &&
			y === relaid.bounds.y &&
			width === relaid.bounds.width &&
			height === relaid.bounds.height
			? relaid
			: { ...relaid, bounds: { ...relaid.bounds, x, y, width, height } };
	}

	const normalizeTextForSurface = (
		item: Extract<SketchItem, { kind: "text" }>,
	) => clampTextToSurface(item, surfaceBounds);

	// -- gestures ---------------------------------------------------------------

	function sampleTimestamp(s: PointerSample): number | null {
		return s.timestamp != null && Number.isFinite(s.timestamp) ? s.timestamp : null;
	}

	function hoverFrom(s: PointerSample) {
		return {
			point: s.point,
			viewportScale: s.viewportScale,
			tolerance: s.tolerance,
			handleTolerance:
				s.handleTolerance ??
				(s.pointerType === "touch"
					? HANDLE_TOLERANCE_TOUCH
					: HANDLE_TOLERANCE_MOUSE),
		};
	}

	/** pointerdown → which gesture to start for select tool. (`Xt`) */
	function hitIntent(input: {
		point: { x: number; y: number };
		tolerance: number;
		handleTolerance: number;
	}):
		| { kind: "move"; object: SketchItem }
		| { kind: "resize"; object: SketchItem; handle: ResizeHandle; pointerOffset: { x: number; y: number } }
		| { kind: "clear" } {
		const selected =
			selectionId == null
				? null
				: (doc.objects.find((o) => o.id === selectionId) ?? null);
		const handle =
			selected == null
				? null
				: pickHandle(selected, input.point, input.handleTolerance, {
						minimumSideHandleSpacing: SIDE_HANDLE_MIN_SPACING,
						minimumCornerHandleSpacing: CORNER_HANDLE_MIN_SPACING,
					});
		if (selected != null && handle != null) {
			const hp = handlePoint(selected, handle);
			return {
				kind: "resize",
				object: selected,
				handle,
				pointerOffset:
					hp == null
						? { x: 0, y: 0 }
						: { x: input.point.x - hp.x, y: input.point.y - hp.y },
			};
		}
		if (selected != null && grabHit(selected, input.point, input.tolerance))
			return { kind: "move", object: selected };
		const hit = hitTestDocument(doc, input.point, input.tolerance);
		return hit == null ? { kind: "clear" } : { kind: "move", object: hit };
	}

	function startMoveGesture(item: SketchItem, s: PointerSample): MoveGesture {
		const snapTol = s.snapTolerance ?? SNAP_TOLERANCE;
		return {
			kind: "move",
			pointerId: s.pointerId,
			objectId: item.id,
			originalObject: item,
			start: s.point,
			current: s.point,
			hasPointerMove: false,
			snapGuides: [],
			initialSnapOffsets: initialSnapOffsets(doc, item, snapTol),
			releasedInitialSnapAxes: { x: false, y: false },
		};
	}

	/** pointerDown (`me`) */
	function pointerDown(s: PointerSample): boolean {
		if (gesture != null) return false;
		hoverInput = hoverFrom(s);
		const surface = s.surfaceBounds ?? surfaceBounds;
		if (tool === "text") return false;
		if (tool !== "select") {
			const scale =
				s.viewportScale != null && Number.isFinite(s.viewportScale) && s.viewportScale > 0
					? s.viewportScale
					: 1;
			const clamped = clampPointToBounds({ ...s.point }, surface == null ? null : normalizeBounds(surface));
			const initP = tool === "pen" ? initialPressure(s) : null;
			const startPoint = tool === "pen" ? withPressure(clamped, initP?.pressure ?? null) : clamped;
			const drawTool: GestureTool = tool === "shapes" ? shapeKind : tool;
			const g: DrawGesture = {
				kind: "draw",
				pointerId: s.pointerId,
				tool: drawTool,
				id: allocateId(),
				start: startPoint,
				points: [startPoint],
				current: startPoint,
				viewportScale: scale,
				style:
					drawTool === "eraser"
						? { ...style, width: eraserSize / scale }
						: drawingWidth == null
							? clampStyleWidth(style)
							: { ...style, width: drawingWidth / scale },
				shiftKey: s.shiftKey === true,
				pointerWasOutside: false,
				latestSampleTimestamp: sampleTimestamp(s),
				surfaceBounds: surface == null ? null : normalizeBounds(surface),
				strokePressure: initP,
				erasure: null,
			};
			gesture = g;
			if (drawTool === "eraser") {
				const base = doc;
				g.erasure = createErasure(base, {
					width: g.style.width,
					viewportScale: scale,
					allocateObjectId: allocateId,
					onPreview() {
						if (gesture === g && g.erasure != null && doc === base) notify();
					},
					onComplete(next) {
						if (gesture !== g || g.erasure == null || doc !== base) return;
						commitDoc(next, null, { apply: !releasedErasureUndone });
						if (isReleasedErasure()) return;
						cancelGesture();
					},
				});
				g.erasure.append(g.points);
			}
			clearSelectionInternal();
			notify();
			return true;
		}
		// select tool
		const intent = hitIntent({
			point: s.point,
			tolerance: s.tolerance,
			handleTolerance: s.handleTolerance,
		});
		if (intent.kind === "resize") {
			gesture = {
				kind: "resize",
				pointerId: s.pointerId,
				objectId: intent.object.id,
				originalObject: intent.object,
				handle: intent.handle,
				current: s.point,
				pointerOffset: intent.pointerOffset,
				hasPointerMove: false,
				surfaceBounds: surface == null ? null : normalizeBounds(surface),
			};
			notify();
			return true;
		}
		if (intent.kind === "move") {
			if (selectionId !== intent.object.id) {
				adoptObjectStyle(intent.object);
				selectionId = intent.object.id;
			}
			gesture = startMoveGesture(intent.object, s);
			notify();
			return true;
		}
		clearSelectionInternal();
		notify();
		return true;
	}

	/** pointerMove (`fe`) */
	function pointerMove(s: PointerSample): boolean {
		hoverInput = hoverFrom(s);
		if (gesture == null) {
			if (computeCursor() !== snapshot.cursor) notify();
			return false;
		}
		const g = gesture;
		if (g.pointerId !== s.pointerId) return false;
		if (
			g.kind !== "draw" &&
			!g.hasPointerMove &&
			dist(g.current, s.point) <= s.tolerance * 0.2
		)
			return true;
		if (g.kind === "draw") {
			if (g.erasure?.released === true) return true;
			const ts = sampleTimestamp(s);
			if (ts != null && g.latestSampleTimestamp != null && ts < g.latestSampleTimestamp)
				return true;
			if (ts != null) g.latestSampleTimestamp = ts;
			const surface = s.surfaceBounds ?? g.surfaceBounds;
			g.surfaceBounds = surface;
			const isPenOrEraser = g.tool === "pen" || g.tool === "eraser";
			if (isPenOrEraser && surface != null && !pointInBounds(surface, s.point)) {
				g.pointerWasOutside = true;
				return true;
			}
			const clamped = clampPointToBounds(
				{ x: s.point.x, y: s.point.y },
				surface == null ? null : normalizeBounds(surface),
			);
			const reentered = isPenOrEraser && g.pointerWasOutside;
			let sample: SketchPoint = { ...clamped };
			if (g.tool === "pen" && g.strokePressure != null) {
				const next = reentered
					? (initialPressure(s) ?? g.strokePressure)
					: nextPressure(g.strokePressure, s, g.style.width * g.viewportScale);
				g.strokePressure = next;
				sample = withPressure(sample, next.pressure);
			}
			g.current = sample;
			g.shiftKey = s.shiftKey === true;
			if (reentered) {
				g.points.push({ ...sample, breakBefore: true });
				g.pointerWasOutside = false;
			} else {
				const last = g.points[g.points.length - 1];
				if (last == null) g.points.push(sample);
				else if (dist(last, sample) >= MIN_SAMPLE_DISTANCE / g.viewportScale) {
					if (
						g.tool === "pen" &&
						g.points.length === 1 &&
						g.strokePressure?.source === "speed"
					)
						g.points[0] = withPressure(last, sample.pressure ?? null);
					g.points.push(sample);
				} else if (
					g.tool === "pen" &&
					sample.pressure != null &&
					sample.pressure !== last.pressure
				)
					g.points[g.points.length - 1] = { ...last, pressure: sample.pressure };
				else if (g.tool === "eraser") return true;
			}
			g.erasure?.append(g.points);
		} else if (g.kind === "move") {
			const surface = s.surfaceBounds ?? surfaceBounds;
			const delta = { x: s.point.x - g.start.x, y: s.point.y - g.start.y };
			g.hasPointerMove = true;
			const snapTol = s.snapTolerance ?? SNAP_TOLERANCE;
			const clampedDelta = clampMoveDelta(
				g.originalObject,
				delta,
				surface == null ? null : normalizeBounds(surface),
			);
			g.releasedInitialSnapAxes = {
				x:
					g.releasedInitialSnapAxes.x ||
					(g.initialSnapOffsets.x != null &&
						Math.abs(clampedDelta.x - g.initialSnapOffsets.x) > snapTol),
				y:
					g.releasedInitialSnapAxes.y ||
					(g.initialSnapOffsets.y != null &&
						Math.abs(clampedDelta.y - g.initialSnapOffsets.y) > snapTol),
			};
			const snapped =
				g.originalObject.kind === "text" && s.altKey !== true
					? snapTextMove({
							doc,
							object: g.originalObject,
							delta: clampedDelta,
							tolerance: snapTol,
							suppressAxes: {
								x:
									g.initialSnapOffsets.x != null &&
									!g.releasedInitialSnapAxes.x,
								y:
									g.initialSnapOffsets.y != null &&
									!g.releasedInitialSnapAxes.y,
							},
						})
					: { delta: clampedDelta, guides: [] };
			const finalDelta = clampMoveDelta(
				g.originalObject,
				snapped.delta,
				surface == null ? null : normalizeBounds(surface),
			);
			g.current = translatePoint(g.start, finalDelta);
			g.snapGuides = filterGuides(snapped.guides, snapped.delta, finalDelta);
		} else {
			g.current = s.point;
			g.hasPointerMove = true;
			g.surfaceBounds = s.surfaceBounds ?? g.surfaceBounds;
		}
		notify();
		return true;
	}

	/** Commit the active gesture. (`de`) */
	function commitGesture(): boolean {
		const g = gesture;
		if (g == null) return false;
		if (g.kind === "draw" && g.erasure != null) {
			if (!g.erasure.released) {
				g.erasure.finish();
				notify();
			}
			return true;
		}
		if (g.kind === "resize" && !g.hasPointerMove) {
			cancelGesture();
			notify();
			return true;
		}
		const preview = gesturePreview();
		if (preview == null) {
			cancelGesture();
			notify();
			return true;
		}
		if (g.kind === "draw") {
			const obj = preview.object;
			if (obj.kind === "eraser") {
				cancelGesture();
				notify();
				return true;
			}
			if (isDrawableShapeTool(g.tool) && !meetsMinSize(obj, SHAPE_MIN_SIZE / g.viewportScale)) {
				cancelGesture();
				notify();
				return true;
			}
			const newSelection = isDrawableShapeTool(g.tool) ? obj.id : null;
			const styleBefore = style;
			if (newSelection != null) {
				tool = "select";
				adoptObjectStyle(obj);
			}
			return commitDoc(
				{ schemaVersion: 1, objects: [...doc.objects, obj] },
				newSelection,
				{ styleBefore },
			);
		}
		// move/resize commit: replace the object.
		const next = updateItem(g.objectId, () => preview.object as SketchItem);
		const styleBefore = style;
		if ("style" in preview.object) style = adoptStyle(preview.object.style as StrokeStyle, modeFor(preview.object as SketchItem));
		return commitDoc(next, g.objectId, { styleBefore });
	}

	function pointerUp(s: PointerSample): boolean {
		if (gesture == null || gesture.pointerId !== s.pointerId) return false;
		const g = gesture;
		let feedMove = true;
		if (
			(g.kind === "move" || g.kind === "resize") &&
			(g.hasPointerMove || dist(g.current, s.point) <= s.tolerance * 0.2)
		)
			feedMove = false;
		if (feedMove) pointerMove(s);
		return commitGesture();
	}

	// -- cursor (`Zt`/`Qt`) ------------------------------------------------------

	function cursorForHandle(handle: ResizeHandle): string {
		switch (handle) {
			case "n":
			case "s":
				return "ns-resize";
			case "e":
			case "w":
				return "ew-resize";
			case "ne":
			case "sw":
				return "nesw-resize";
			case "nw":
			case "se":
				return "nwse-resize";
			case "start":
			case "end":
				return "crosshair";
		}
	}

	function computeCursor(): string {
		const g = gesture;
		if (g?.kind === "move") return "grabbing";
		if (g?.kind === "resize")
			return cursorForHandle(
				effectiveHandle(g.originalObject, g.handle, {
					x: g.current.x - g.pointerOffset.x,
					y: g.current.y - g.pointerOffset.y,
				}),
			);
		if (g?.kind === "draw") return g.tool === "eraser" ? "cell" : "crosshair";
		if (tool !== "select")
			return tool === "text" ? "text" : tool === "eraser" ? "cell" : "crosshair";
		if (hoverInput == null) return "default";
		const intent = hitIntent({
			point: hoverInput.point,
			tolerance: hoverInput.tolerance,
			handleTolerance: hoverInput.handleTolerance,
		});
		return intent.kind === "resize"
			? cursorForHandle(intent.handle)
			: intent.kind === "move"
				? "grab"
				: "default";
	}

	// -- public API ---------------------------------------------------------------

	return {
		getSnapshot() {
			return snapshot;
		},
		subscribe(fn) {
			listeners.add(fn);
			let active = true;
			return () => {
				if (!active) return;
				active = false;
				listeners.delete(fn);
			};
		},
		setTool(next) {
			applyToolSwitch(next);
		},
		setShapeKind(kind) {
			applyToolSwitch(kind);
		},
		setEraserSize(px) {
			const next = clampEraserSize(px);
			if (next !== eraserSize) {
				eraserSize = next;
				notify();
			}
		},
		setDrawingWidth(px) {
			const next = clampDrawingWidth(px);
			if (next !== drawingWidth) {
				drawingWidth = next;
				notify();
			}
		},
		setTextSize(px) {
			const next =
				textEdit == null
					? clampTextSize(px)
					: normalizeFontSize(px);
			if (next !== textSize) {
				textSize = next;
				notify();
			}
		},
		setStyle(partial, opts = {}) {
			const selId = selectionId;
			const sel = selectedItem();
			const mode = modeFor(sel);
			const merged = {
				...style,
				...partial,
				...(sel?.kind === "ink" ? { width: style.width } : {}),
			};
			const normalized =
				mode === "text"
					? normalizeTextStyle({
							...merged,
							...(textSize == null && sel == null && textEdit == null && partial.width != null
								? { width: clampTextSize(merged.width) }
								: {}),
						})
					: normalizeStyle(merged);
			const fitted =
				sel?.kind === "text"
					? fitTextStyle(sel, normalized, surfaceBounds)
					: sel == null
						? normalized
						: fitShapeWidth(sel, normalized, surfaceBounds);
			if (fitted.color === style.color && fitted.width === style.width) return;
			const before = style;
			style = adoptStyle(fitted, mode);
			if (sel == null && mode === "drawing") style = drawStyle;
			if (selId != null && sel != null && "style" in sel) {
				commitDoc(
					updateItem(selId, (o) =>
						"style" in o
							? o.kind === "text"
								? normalizeTextForSurface({ ...o, style } as Extract<SketchItem, { kind: "text" }>)
								: { ...o, style }
							: o,
					),
					selectionId,
					{ historyGroup: opts.historyGroup, styleBefore: before },
				);
				return;
			}
			notify();
		},
		setTextFormat(partial, opts = {}) {
			const next = normalizeFormat({ ...format, ...partial });
			if (sameFormat(next, format)) return;
			format = next;
			const sel = selectedItem();
			if (sel?.kind !== "text") {
				notify();
				return;
			}
			const before = style;
			const relaid = normalizeTextObject({ ...sel, format });
			const fittedStyle = fitTextStyle(relaid, relaid.style, surfaceBounds);
			const finalObj = normalizeTextForSurface({ ...relaid, style: fittedStyle });
			const nextDoc = updateItem(sel.id, (o) => (o.kind === "text" ? finalObj : o));
			style = adoptStyle(finalObj.style, "text");
			commitDoc(nextDoc, sel.id, {
				historyGroup: opts.historyGroup,
				styleBefore: before,
			});
		},
		undo() {
			if (isReleasedErasure()) {
				if (releasedErasureUndone) return false;
				releasedErasureUndone = true;
				notify();
				return true;
			}
			if (cancelGesture()) {
				notify();
				return true;
			}
			const entry = undoStack[historyIndex];
			if (entry == null) return false;
			applyHistory(entry, "before");
			historyIndex -= 1;
			notify();
			return true;
		},
		redo() {
			if (isReleasedErasure()) {
				if (!releasedErasureUndone) return false;
				releasedErasureUndone = false;
				notify();
				return true;
			}
			const cancelled = cancelGesture();
			const entry = undoStack[historyIndex + 1];
			if (entry == null) {
				if (cancelled) notify();
				return false;
			}
			applyHistory(entry, "after");
			historyIndex += 1;
			notify();
			return true;
		},
		clear() {
			if (doc.objects.length === 0 && textEdit == null && gesture == null)
				return false;
			const before = style;
			cancelGesture();
			clearTextEditState();
			restoreToolStyle();
			if (doc.objects.length === 0) {
				selectionId = null;
				notify();
				return true;
			}
			return commitDoc(emptyDoc(), null, { styleBefore: before });
		},
		selectObject(id) {
			const item = doc.objects.find((o) => o.id === id);
			if (!isSelectable(item) || isReleasedErasure()) return false;
			cancelGesture();
			adoptObjectStyle(item);
			selectionId = item.id;
			notify();
			return true;
		},
		clearSelection() {
			if (selectionId != null) {
				clearSelectionInternal();
				notify();
			}
		},
		deleteSelection() {
			if (selectionId == null) return false;
			const objects = doc.objects.filter((o) => o.id !== selectionId);
			if (objects.length === doc.objects.length) {
				clearSelectionInternal();
				notify();
				return false;
			}
			const before = style;
			restoreToolStyle();
			return commitDoc({ schemaVersion: 1, objects }, null, { styleBefore: before });
		},
		deleteObject(id) {
			const objects = doc.objects.filter((o) => o.id !== id);
			if (objects.length === doc.objects.length) return false;
			const wasSelected = selectionId === id;
			const before = style;
			if (wasSelected) restoreToolStyle();
			return commitDoc({ schemaVersion: 1, objects }, wasSelected ? null : selectionId, {
				styleBefore: before,
			});
		},
		nudgeSelection(delta, opts = {}) {
			const item = selectedItem();
			if (!isSelectable(item)) return false;
			return commitDoc(
				updateItem(item.id, (o) =>
					translateItem(o, clampMoveDelta(o, delta, surfaceBounds)),
				),
				item.id,
				{ historyGroup: opts.historyGroup },
			);
		},
		pointerDown,
		pointerMove,
		pointerMoves(samples) {
			let handled = false;
			batchDepth += 1;
			try {
				for (const s of samples) handled = pointerMove(s) || handled;
			} finally {
				batchDepth -= 1;
				if (batchDepth === 0 && batchDirty) {
					batchDirty = false;
					notify();
				}
			}
			return handled;
		},
		pointerUp,
		pointerCommit(pointerId) {
			if (gesture == null || (pointerId != null && gesture.pointerId !== pointerId))
				return false;
			return commitGesture();
		},
		pointerCancel(pointerId, opts = {}) {
			if (
				gesture == null ||
				(pointerId != null && gesture.pointerId !== pointerId) ||
				(opts.preserveReleasedErasure === true && isReleasedErasure())
			)
				return false;
			cancelGesture();
			notify();
			return true;
		},
		pointerLeave() {
			hoverInput = null;
			if (computeCursor() !== snapshot.cursor) notify();
		},
		getObjectAtPoint(point, tolerance = HIT_TOLERANCE) {
			const intent = hitIntent({
				point,
				tolerance,
				handleTolerance: tolerance,
			});
			return intent.kind === "clear" ? null : intent.object;
		},
		pasteObject(item, opts = {}) {
			if (isReleasedErasure()) return null;
			cancelGesture();
			const cloned = cloneItem(item, allocateId());
			const moved = translateItem(
				cloned,
				clampPasteOffset(cloned, opts.offset ?? { x: PASTE_OFFSET, y: PASTE_OFFSET }, surfaceBounds),
			);
			const final = moved.kind === "text" ? normalizeTextForSurface(moved) : moved;
			const before = style;
			if (isSelectable(final)) adoptObjectStyle(final);
			if (tool !== "select") tool = "select";
			return commitDoc({ schemaVersion: 1, objects: [...doc.objects, final] }, final.id, {
				styleBefore: before,
			})
				? final.id
				: null;
		},
		setSurfaceBounds(bounds) {
			const next = bounds == null ? null : normalizeBounds(bounds);
			const changed = !boundsEqual(surfaceBounds, next);
			if (changed) surfaceBounds = next;
			if ((changed && textEdit != null) || (changed && gesture != null)) notify();
		},
		setPendingTextEdit(input) {
			if (input == null) {
				if (textEdit == null) return;
				cancelGesture();
				clearTextEditState();
				notify();
				return;
			}
			const fontSize = normalizeFontSize(
				input.style?.width ?? (textSize ?? style.width),
			);
			const bounds =
				input.bounds != null
					? normalizeBounds(input.bounds)
					: defaultTextBounds(
							input.point ?? { x: 0, y: 0 },
							surfaceBounds ?? { x: 0, y: 0, width: 480, height: 320 },
							fontSize,
						);
			const normalizedInput: SketchTextEdit = {
				...input,
				objectId: input.objectId ?? null,
				text: normalizeLineEndings(input.text),
				bounds,
				style: input.style == null ? undefined : { ...input.style },
				format: input.format == null ? undefined : { ...input.format },
			};
			const editId =
				normalizedInput.objectId ??
				(textEdit != null && textEdit.input.objectId == null
					? textEdit.objectId
					: null) ??
				allocateId();
			const nextEdit = { input: normalizedInput, objectId: editId };
			if (
				textEdit != null &&
				textEdit.objectId === nextEdit.objectId &&
				JSON.stringify(textEdit.input) === JSON.stringify(nextEdit.input)
			)
				return;
			cancelGesture();
			textEdit = nextEdit;
			notify();
		},
		commitPendingTextEdit() {
			if (textEdit == null) return false;
			const next = effectiveDoc();
			const obj = textEditObject(textEdit);
			const wasExisting = textEdit.input.objectId != null;
			const wasSelected = obj == null && wasExisting && selectionId === textEdit.input.objectId;
			const before = style;
			clearTextEditState();
			cancelGesture();
			tool = "select";
			if (obj == null) {
				if (wasSelected) restoreToolStyle();
			} else {
				adoptObjectStyle(obj);
			}
			const sel = obj?.id ?? (wasSelected ? null : selectionId);
			if (next === doc) {
				selectionId = sel;
				notify();
				return false;
			}
			return commitDoc(next, sel ?? null, { styleBefore: before });
		},
		discardPendingTextEdit() {
			if (textEdit == null) return false;
			cancelGesture();
			clearTextEditState();
			notify();
			return true;
		},
		insertTextBox(input) {
			const text = normalizeLineEndings(input.text);
			if (text.length === 0) return null;
			const obj = normalizeTextForSurface({
				id: allocateId(),
				kind: "text",
				text,
				bounds: input.bounds,
				style: normalizeTextStyle({ ...style, ...input.style }),
				format: normalizeFormat({ ...format, ...input.format }),
			});
			style = adoptStyle(obj.style, "text");
			format = obj.format;
			if (tool !== "select") tool = "select";
			return commitDoc({ schemaVersion: 1, objects: [...doc.objects, obj] }, obj.id)
				? obj.id
				: null;
		},
		updateTextBox(id, patch, opts = {}) {
			return commitDoc(
				updateItem(id, (o) =>
					o.kind === "text"
						? normalizeTextForSurface({
								...o,
								text: patch.text == null ? o.text : normalizeLineEndings(patch.text),
								bounds: patch.bounds ?? o.bounds,
							})
						: o,
				),
				id,
				{ historyGroup: opts.historyGroup },
			);
		},
		export(opts = {}) {
			if (gesture != null) return Promise.resolve({ kind: "busy" });
			return exportPng(effectiveDoc(), opts)
				.then((result) => result)
				.catch((): SketchExportResult => ({ kind: "unavailable" }));
		},
		replaceDocument(next) {
			cancelGesture();
			clearTextEditState();
			doc = next;
			ids.reserve(next.objects.map((o) => o.id));
			clearSelectionInternal();
			undoStack.length = 0;
			historyIndex = -1;
			notify();
		},
	};

	// ------------------------------------------------------------------

	/** Apply a history entry direction. (`re`) */
	function applyHistory(entry: HistoryEntry, dir: "before" | "after") {
		doc = entry[dir];
		if (tool !== "select") {
			clearSelectionInternal();
			return;
		}
		selectionId = dir === "before" ? entry.selectionBefore : entry.selectionAfter;
		const item = selectedItem();
		if (!isSelectable(item)) {
			clearSelectionInternal();
			return;
		}
		adoptObjectStyle(item, dir === "before" ? entry.styleBefore : entry.styleAfter);
	}

	/** `dn`: shrink a shape/stroke width until its ink fits the surface. */
	function fitShapeWidth(
		item: SketchItem,
		next: StrokeStyle,
		surface: Bounds | null,
	): StrokeStyle {
		if (
			surface == null ||
			item.kind === "text" ||
			item.kind === "ink" ||
			next.width <= item.style.width
		)
			return next;
		const limit = normalizeBounds(surface);
		const fits = (width: number) => {
			const b = selectionBounds({ ...item, style: { ...next, width } });
			return b == null || boundsContain(limit, b);
		};
		if (fits(next.width)) return next;
		if (!fits(item.style.width)) return { ...next, width: item.style.width };
		let lo = item.style.width;
		let hi = next.width;
		for (let i = 0; i < 16; i += 1) {
			const mid = (lo + hi) / 2;
			if (fits(mid)) lo = mid;
			else hi = mid;
		}
		return { ...next, width: lo };
	}
}
