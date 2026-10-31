// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomSheet } from "./BottomSheet";
import { ImageViewerHost, openImage } from "./ImageViewer";
import { CodeBlock } from "./CodeBlock";

vi.mock("../core/nav", () => ({ nav: { pushLayer: () => () => {} } }));

function pointer(target: Element, type: string, at: number, x: number, y: number, id = 1) {
 const event = new Event(type, { bubbles: true, cancelable: true });
 Object.defineProperties(event, Object.fromEntries(Object.entries({ pointerId: id, pointerType: "touch", button: 0, clientX: x, clientY: y, timeStamp: at }).map(([key, value]) => [key, { value }])));
 fireEvent(target, event);
}

beforeEach(() => {
 vi.useFakeTimers();
 vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
 vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
 Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: () => {} });
 Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: () => {} });
 Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", { configurable: true, value: () => true });
});
afterEach(() => {
 fireEvent.keyDown(document, { key: "Escape" });
 cleanup();
 vi.clearAllTimers();
 vi.useRealTimers();
 vi.unstubAllGlobals();
 vi.restoreAllMocks();
});

describe("sheet gesture lifecycle", () => {
 it("cancels a header drag without dismissal and reopens at its resting position", () => {
  const close = vi.fn();
  const view = render(<BottomSheet open title="手势面板" onClose={close}><p>正文</p></BottomSheet>);
  act(() => vi.advanceTimersByTime(40));
  const heading = screen.getByRole("heading", { name: "手势面板" });
  pointer(heading, "pointerdown", 1000, 150, 30);
  pointer(heading, "pointermove", 1200, 150, 150);
  pointer(heading, "pointercancel", 1210, 150, 150);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog").style.transform).toBe("");
  pointer(heading, "pointerdown", 2000, 150, 30);
  pointer(heading, "pointermove", 2200, 150, 100);
  view.rerender(<BottomSheet open={false} title="手势面板" onClose={close}><p>正文</p></BottomSheet>);
  view.rerender(<BottomSheet open title="手势面板" onClose={close}><p>正文</p></BottomSheet>);
  act(() => vi.advanceTimersByTime(40));
  expect(screen.getByRole("dialog").style.transform).toBe("");
  expect(screen.getByRole("dialog").style.transition).not.toBe("none");
 });
 it("does not drag the sheet from scrolling content", () => {
  const close = vi.fn();
  render(<BottomSheet open title="面板" onClose={close}><p>可滚动内容</p></BottomSheet>);
  const content = screen.getByText("可滚动内容");
  pointer(content, "pointerdown", 1000, 100, 100);
  pointer(content, "pointermove", 1100, 100, 280);
  pointer(content, "pointerup", 1200, 100, 280);
  expect(close).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog").style.transform).toBe("");
 });
});

describe("image gesture boundaries", () => {
 function open() {
  render(<ImageViewerHost/>);
  act(() => openImage({ src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", alt: "测试图片" }));
  act(() => vi.advanceTimersByTime(40));
  return screen.getByRole("img", { name: "测试图片" });
 }
 it("reserves double tap for zoom and single tap for chrome; cancel is never a tap", () => {
  const image = open();
  pointer(image, "pointerdown", 1000, 195, 422);
  pointer(image, "pointerup", 1050, 195, 422);
  expect(image.style.transform === "" || image.style.transform.includes("scale(1)")).toBe(true);
  pointer(image, "pointerdown", 1150, 195, 422);
  pointer(image, "pointerup", 1200, 195, 422);
  act(() => vi.advanceTimersByTime(350));
  expect(image.style.transform).toContain("scale(2.5)");
  expect(screen.getByRole("button", { name: "关闭" })).toBeTruthy();
  pointer(image, "pointerdown", 2000, 195, 422);
  pointer(image, "pointerup", 2050, 195, 422);
  act(() => vi.advanceTimersByTime(350));
  expect(image.style.transform).toContain("scale(2.5)");
  expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
  pointer(image, "pointerdown", 3000, 195, 422);
  pointer(image, "pointercancel", 3050, 195, 422);
  act(() => vi.advanceTimersByTime(350));
  expect(image.style.transform).toContain("scale(2.5)");
  expect(screen.queryByRole("button", { name: "关闭" })).toBeNull();
 });
 it("does not register a pinch as a tap and starts reopened images unzoomed", () => {
  const image = open();
  pointer(image, "pointerdown", 1000, 100, 200, 1);
  pointer(image, "pointerdown", 1010, 200, 200, 2);
  pointer(image, "pointermove", 1050, 900, 200, 2);
  expect(image.style.transform).toContain("scale(6)");
  pointer(image, "pointerup", 1100, 900, 200, 2);
  pointer(image, "pointerup", 1110, 100, 200, 1);
  expect(image.style.transform).toContain("scale(6)");
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
  act(() => vi.advanceTimersByTime(250));
  act(() => openImage({ src: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>", alt: "测试图片" }));
  act(() => vi.advanceTimersByTime(40));
  const reopened = screen.getByRole("img", { name: "测试图片" });
  expect(reopened.style.transform === "" || reopened.style.transform.includes("scale(1)")).toBe(true);
 });
});

describe("code copy payload", () => {
 it("copies the complete source rather than a highlighted or collapsed preview", async () => {
  const source = Array.from({ length: 80 }, (_, index) => 'const line' + index + ' = ' + index + ';').join("\n");
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("isSecureContext", true);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  render(<CodeBlock code={source} lang="typescript"><span>{source}</span></CodeBlock>);
  expect(screen.queryByText("const line79 = 79;")).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "复制代码" })); });
  expect(writeText).toHaveBeenCalledWith(source);
  fireEvent.click(screen.getByRole("button", { name: "展开全部 80 行" }));
  expect(screen.getByText("const line79 = 79;")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "收起" }));
  expect(screen.queryByText("const line79 = 79;")).toBeNull();
 });
});
