import { describe, expect, it } from "vitest";
import { cappedDpr, extendStroke, replaySketch, resizeSketchCanvas, sketchPoint, startStroke, undoStroke, type Stroke } from "./sketchModel";

describe("sketchModel", () => {
	it("starts, extends and undoes strokes without mutating the previous list", () => {
		const a = startStroke([], "#111111", 6, [1, 2]);
		const b = startStroke(a, "#e5372e", 3, [5, 5]);
		extendStroke(b, [6, 7]);
		expect(a).toHaveLength(1);
		expect(b[1].pts).toEqual([
			[5, 5],
			[6, 7],
		]);
		expect(undoStroke(b)).toEqual([a[0]]);
		expect(undoStroke([])).toEqual([]);
	});

	it("caps dpr at 2 and defaults invalid values to 1", () => {
		expect(cappedDpr(3)).toBe(2);
		expect(cappedDpr(1.5)).toBe(1.5);
		expect(cappedDpr(0)).toBe(1);
		expect(cappedDpr(Number.NaN)).toBe(1);
	});

	it("replays legacy ink, erasure, and later ink before placing paper behind them", () => {
		const paint: { operation: string; color: string | CanvasGradient | CanvasPattern; path: number[][] }[] = [];
		let path: number[][] = [];
		const ctx = {
			globalCompositeOperation: "source-over", strokeStyle: "", fillStyle: "",
			save() {}, restore() {}, setTransform() {}, clearRect() {}, scale() {},
			beginPath() { path = []; }, moveTo(x: number, y: number) { path.push([x, y]); },
			lineTo(x: number, y: number) { path.push([x, y]); }, arc(x: number, y: number) { path.push([x, y]); },
			stroke() { paint.push({ operation: this.globalCompositeOperation, color: this.strokeStyle, path: [...path] }); },
			fill() { paint.push({ operation: this.globalCompositeOperation, color: this.fillStyle, path: [...path] }); },
			fillRect() { paint.push({ operation: this.globalCompositeOperation, color: this.fillStyle, path: [] }); },
		};
		const canvas = { width: 200, height: 100, getContext: () => ctx } as unknown as HTMLCanvasElement;
		const legacy: Stroke = { color: "#e5372e", width: 6, pts: [[10, 20], [30, 20]] };
		const erased = startStroke([legacy], "#ffffff", 12, [20, 20], "eraser");
		const final = startStroke(erased, "#111111", 3, [40, 40]);
		replaySketch(canvas, final, { width: 200, height: 100 }, "#f0f0f0");
		expect(paint.map((p) => p.operation)).toEqual(["source-over", "destination-out", "source-over", "destination-over"]);
		expect(paint[0]).toMatchObject({ color: "#e5372e", path: [[10, 20], [30, 20]] });
		expect(paint[1].path).toEqual([[20, 20]]);
		expect(paint[3].color).toBe("#f0f0f0");
		expect(undoStroke(erased)).toEqual([legacy]);
	});

	it("keeps paper coordinates stable across stage and DPR changes", () => {
		const model = { width: 200, height: 100 };
		const canvas = { width: 0, height: 0, style: {}, getBoundingClientRect: () => ({ left: 30, top: 60, width: 100, height: 50 }) } as unknown as HTMLCanvasElement;
		resizeSketchCanvas(canvas, { width: 100, height: 100 }, model, 2);
		expect([canvas.width, canvas.height]).toEqual([200, 100]);
		expect(canvas.style).toMatchObject({ width: "100px", height: "50px", left: "0px", top: "25px" });
		expect(sketchPoint(canvas, model, 80, 85)).toEqual([100, 50]);
		resizeSketchCanvas(canvas, { width: 600, height: 200 }, model, 1);
		expect([canvas.width, canvas.height]).toEqual([400, 200]);
		expect(canvas.style).toMatchObject({ width: "400px", height: "200px", left: "100px", top: "0px" });
		expect(model).toEqual({ width: 200, height: 100 });
	});
});
