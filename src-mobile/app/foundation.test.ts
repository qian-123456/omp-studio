// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installViewportTracking } from "./viewport";
import { applyTheme } from "./theme";

afterEach(() => {
 vi.unstubAllGlobals();
 document.documentElement.removeAttribute("style");
 document.documentElement.removeAttribute("data-scheme");
 document.head.querySelectorAll('meta[name="theme-color"],meta[name="apple-mobile-web-app-status-bar-style"]').forEach(node => node.remove());
});

describe("viewport lifecycle", () => {
 it("coalesces viewport changes and cancels pending work on disposal", () => {
  const viewport = Object.assign(new EventTarget(), { height: 600, offsetTop: 12 });
  vi.stubGlobal("visualViewport", viewport);
  vi.stubGlobal("innerHeight", 844);
  let nextId = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { pending.set(++nextId, callback); return nextId; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => pending.delete(id));
  const root = document.documentElement;
  const dispose = installViewportTracking();
  expect(root.style.getPropertyValue("--m-vh")).toBe("600px");
  expect(root.style.getPropertyValue("--m-kb")).toBe("232px");
  expect(root.style.getPropertyValue("--m-vv-top")).toBe("12px");
  viewport.height = 500;
  viewport.dispatchEvent(new Event("resize"));
  viewport.dispatchEvent(new Event("scroll"));
  expect(pending.size).toBe(1);
  const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(16));
  expect(root.style.getPropertyValue("--m-vh")).toBe("500px");
  viewport.dispatchEvent(new Event("resize"));
  dispose();
  expect(pending.size).toBe(0);
  viewport.dispatchEvent(new Event("scroll"));
  expect(pending.size).toBe(0);
  for (const key of ["--m-vh", "--m-kb", "--m-vv-top"]) expect(root.style.getPropertyValue(key)).toBe("");
 });
 it("has a safe cleanup when VisualViewport is unavailable", () => {
  vi.stubGlobal("visualViewport", undefined);
  expect(() => installViewportTracking()()).not.toThrow();
 });
});

describe("theme browser chrome", () => {
 it("updates both schemes without duplicating metadata", () => {
  document.documentElement.style.setProperty("--m-bg", "#000000");
  applyTheme("dark");
  expect(document.documentElement.dataset.scheme).toBe("dark");
  expect(document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')?.content).toBe("black-translucent");
  document.documentElement.style.setProperty("--m-bg", "#ffffff");
  applyTheme("light");
  expect(document.documentElement.dataset.scheme).toBe("light");
  expect(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content).toBe("#ffffff");
  expect(document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')?.content).toBe("default");
  expect(document.querySelectorAll('meta[name="theme-color"]').length).toBe(1);
 });
 it("still sets the status bar when the color token is not available", () => {
  applyTheme("dark");
  expect(document.querySelector<HTMLMetaElement>('meta[name="apple-mobile-web-app-status-bar-style"]')?.content).toBe("black-translucent");
 });
});
