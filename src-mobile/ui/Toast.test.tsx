// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, ToastHost } from "./Toast";

beforeEach(() => vi.useFakeTimers());
afterEach(async () => { await act(async () => vi.runAllTimersAsync()); cleanup(); vi.useRealTimers(); });

describe("actionable toast lifecycle", () => {
 it("keeps a pending action beyond expiry and prevents duplicate execution", async () => {
  let finish!: () => void;
  // ES2021 target does not expose Promise.withResolvers.
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  const action = vi.fn(() => pending);
  render(<ToastHost />);
  act(() => toast("Saved with undo", { ms: 100, action: { label: "撤销", onClick: action } }));
  const button = screen.getByRole("button", { name: "撤销" });
  fireEvent.click(button); fireEvent.click(button);
  expect(action).toHaveBeenCalledOnce();
  expect(button.hasAttribute("disabled")).toBe(true);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(screen.getByText("Saved with undo")).toBeTruthy();
  await act(async () => finish());
  expect(screen.queryByText("Saved with undo")).toBeNull();
 });

 it("shows the full asynchronous failure instead of claiming undo success", async () => {
  render(<ToastHost />);
  act(() => toast("Change saved", { action: { label: "撤销", onClick: async () => { throw new Error("Undo rejected\nserver detail"); } } }));
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "撤销" })));
  expect(screen.getByText((_, node) => node?.children.length === 0 && node.textContent?.includes("Undo rejected\nserver detail") === true)).toBeTruthy();
  expect(screen.queryByText("Change saved")).toBeNull();
 });
});
