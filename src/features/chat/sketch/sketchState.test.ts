import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSketchEditor,
	exportToPng,
	shapeOutlinePoints,
} from "./sketchState";
import type {
	Bounds,
	PointerSample,
	SketchDoc,
	SketchEditor,
	SketchItem,
} from "./sketchState";

const SURFACE: Bounds = { x: 0, y: 0, width: 800, height: 600 };

function sample(
	x: number,
	y: number,
	extra: Partial<PointerSample> = {},
): PointerSample {
	return {
		pointerId: 1,
		point: { x, y },
		viewportScale: 1,
		tolerance: 10,
		handleTolerance: 7,
		snapTolerance: 6,
		shiftKey: false,
		altKey: false,
		pressure: null,
		pointerType: "mouse",
		timestamp: null,
		surfaceBounds: SURFACE,
		...extra,
	};
}

function drawStroke(
	ed: SketchEditor,
	points: [number, number][],
	pointerId = 1,
) {
	ed.setTool("pen");
	ed.pointerDown(sample(points[0]![0], points[0]![1], { pointerId }));
	for (const [x, y] of points.slice(1))
		ed.pointerMove(sample(x, y, { pointerId }));
	ed.pointerUp(sample(points[points.length - 1]![0], points[points.length - 1]![1], { pointerId }));
}

function drawShape(
	ed: SketchEditor,
	kind:
		| "line"
		| "arrow"
		| "rectangle"
		| "ellipse"
		| "triangle"
		| "diamond"
		| "star"
		| "heart",
	from: [number, number],
	to: [number, number],
	opts: { shiftKey?: boolean; pointerId?: number } = {},
) {
	const pid = opts.pointerId ?? 1;
	ed.setTool("shapes");
	ed.setShapeKind(kind);
	ed.pointerDown(sample(from[0], from[1], { pointerId: pid }));
	ed.pointerMove(
		sample(to[0], to[1], { pointerId: pid, shiftKey: opts.shiftKey }),
	);
	ed.pointerUp(
		sample(to[0], to[1], { pointerId: pid, shiftKey: opts.shiftKey }),
	);
}

function dragEraser(
	ed: SketchEditor,
	points: [number, number][],
	pointerId = 9,
) {
	ed.setTool("eraser");
	ed.pointerDown(sample(points[0]![0], points[0]![1], { pointerId }));
	for (const [x, y] of points.slice(1))
		ed.pointerMove(sample(x, y, { pointerId }));
	ed.pointerUp(
		sample(points[points.length - 1]![0], points[points.length - 1]![1], {
			pointerId,
		}),
	);
}

function objects(ed: SketchEditor): SketchItem[] {
	return ed.getSnapshot().document.objects;
}

describe("createSketchEditor defaults and clamps", () => {
	it("starts with pen tool, dark-canvas style and empty doc", () => {
		const ed = createSketchEditor();
		const s = ed.getSnapshot();
		expect(s.activeTool).toBe("pen");
		expect(s.style).toEqual({ color: "#ffffff", width: 12 });
		expect(s.eraserSizePx).toBe(32);
		expect(s.drawingWidthPx).toBeNull();
		expect(s.textSizePx).toBeNull();
		expect(s.textFormat).toEqual({ bold: false, italic: false, underline: false });
		expect(s.selectionId).toBeNull();
		expect(s.canUndo).toBe(false);
		expect(s.canRedo).toBe(false);
		expect(s.hasActiveGesture).toBe(false);
		expect(s.hasPendingTextEdit).toBe(false);
		expect(s.preview).toBeNull();
		expect(s.erasurePreview).toBeNull();
		expect(s.snapGuides).toEqual([]);
		expect(s.cursor).toBe("crosshair");
		expect(s.document).toEqual({ schemaVersion: 1, objects: [] });
	});

	it("clamps eraser/drawing/text sizes", () => {
		const ed = createSketchEditor();
		ed.setEraserSize(1000);
		expect(ed.getSnapshot().eraserSizePx).toBe(96);
		ed.setEraserSize(-5);
		expect(ed.getSnapshot().eraserSizePx).toBe(4);
		ed.setEraserSize(Number.NaN);
		// Real qo(): non-finite falls back to the default 32 before clamping.
		expect(ed.getSnapshot().eraserSizePx).toBe(32);
		ed.setDrawingWidth(0);
		expect(ed.getSnapshot().drawingWidthPx).toBe(1);
		ed.setDrawingWidth(99);
		expect(ed.getSnapshot().drawingWidthPx).toBe(32);
		ed.setTextSize(1);
		expect(ed.getSnapshot().textSizePx).toBe(8);
		ed.setTextSize(500);
		expect(ed.getSnapshot().textSizePx).toBe(128);
	});

	it("clamps init options", () => {
		const ed = createSketchEditor({
			eraserSizePx: 200,
			drawingWidthPx: 0,
			textSizePx: 999,
		});
		const s = ed.getSnapshot();
		expect(s.eraserSizePx).toBe(96);
		expect(s.drawingWidthPx).toBe(1);
		expect(s.textSizePx).toBe(128);
	});

	it("subscribes and unsubscribes", () => {
		const ed = createSketchEditor();
		let calls = 0;
		const unsub = ed.subscribe(() => {
			calls += 1;
		});
		ed.setTool("eraser");
		expect(calls).toBe(1);
		unsub();
		ed.setTool("pen");
		expect(calls).toBe(1);
	});
});

