/**
 * Pure op-log sketch model for the SketchPad. No React, no canvas —
 * fully unit-testable. All ops return a new state (immutable updates).
 *
 * Items are committed strokes / texts / shapes; history is a stack of
 * invertible ops (add / erase / move) so undo restores whole eraser
 * drags and select-moves atomically.
 */

export interface SketchPoint {
	x: number;
	y: number;
}

export type ShapeKind = "rect" | "ellipse" | "line";

export type SketchItem =
	| {
			kind: "stroke";
			id: string;
			color: string;
			width: number;
			points: SketchPoint[];
	  }
	| {
			kind: "text";
			id: string;
			x: number;
			y: number;
			text: string;
			color: string;
			size: number;
	  }
	| {
			kind: "shape";
			id: string;
			shape: ShapeKind;
			x1: number;
			y1: number;
			x2: number;
			y2: number;
			color: string;
			width: number;
	  };

export type SketchOp =
	| { kind: "add"; item: SketchItem }
	| { kind: "erase"; items: RemovedItem[] }
	| { kind: "move"; id: string; dx: number; dy: number };

/** An erased item plus its original slot, so undo restores it in place. */
export interface RemovedItem {
	item: SketchItem;
	index: number;
}

export interface SketchState {
	items: SketchItem[];
	undoStack: SketchOp[];
	redoStack: SketchOp[];
}

export function emptySketch(): SketchState {
	return { items: [], undoStack: [], redoStack: [] };
}

/** Push an item (stroke / text / shape) and record the op. Clears redo. */
export function addItem(s: SketchState, item: SketchItem): SketchState {
	return {
		items: [...s.items, item],
		undoStack: [...s.undoStack, { kind: "add", item }],
		redoStack: [],
	};
}

/**
 * Record one erase op for everything removed during a single eraser drag.
 * Items are dropped if still present, so callers may either pre-remove for
 * live preview or let this do the removal.
 */
export function commitErase(
	s: SketchState,
	removed: RemovedItem[],
): SketchState {
	if (removed.length === 0) return s;
	const ids = new Set(removed.map((r) => r.item.id));
	return {
		items: s.items.filter((i) => !ids.has(i.id)),
		undoStack: [...s.undoStack, { kind: "erase", items: removed }],
		redoStack: [],
	};
}

/** Commit one move op translating an item by (dx, dy). Clears redo. */
export function moveItem(
	s: SketchState,
	id: string,
	dx: number,
	dy: number,
): SketchState {
	if (dx === 0 && dy === 0) return s;
	return {
		items: s.items.map((i) => (i.id === id ? translateItem(i, dx, dy) : i)),
		undoStack: [...s.undoStack, { kind: "move", id, dx, dy }],
		redoStack: [],
	};
}

/** Remove items without recording history — used for live erase preview. */
export function dropItems(s: SketchState, ids: ReadonlySet<string>): SketchState {
	if (ids.size === 0) return s;
	return { ...s, items: s.items.filter((i) => !ids.has(i.id)) };
}

export function undo(s: SketchState): SketchState {
	const op = s.undoStack[s.undoStack.length - 1];
	if (!op) return s;
	return {
		items: applyInverse(s.items, op),
		undoStack: s.undoStack.slice(0, -1),
		redoStack: [...s.redoStack, op],
	};
}

export function redo(s: SketchState): SketchState {
	const op = s.redoStack[s.redoStack.length - 1];
	if (!op) return s;
	return {
		items: apply(s.items, op),
		undoStack: [...s.undoStack, op],
		redoStack: s.redoStack.slice(0, -1),
	};
}

/** True when the canvas holds any committed item. */
export function hasInk(s: SketchState): boolean {
	return s.items.length > 0;
}

function apply(items: SketchItem[], op: SketchOp): SketchItem[] {
	switch (op.kind) {
		case "add":
			return [...items, op.item];
		case "erase": {
			const ids = new Set(op.items.map((r) => r.item.id));
			return items.filter((i) => !ids.has(i.id));
		}
		case "move":
			return items.map((i) =>
				i.id === op.id ? translateItem(i, op.dx, op.dy) : i,
			);
	}
}

