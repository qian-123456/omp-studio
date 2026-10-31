// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SketchPad } from "./SketchPad";

vi.mock("../../../core/nav", () => ({ nav: { pushLayer: () => () => {} } }));
let size = { width: 200, height: 100 };
let exportBlob: BlobCallback;
const paints: { op: string; points: number[][] }[] = [];
function pointer(target: Element, type: string, x: number, y: number, id = 1) {
 const event = new Event(type, { bubbles: true });
 Object.defineProperties(event, Object.fromEntries(Object.entries({ pointerId: id, clientX: x, clientY: y }).map(([key, value]) => [key, { value }])));
 fireEvent(target, event);
}
beforeEach(() => {
 size = { width: 200, height: 100 }; paints.length = 0;
 vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
 vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(() => size.width);
 vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => size.height);
 vi.spyOn(HTMLCanvasElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLCanvasElement) {
  return { x: 0, y: 0, left: 0, top: 0, right: Number.parseFloat(this.style.width), bottom: Number.parseFloat(this.style.height), width: Number.parseFloat(this.style.width), height: Number.parseFloat(this.style.height), toJSON() {} };
 });
 let points: number[][] = [];
 const context = { globalCompositeOperation: "source-over", save() {}, restore() {}, setTransform() {}, scale() {}, clearRect() { paints.length = 0; },
  beginPath() { points = []; }, moveTo(x: number, y: number) { points.push([x, y]); }, lineTo(x: number, y: number) { points.push([x, y]); }, arc(x: number, y: number) { points.push([x, y]); },
  stroke() { paints.push({ op: this.globalCompositeOperation, points: [...points] }); }, fill() { paints.push({ op: this.globalCompositeOperation, points: [...points] }); }, fillRect() {} };
 vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
 vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => { exportBlob = callback; });
 Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("mobile sketch interaction", () => {
 it("replays eraser strokes after resize and undo restores the original ink", () => {
  render(<SketchPad open onClose={() => {}} onDone={() => {}} />);
  const canvas = document.querySelector("canvas")!;
  pointer(canvas, "pointerdown", 20, 20); pointer(canvas, "pointermove", 80, 20); pointer(canvas, "pointerup", 80, 20);
  fireEvent.click(screen.getByRole("button", { name: "橡皮擦" }));
  pointer(canvas, "pointerdown", 40, 20); pointer(canvas, "pointermove", 60, 20); pointer(canvas, "pointerup", 60, 20);
  expect(paints.map(p => p.op)).toEqual(["source-over", "destination-out"]);
  size = { width: 400, height: 400 }; fireEvent(window, new Event("resize"));
  expect(paints).toEqual([{ op: "source-over", points: [[20, 20], [80, 20]] }, { op: "destination-out", points: [[40, 20], [60, 20]] }]);
  fireEvent.click(screen.getByRole("button", { name: "撤销" }));
  expect(paints).toEqual([{ op: "source-over", points: [[20, 20], [80, 20]] }]);
 });

 it("keeps the partial canceled stroke but never attaches after overlay cancellation", () => {
  const done = vi.fn(); const close = vi.fn();
  const view = render(<SketchPad open onClose={close} onDone={done} />);
  const canvas = document.querySelector("canvas")!;
  pointer(canvas, "pointerdown", 20, 20); pointer(canvas, "pointermove", 40, 40); pointer(canvas, "pointercancel", 40, 40);
  pointer(canvas, "pointermove", 90, 90);
  expect(paints[0].points).toEqual([[20, 20], [40, 40]]);
  fireEvent.click(screen.getByRole("button", { name: "完成" }));
  fireEvent.click(screen.getByRole("button", { name: "取消" }));
  expect(close).toHaveBeenCalledOnce();
  view.rerender(<SketchPad open={false} onClose={close} onDone={done} />);
  exportBlob(new Blob(["fixture"], { type: "image/png" }));
  expect(done).not.toHaveBeenCalled();
 });
});