describe("pen strokes", () => {
	it("commits a stroke on pointer up with undo/redo", () => {
		const ed = createSketchEditor();
		drawStroke(ed, [
			[100, 100],
			[200, 100],
			[300, 100],
		]);
		const s = ed.getSnapshot();
		expect(s.document.objects).toHaveLength(1);
		const stroke = s.document.objects[0]!;
		expect(stroke.kind).toBe("stroke");
		if (stroke.kind === "stroke") {
			expect(stroke.points[0]).toMatchObject({ x: 100, y: 100 });
			expect(stroke.points[stroke.points.length - 1]!).toMatchObject({ x: 300, y: 100 });
		}
		expect(stroke.id).toMatch(/^sketch-object-/);
		expect(s.hasActiveGesture).toBe(false);
		expect(s.canUndo).toBe(true);
		ed.undo();
		expect(ed.getSnapshot().document.objects).toHaveLength(0);
		expect(ed.getSnapshot().canRedo).toBe(true);
		ed.redo();
		expect(ed.getSnapshot().document.objects).toHaveLength(1);
	});

	it("pen gesture exposes a stroke preview and stays selected-less", () => {
		const ed = createSketchEditor();
		ed.setTool("pen");
		ed.pointerDown(sample(10, 10));
		ed.pointerMove(sample(60, 10));
		const s = ed.getSnapshot();
		expect(s.hasActiveGesture).toBe(true);
		expect(s.preview?.object.kind).toBe("stroke");
		expect(s.preview?.replaceObjectId).toBeNull();
		expect(s.selectionId).toBeNull();
		ed.pointerCancel();
		expect(ed.getSnapshot().document.objects).toHaveLength(0);
		expect(ed.getSnapshot().hasActiveGesture).toBe(false);
	});

	it("merges same historyGroup commits into one undo step", () => {
		const ed = createSketchEditor();
		drawShape(ed, "rectangle", [100, 100], [200, 160]);
		const id = objects(ed)[0]!.id;
		const x0 = (objects(ed)[0] as { bounds: Bounds }).bounds.x;
		ed.selectObject(id);
		ed.nudgeSelection({ x: 5, y: 0 }, { historyGroup: "arrows" });
		ed.nudgeSelection({ x: 5, y: 0 }, { historyGroup: "arrows" });
		ed.nudgeSelection({ x: 5, y: 0 }, { historyGroup: "arrows" });
		expect((objects(ed)[0] as { bounds: Bounds }).bounds.x).toBe(x0 + 15);
		ed.undo();
		expect((objects(ed)[0] as { bounds: Bounds }).bounds.x).toBe(x0);
		ed.redo();
		expect((objects(ed)[0] as { bounds: Bounds }).bounds.x).toBe(x0 + 15);
	});

	it("merges setStyle width changes in one historyGroup", () => {
		const ed = createSketchEditor();
		drawShape(ed, "rectangle", [10, 10], [60, 60]);
		const id = objects(ed)[0]!.id;
		ed.selectObject(id);
		ed.setStyle({ width: 20 }, { historyGroup: "slider" });
		ed.setStyle({ width: 30 }, { historyGroup: "slider" });
		expect(objects(ed)[0]!.style.width).toBe(30);
		ed.undo();
		expect(objects(ed)[0]!.style.width).toBe(12);
	});

	it("undoes a live gesture instead of committed history", () => {
		const ed = createSketchEditor();
		drawStroke(ed, [
			[50, 50],
			[90, 50],
		]);
		ed.pointerDown(sample(10, 300));
		expect(ed.getSnapshot().canUndo).toBe(true);
		ed.undo();
		expect(ed.getSnapshot().document.objects).toHaveLength(1);
		expect(ed.getSnapshot().hasActiveGesture).toBe(false);
	});
});

