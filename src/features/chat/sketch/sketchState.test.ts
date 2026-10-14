import { describe, expect, it } from "vitest";
import {
	addItem,
	commitErase,
	emptySketch,
	hasInk,
	hitTest,
	moveItem,
	redo,
	undo,
} from "./sketchState";
import type { SketchItem, SketchState } from "./sketchState";

let seq = 0;
const stroke = (pts: [number, number][]): SketchItem => ({
	kind: "stroke",
	id: `s${++seq}`,
	color: "#ffffff",
	width: 4,
	points: pts.map(([x, y]) => ({ x, y })),
});
const text = (x: number, y: number, t: string): SketchItem => ({
	kind: "text",
	id: `t${++seq}`,
	x,
	y,
	text: t,
	color: "#ffffff",
	size: 16,
});
const rect = (x1: number, y1: number, x2: number, y2: number): SketchItem => ({
	kind: "shape",
	id: `r${++seq}`,
	shape: "rect",
	x1,
	y1,
	x2,
	y2,
	color: "#ffffff",
	width: 4,
});

function withItem(s: SketchState, item: SketchItem): SketchState {
	return addItem(s, item);
}

describe("sketchState", () => {
	it("addItem records an add op and clears redo", () => {
		const s = withItem(emptySketch(), stroke([[1, 1]]));
		expect(s.items).toHaveLength(1);
		expect(s.undoStack).toEqual([{ kind: "add", item: s.items[0] }]);
		expect(s.redoStack).toHaveLength(0);
		expect(hasInk(s)).toBe(true);
	});

	it("undo/redo round-trips an added item", () => {
		const s = withItem(emptySketch(), stroke([[1, 1], [2, 2]]));
		const u = undo(s);
		expect(u.items).toHaveLength(0);
		expect(u.redoStack).toHaveLength(1);
		const r = redo(u);
		expect(r.items).toHaveLength(1);
		expect(r.items[0]).toEqual(s.items[0]);
		expect(r.undoStack).toHaveLength(1);
	});

	it("commitErase removes the dragged-over items and undo restores them", () => {
		const a = stroke([[0, 0]]);
		const b = stroke([[10, 10]]);
		const c = text(50, 50, "hi");
		let s = withItem(emptySketch(), a);
		s = withItem(s, b);
		s = withItem(s, c);

		const erased = commitErase(s, [
			{ item: a, index: 0 },
			{ item: b, index: 1 },
		]);
		expect(erased.items).toEqual([c]);
		expect(erased.undoStack).toHaveLength(4); // 3 adds + 1 erase

		const restored = undo(erased);
		expect(restored.items).toEqual([a, b, c]);
		const redone = redo(restored);
		expect(redone.items).toEqual([c]);
	});

	it("commitErase is a no-op for an empty removal", () => {
		const s = withItem(emptySketch(), stroke([[1, 1]]));
		expect(commitErase(s, [])).toBe(s);
	});

	it("moveItem translates an item and undo moves it back", () => {
		const item = text(10, 20, "hi");
		const s = withItem(emptySketch(), item);
		const moved = moveItem(s, item.id, 5, -3);
		expect(moved.items[0]).toMatchObject({ kind: "text", x: 15, y: 17 });

		const back = undo(moved);
		expect(back.items[0]).toMatchObject({ kind: "text", x: 10, y: 20 });
	});

	it("moveItem translates every kind of item", () => {
		const st = stroke([[0, 0], [10, 10]]);
		const sh = rect(0, 0, 20, 20);
		let s = withItem(emptySketch(), st);
		s = withItem(s, sh);
		const moved = moveItem(s, st.id, 2, 3);
		expect(moved.items[0]).toMatchObject({
			kind: "stroke",
			points: [
				{ x: 2, y: 3 },
				{ x: 12, y: 13 },
			],
		});
		const movedShape = moveItem(s, sh.id, 1, 1);
		expect(movedShape.items[1]).toMatchObject({ x1: 1, y1: 1, x2: 21, y2: 21 });
	});

	it("a zero-delta move records no op", () => {
		const item = stroke([[1, 1]]);
		const s = withItem(emptySketch(), item);
		expect(moveItem(s, item.id, 0, 0)).toBe(s);
	});

	it("undo/redo on empty stacks are no-ops", () => {
		const s = emptySketch();
		expect(undo(s)).toBe(s);
		expect(redo(s)).toBe(s);
		expect(hasInk(s)).toBe(false);
	});

	it("new ops clear the redo stack", () => {
		const item = stroke([[1, 1]]);
		let s = undo(withItem(emptySketch(), item));
		expect(s.redoStack).toHaveLength(1);
		s = withItem(s, stroke([[2, 2]]));
		expect(s.redoStack).toHaveLength(0);

		s = undo(s);
		s = undo(s);
		expect(s.redoStack.length).toBeGreaterThan(0);
		const moved = moveItem(s, item.id, 1, 1);
		expect(moved.redoStack).toHaveLength(0);
	});

	it("hitTest finds stroke points, text origins and shape outlines", () => {
		const st = stroke([[10, 10], [30, 30]]);
		const tx = text(80, 80, "note");
		const rc = rect(100, 100, 140, 140);
		let s = withItem(emptySketch(), st);
		s = withItem(s, tx);
		s = withItem(s, rc);

		expect(hitTest(s, 30, 30, 5)?.id).toBe(st.id);
		expect(hitTest(s, 80, 80, 5)?.id).toBe(tx.id);
		// On the rect edge and inside the rect bounds.
		expect(hitTest(s, 100, 120, 5)?.id).toBe(rc.id);
		expect(hitTest(s, 120, 120, 5)?.id).toBe(rc.id);
		// Far away: nothing.
		expect(hitTest(s, 400, 400, 5)).toBeNull();
	});

	it("hitTest returns the topmost overlapping item", () => {
		const below = stroke([[10, 10]]);
		const above = stroke([[10, 10]]);
		let s = withItem(emptySketch(), below);
		s = withItem(s, above);
		expect(hitTest(s, 10, 10, 4)?.id).toBe(above.id);
	});

	it("hasInk tracks committed items", () => {
		expect(hasInk(emptySketch())).toBe(false);
		expect(hasInk(withItem(emptySketch(), stroke([[1, 1]])))).toBe(true);
	});
});