function applyInverse(items: SketchItem[], op: SketchOp): SketchItem[] {
	switch (op.kind) {
		case "add":
			return items.filter((i) => i.id !== op.item.id);
		case "erase": {
			const next = [...items];
			for (const { item, index } of op.items) {
				next.splice(Math.min(index, next.length), 0, item);
			}
			return next;
		}
		case "move":
			return items.map((i) =>
				i.id === op.id ? translateItem(i, -op.dx, -op.dy) : i,
			);
	}
}

export function translateItem(
	item: SketchItem,
	dx: number,
	dy: number,
): SketchItem {
	switch (item.kind) {
		case "stroke":
			return {
				...item,
				points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
			};
		case "text":
			return { ...item, x: item.x + dx, y: item.y + dy };
		case "shape":
			return {
				...item,
				x1: item.x1 + dx,
				y1: item.y1 + dy,
				x2: item.x2 + dx,
				y2: item.y2 + dy,
			};
	}
}

function distToSegment(
	px: number,
	py: number,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
): number {
	const vx = x2 - x1;
	const vy = y2 - y1;
	const len2 = vx * vx + vy * vy;
	const t =
		len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * vx + (py - y1) * vy) / len2));
	const cx = x1 + t * vx;
	const cy = y1 + t * vy;
	return Math.hypot(px - cx, py - cy);
}

/** Distance from (x, y) to a shape's outline; 0 inside the boundary. */
function shapeOutlineDist(
	shape: ShapeKind,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	px: number,
	py: number,
): number {
	const left = Math.min(x1, x2);
	const right = Math.max(x1, x2);
	const top = Math.min(y1, y2);
	const bottom = Math.max(y1, y2);
	if (shape === "line") return distToSegment(px, py, x1, y1, x2, y2);
	if (shape === "rect") {
		const inside = px >= left && px <= right && py >= top && py <= bottom;
		const edge = Math.min(
			distToSegment(px, py, left, top, right, top),
			distToSegment(px, py, right, top, right, bottom),
			distToSegment(px, py, right, bottom, left, bottom),
			distToSegment(px, py, left, bottom, left, top),
		);
		return inside ? 0 : edge;
	}
	// ellipse: map into unit-circle space, approximate radial distance.
	const rx = Math.max((right - left) / 2, 1);
	const ry = Math.max((bottom - top) / 2, 1);
	const cx = (left + right) / 2;
	const cy = (top + bottom) / 2;
	const nx = (px - cx) / rx;
	const ny = (py - cy) / ry;
	const n = Math.hypot(nx, ny);
	if (n <= 1) return 0;
	return (n - 1) * Math.min(rx, ry);
}

/** True when (x, y) lies within `r` of the item's visible geometry. */
export function hitItem(
	item: SketchItem,
	x: number,
	y: number,
	r: number,
): boolean {
	switch (item.kind) {
		case "stroke": {
			const pts = item.points;
			if (pts.length === 1) {
				return Math.hypot(pts[0].x - x, pts[0].y - y) <= r;
			}
			for (let i = 0; i < pts.length - 1; i++) {
				if (
					distToSegment(x, y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <=
					r
				) {
					return true;
				}
			}
			return false;
		}
		case "text": {
			// Origin proximity, or anywhere inside the text's bounding box.
			if (Math.hypot(item.x - x, item.y - y) <= r) return true;
			const w = Math.max(item.text.length * item.size * 0.6, item.size);
			return (
				x >= item.x - r &&
				x <= item.x + w + r &&
				y >= item.y - item.size - r &&
				y <= item.y + r
			);
		}
		case "shape":
			return shapeOutlineDist(item.shape, item.x1, item.y1, item.x2, item.y2, x, y) <= r;
	}
}

/** Topmost (last-painted) item within `r` of (x, y), or null. */
export function hitTest(
	s: SketchState,
	x: number,
	y: number,
	r: number,
): SketchItem | null {
	for (let i = s.items.length - 1; i >= 0; i--) {
		if (hitItem(s.items[i], x, y, r)) return s.items[i];
	}
	return null;
}