describe("vector eraser", () => {
	it("splits a stroke into two ink residuals on partial cut", () => {
		const ed = createSketchEditor();
		drawStroke(ed, [
			[100, 100],
			[300, 100],
		]);
		// Vertical pass through x=200 with radius 16 (default 32).
		ed.setTool("eraser");
		ed.pointerDown(sample(200, 60, { pointerId: 9 }));
		ed.pointerMove(sample(200, 140, { pointerId: 9 }));
		const preview = ed.getSnapshot().erasurePreview;
		expect(preview).not.toBeNull();
		const residual = preview!.objects;
		expect(residual).toHaveLength(2);
		expect(residual.every((o) => o.kind === "ink")).toBe(true);
		ed.pointerUp(sample(200, 140, { pointerId: 9 }));
		const after = objects(ed);
		expect(after).toHaveLength(2);
		expect(after[0]!.kind).toBe("ink");
		expect(after[1]!.kind).toBe("ink");
		if (after[0]!.kind === "ink" && after[1]!.kind === "ink") {
			expect(after[0]!.points[after[0]!.points.length - 1]!.x).toBeLessThan(200);
			expect(after[1]!.points[0]!.x).toBeGreaterThan(200);
			// Residuals inherit the original stroke style.
			expect(after[0]!.style.color).toBe("#ffffff");
		}
		// One history entry for the whole drag.
		expect(ed.getSnapshot().canUndo).toBe(true);
		ed.undo();
		expect(objects(ed)).toHaveLength(1);
		expect(objects(ed)[0]!.kind).toBe("stroke");
		ed.redo();
		expect(objects(ed).every((o) => o.kind === "ink")).toBe(true);
	});

	it("removes an object fully covered by the stroke", () => {
		const ed = createSketchEditor();
		drawStroke(ed, [
			[100, 100],
			[150, 100],
		]);
		ed.setEraserSize(96);
		dragEraser(ed, [
			[100, 50],
			[150, 160],
		]);
		expect(objects(ed)).toHaveLength(0);
		ed.undo();
		expect(objects(ed)).toHaveLength(1);
	});

	it("deletes a text object when the capsule hits its bounds", () => {
		const ed = createSketchEditor();
		ed.setTool("text");
		ed.setPendingTextEdit({
			text: "label",
			objectId: null,
			bounds: { x: 100, y: 100, width: 120, height: 40 },
		});
		ed.commitPendingTextEdit();
		expect(objects(ed)).toHaveLength(1);
		dragEraser(ed, [
			[110, 110],
			[130, 115],
		]);
		expect(objects(ed)).toHaveLength(0);
	});

	it("exposes the eraser trail through the preview object", () => {
		const ed = createSketchEditor();
		ed.setTool("eraser");
		ed.pointerDown(sample(50, 50, { pointerId: 4 }));
		ed.pointerMove(sample(80, 60, { pointerId: 4 }));
		const preview = ed.getSnapshot().preview;
		expect(preview?.object.kind).toBe("eraser");
		if (preview?.object.kind === "eraser") {
			expect(preview.object.width).toBe(32);
			expect(preview.object.points.length).toBeGreaterThanOrEqual(2);
		}
		ed.pointerCancel(4);
	});
});

