// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as apiModule from "../../core/api";
import { OmpSettingsGroup, type Omp } from "./OmpSettings";

const initial = { "retry.maxRetries": 0, "ask.timeout": 0 };
function Settings() {
 const [omp, setOmp] = useState<Omp>(initial);
 return <OmpSettingsGroup keys={Object.keys(initial)} omp={omp} onValue={(key, value) => setOmp(old => ({ ...old, [key]: value }))} />;
}
const increase = (label: string) => within(screen.getByRole("spinbutton", { name: label }).parentElement!).getByRole("button", { name: "增加" });
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("keyed OMP persistence", () => {
 it("coalesces rapid numeric commits to the latest value after 350ms", async () => {
  const request = vi.spyOn(apiModule, "api").mockResolvedValue({ value: 3 });
  render(<Settings />);
  for (let i=0; i<3; i++) fireEvent.click(increase("最多重试次数"));
  expect(request).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(349)); expect(request).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/left/settings/set", { key: "retry.maxRetries", value: 3 });
 });

 it("serializes a key while allowing another key and preserves the latest queued edit", async () => {
  const pending: { body: unknown; resolve: (result: { value: number }) => void }[] = [];
  const request = vi.spyOn(apiModule, "api").mockImplementation((_method, _path, body) => {
   // ES2021 target does not expose Promise.withResolvers.
   return new Promise(resolve => pending.push({ body, resolve }));
  });
  render(<Settings />);
  fireEvent.click(increase("最多重试次数"));
  await act(async () => vi.advanceTimersByTimeAsync(350));
  fireEvent.click(increase("最多重试次数")); fireEvent.click(increase("提问自动选择等待"));
  await act(async () => vi.advanceTimersByTimeAsync(350));
  expect(request).toHaveBeenCalledTimes(2);
  expect(pending[1].body).toEqual({ key: "ask.timeout", value: 10 });
  await act(async () => pending[0].resolve({ value: 1 }));
  expect(request).toHaveBeenLastCalledWith("POST", "/left/settings/set", { key: "retry.maxRetries", value: 2 });
  expect((screen.getByRole("spinbutton", { name: "最多重试次数" }) as HTMLInputElement).value).toBe("2");
  await act(async () => { pending[1].resolve({ value: 10 }); pending[2].resolve({ value: 2 }); });
 });

 it("flushes on page exit and restores the last confirmed value on latest failure", async () => {
  const request = vi.spyOn(apiModule, "api").mockRejectedValue(new Error("cannot save\nfull detail"));
  render(<Settings />);
  fireEvent.click(increase("最多重试次数"));
  await act(async () => fireEvent(window, new Event("pagehide")));
  expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/left/settings/set", { key: "retry.maxRetries", value: 1 });
  expect(screen.getByRole("alert").textContent).toContain("cannot save\nfull detail");
  expect((screen.getByRole("spinbutton", { name: "最多重试次数" }) as HTMLInputElement).value).toBe("0");
 });
});