describe("shapes", () => {
	it("commits a rectangle and selects it, switching to select", () => {
		const ed = createSketchEditor();
		drawShape(ed, "rectangle", [100, 100], [300, 200]);
		const s = ed.getSnapshot();
		expect(s.activeTool).toBe("select");
		const rect = s.document.objects[0]!;
		expect(rect.kind).toBe("rectangle");
		if (rect.kind === "rectangle") {
			expect(rect.bounds).toEqual({ x: 100, y: 100, width: 200, height: 100 });
		}
		expect(s.selectionId).toBe(rect.id);
	});

	it("Shift constrains rectangles to squares (max extent)", () => {
		const ed = createSketchEditor();
		drawShape(ed, "rectangle", [400, 300], [500, 330], { shiftKey: true });
		const rect = objects(ed)[0]!;
		if (rect.kind === "rectangle") {
			expect(rect.bounds.width).toBeCloseTo(100);
			expect(rect.bounds.height).toBeCloseTo(100);
		}
	});

	it("Shift snaps line drags to 45° angles", () => {
		const ed = createSketchEditor();
		drawShape(ed, "line", [100, 100], [300, 140], { shiftKey: true });
		const line = objects(ed)[0]!;
		if (line.kind === "line") {
			// atan2(40, 200) rounds to 0° → horizontal.
			expect(line.to.y).toBe(line.from.y);
		}
	});

	it("produces template outlines for triangle/diamond/star/heart", () => {
		const ed = createSketchEditor();
		drawShape(ed, "triangle", [10, 10], [110, 110]);
		drawShape(ed, "diamond", [150, 10], [250, 110]);
		drawShape(ed, "star", [300, 10], [400, 110]);
		drawShape(ed, "heart", [450, 10], [550, 110]);
		const [tri, dia, star, heart] = objects(ed);
		const triPts = shapeOutlinePoints(tri);
		expect(triPts.points).toHaveLength(3);
		expect(triPts.closed).toBe(true);
		expect(shapeOutlinePoints(dia).points).toHaveLength(4);
		expect(shapeOutlinePoints(star).points).toHaveLength(10);
		expect(shapeOutlinePoints(heart).points.length).toBeGreaterThan(40);
	});

	it("star bounds expand past the drag box (template basis)", () => {
		const ed = createSketchEditor();
		drawShape(ed, "star", [50, 350], [150, 450]);
		const star = objects(ed)[0]!;
		if (star.kind === "star") {
			expect(star.bounds.x).toBeLessThan(50);
			expect(star.bounds.width).toBeGreaterThan(100);
		}
	});

	it("arrow head geometry: tip plus two wings within 30° half-angle", () => {
		const ed = createSketchEditor();
		drawShape(ed, "arrow", [100, 100], [300, 100]);
		const arrow = objects(ed)[0]!;
		expect(arrow.kind).toBe("arrow");
		// Head triangle: tip (300,100), wings (268.8,82)/(268.8,118).
		// Points on/inside the wedge hit; the shaft stops at the head base.
		expect(ed.getObjectAtPoint({ x: 290, y: 100 }, 4)?.id === arrow.id).toBe(true);
		expect(ed.getObjectAtPoint({ x: 280, y: 95 }, 4)?.id === arrow.id).toBe(true);
		if (arrow.kind !== "arrow") return;
		// Head length = clamp(12*3, 12, len*0.6) = 36.
		const len = Math.hypot(arrow.to.x - arrow.from.x, arrow.to.y - arrow.from.y);
		expect(len).toBeCloseTo(200);
	});

	it("drops shapes smaller than the minimum size", () => {
		const ed = createSketchEditor();
		ed.setTool("shapes");
		ed.setShapeKind("rectangle");
		ed.pointerDown(sample(100, 100));
		ed.pointerMove(sample(101, 101));
		ed.pointerUp(sample(101, 101));
		expect(objects(ed)).toHaveLength(0);
	});
});

describe("text objects", () => {
	it("creates, previews, and commits a text box", () => {
		const ed = createSketchEditor();
		ed.setSurfaceBounds(SURFACE);
		ed.setTool("text");
		ed.setPendingTextEdit({
			text: "hello",
			objectId: null,
			point: { x: 100, y: 100 },
		});
		const pending = ed.getSnapshot();
		expect(pending.hasPendingTextEdit).toBe(true);
		expect(pending.effectiveDocument.objects).toHaveLength(1);
		const t = pending.effectiveDocument.objects[0]!;
		expect(t.kind).toBe("text");
		if (t.kind === "text") {
			expect(t.bounds.width).toBe(240);
			expect(t.bounds.height).toBe(24 * 1.25 + 16);
			expect(t.style.width).toBe(24);
		}
		expect(ed.commitPendingTextEdit()).toBe(true);
		const s = ed.getSnapshot();
		expect(s.document.objects).toHaveLength(1);
		expect(s.activeTool).toBe("select");
		expect(s.hasPendingTextEdit).toBe(false);
		expect(s.selectionId).toBe(s.document.objects[0]!.id);
		ed.undo();
		expect(objects(ed)).toHaveLength(0);
		ed.redo();
		expect(objects(ed)).toHaveLength(1);
	});

	it("edits existing text and deletes it on empty commit", () => {
		const ed = createSketchEditor();
		ed.setPendingTextEdit({
			text: "first",
			objectId: null,
			bounds: { x: 10, y: 10, width: 200, height: 46 },
		});
		ed.commitPendingTextEdit();
		const id = objects(ed)[0]!.id;
		ed.setPendingTextEdit({
			text: "second",
			objectId: id,
			bounds: objects(ed)[0]!.kind === "text" ? (objects(ed)[0] as { bounds: Bounds }).bounds : { x: 0, y: 0, width: 0, height: 0 },
		});
		ed.commitPendingTextEdit();
		const item = objects(ed)[0]!;
		expect(item.kind === "text" && item.text).toBe("second");
		ed.setPendingTextEdit({
			text: "   ",
			objectId: id,
		});
		// Whitespace-only is non-empty text; empty string deletes.
		ed.setPendingTextEdit({
			text: "",
			objectId: id,
		});
		expect(ed.commitPendingTextEdit()).toBe(true);
		expect(objects(ed)).toHaveLength(0);
		ed.undo();
		expect(objects(ed)).toHaveLength(1);
	});

	it("discardPendingTextEdit drops the pending object", () => {
		const ed = createSketchEditor();
		ed.setPendingTextEdit({ text: "draft", objectId: null, point: { x: 5, y: 5 } });
		expect(ed.getSnapshot().hasPendingTextEdit).toBe(true);
		expect(ed.discardPendingTextEdit()).toBe(true);
		expect(ed.getSnapshot().hasPendingTextEdit).toBe(false);
		expect(ed.getSnapshot().effectiveDocument.objects).toHaveLength(0);
	});
});

describe("selection, move, resize, flip", () => {
	it("moves an object via select drag and records one undo", () => {
		const ed = createSketchEditor();
		drawShape(ed, "rectangle", [100, 100], [200, 160]);
		ed.setTool("select");
		ed.pointerDown(sample(150, 130));
		ed.pointerMove(sample(180, 160));
		expect(ed.getSnapshot().preview?.transformKind).toBe("move");
		ed.pointerUp(sample(180, 160));
		const rect = objects(ed)[0]!;
		if (rect.kind === "rectangle") {
			expect(rect.bounds).toEqual({ x: 130, y: 130, width: 100, height: 60 });
		}
		ed.undo();
		const back = objects(ed)[0]!;
		if (back.kind === "rectangle") expect(back.bounds.x).toBe(100);
	});

	it("resizes via the se handle with transformKind resize", () => {
		const ed = createSketchEditor();
		drawShape(ed, "rectangle", [100, 100], [200, 160]);
		const sel = objects(ed)[0]!;
		// Selection bounds are stroke-inflated: half width (6) around the box.
		ed.setTool("select");
		ed.pointerDown(sample(200 + 6, 160 + 6)); // se handle (stroke-inflated)
		ed.pointerMove(sample(260, 220));
		expect(ed.getSnapshot().preview?.transformKind).toBe("resize");
		ed.pointerUp(sample(260, 220));
		const rect = objects(ed)[0]!;
		if (rect.kind === "rectangle") {
			expect(rect.bounds.width).toBeGreaterThan(100);
			expect(rect.bounds.height).toBeGreaterThan(60);
		}
		expect(sel.id).toBe(objects(ed)[0]!.id);
	});

	it("flips a shape when dragging a handle across the anchor", () => {
		const ed = createSketchEditor();
		drawShape(ed, "triangle", [100, 100], [200, 200]);
		ed.setTool("select");
		// Drag the se handle (inflated bounds: 206,206) left past nw.
		ed.pointerDown(sample(206, 206));
		ed.pointerMove(sample(50, 50));
		ed.pointerUp(sample(50, 50));
		const tri = objects(ed)[0]!;
		if (tri.kind === "triangle") {
			expect(tri.flipX === true || tri.flipY === true).toBe(true);
		}
	});

	it("moves a stroke by remap and nudges by delta", () => {
		const ed = createSketchEditor();
		drawStroke(ed, [
			[100, 100],
			[200, 100],
		]);
		const id = objects(ed)[0]!.id;
		ed.selectObject(id);
		expect(ed.getSnapshot().selectionId).toBe(id);
		ed.nudgeSelection({ x: 10, y: -5 });
		const stroke = objects(ed)[0]!;
		if (stroke.kind === "stroke") {
			expect(stroke.points[0]).toMatchObject({ x: 110, y: 95 });
		}
	});
});

describe("clipboard and misc", () => {
	it("pasteObject clones with a fresh id and +12 offset", () => {
		const ed = createSketchEditor();
		drawShape(ed, "rectangle", [100, 100], [150, 150]);
		const src = objects(ed)[0]!;
		const id = ed.pasteObject(src);
		expect(id).not.toBeNull();
		expect(id).not.toBe(src.id);
		const pasted = objects(ed).find((o) => o.id === id)!;
		if (pasted.kind === "rectangle" && src.kind === "rectangle") {
			expect(pasted.bounds.x).toBe(src.bounds.x + 12);
			expect(pasted.bounds.y).toBe(src.bounds.y + 12);
		}
		expect(ed.getSnapshot().selectionId).toBe(id);
		expect(ed.getSnapshot().activeTool).toBe("select");
	});

	it("deleteSelection removes the object and clears selection", () => {
		const ed = createSketchEditor();
		drawShape(ed, "rectangle", [10, 10], [60, 60]);
		expect(ed.deleteSelection()).toBe(true);
		expect(objects(ed)).toHaveLength(0);
		expect(ed.getSnapshot().selectionId).toBeNull();
		ed.undo();
		expect(objects(ed)).toHaveLength(1);
	});

	it("text-to-text move snaps to alignment and reports guides", () => {
		const ed = createSketchEditor();
		ed.setSurfaceBounds(SURFACE);
		ed.insertTextBox({
			text: "a",
			bounds: { x: 100, y: 100, width: 100, height: 46 },
		});
		ed.insertTextBox({
			text: "b",
			bounds: { x: 300, y: 260, width: 100, height: 46 },
		});
		ed.setTool("select");
		// Grab the second text inside its bounds and drag so its left edge
		// approaches x=100 (first text's left edge) within snap tolerance.
		ed.pointerDown(sample(350, 280, { pointerId: 2 }));
		ed.pointerMove(sample(104 + 50, 330, { pointerId: 2 })); // left edge -> 104
		const s = ed.getSnapshot();
		expect(s.preview?.transformKind).toBe("move");
		const moved = s.preview!.object;
		if (moved.kind === "text") {
			// Snapped to x=100 alignment.
			expect(moved.bounds.x).toBe(100);
		}
		expect(s.snapGuides.length).toBeGreaterThan(0);
		expect(s.snapGuides[0]!.axis).toBe("x");
		ed.pointerUp(sample(154, 330, { pointerId: 2 }));
	});
});

describe("export", () => {
	const PNG_URL = "data:image/png;base64,iVBORw0KGgoAAAANS";

	beforeEach(() => {
		const ctx = new Proxy(
			{},
			{
				get(_t, prop) {
					if (prop === "canvas") return {};
					if (prop === "measureText") return () => ({ width: 42 });
					return () => undefined;
				},
				set() {
					return true;
				},
			},
		);
		vi.stubGlobal("document", {
			createElement: () => ({
				width: 0,
				height: 0,
				getContext: () => ctx,
				toDataURL: () => PNG_URL,
			}),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("exportToPng returns a data URL for a non-empty doc", async () => {
		const doc: SketchDoc = {
			schemaVersion: 1,
			objects: [
				{
					kind: "stroke",
					id: "a",
					points: [
						{ x: 10, y: 10 },
						{ x: 60, y: 40 },
					],
					style: { color: "#ffffff", width: 12 },
				},
			],
		};
		const url = await exportToPng(doc, { backgroundColor: "#212121", padding: 36 });
		expect(url).toBe(PNG_URL);
	});

	it("exportToPng returns null for an empty doc", async () => {
		await expect(exportToPng({ schemaVersion: 1, objects: [] })).resolves.toBeNull();
	});

	it("editor.export reports empty for a blank document", async () => {
		const ed = createSketchEditor();
		await expect(ed.export()).resolves.toEqual({ kind: "empty" });
	});

	it("editor.export returns success with a dataUrl", async () => {
		const ed = createSketchEditor();
		drawStroke(ed, [
			[50, 50],
			[120, 80],
		]);
		const result = await ed.export({
			backgroundColor: "#212121",
			padding: 36,
			scale: 1,
			mimeType: "image/png",
		});
		expect(result.kind).toBe("success");
		if (result.kind === "success") expect(result.dataUrl).toBe(PNG_URL);
	});
});
