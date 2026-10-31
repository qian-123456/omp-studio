// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTranscriptRefresh, type TranscriptRefresh } from "./transcriptRefresh";

const schedulers: TranscriptRefresh[] = [];
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
afterEach(() => { schedulers.splice(0).forEach((scheduler) => scheduler.dispose()); vi.useRealTimers(); });
const create = (fetch: (signal: AbortSignal) => Promise<{ running: boolean }>) => {
 const scheduler = createTranscriptRefresh({ fetch });
 schedulers.push(scheduler);
 return scheduler;
};

describe("transcript refresh lifecycle", () => {
 it("keeps making bounded progress through a continuous event stream", async () => {
  const starts: number[] = [];
  const scheduler = create(async () => { starts.push(Date.now()); return { running: true }; });
  scheduler.setVisible(true);
  await vi.advanceTimersByTimeAsync(0);
  for (let elapsed = 0; elapsed < 1800; elapsed += 100) { scheduler.notify(); await vi.advanceTimersByTimeAsync(100); }
  expect(starts).toEqual([0, 600, 1200, 1800]);
 });

 it("never overlaps requests and retains a single trailing read after in-flight events", async () => {
  let finish!: (result: { running: boolean }) => void;
  let active = 0; let maxActive = 0;
  const starts: number[] = [];
  const scheduler = create(async () => {
   active++; maxActive = Math.max(maxActive, active); starts.push(Date.now());
   // ES2021 target does not expose Promise.withResolvers.
   const result = await new Promise<{ running: boolean }>((resolve) => { finish = resolve; });
   active--; return result;
  });
  scheduler.setVisible(true);
  await vi.advanceTimersByTimeAsync(0);
  scheduler.notify(); scheduler.notify(); void scheduler.refresh();
  await vi.advanceTimersByTimeAsync(1000);
  expect(starts).toEqual([0]);
  finish({ running: true });
  await vi.advanceTimersByTimeAsync(0);
  expect(starts).toEqual([0, 1000]);
  expect(maxActive).toBe(1);
  finish({ running: true });
  await vi.advanceTimersByTimeAsync(0);
 });

 it("takes a final tail read after running becomes terminal and stops fallback", async () => {
  const states = [true, false, false];
  const fetch = vi.fn(async () => ({ running: states.shift() ?? false }));
  const scheduler = create(fetch);
  scheduler.setVisible(true); await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(600); scheduler.notify();
  await vi.advanceTimersByTimeAsync(0);
  expect(fetch).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(600);
  expect(fetch).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(15000);
  expect(fetch).toHaveBeenCalledTimes(3);
 });

 it("polls only while visible and running, aborting owned work on hide and disposal", async () => {
  const signals: AbortSignal[] = [];
  const scheduler = create(async (signal) => { signals.push(signal); return { running: true }; });
  await vi.advanceTimersByTimeAsync(10000); expect(signals).toHaveLength(0);
  scheduler.setVisible(true); await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(5000); expect(signals).toHaveLength(2);
  scheduler.setVisible(false); scheduler.notify();
  await vi.advanceTimersByTimeAsync(15000); expect(signals).toHaveLength(2);
  scheduler.setVisible(true); await vi.advanceTimersByTimeAsync(0); expect(signals).toHaveLength(3);
  scheduler.dispose(); scheduler.notify(); void scheduler.refresh();
  await vi.advanceTimersByTimeAsync(15000); expect(signals).toHaveLength(3);
 });

 it("aborts pending fetches and ignores their late completion after hide", async () => {
  let finish!: (result: { running: boolean }) => void;
  const signals: AbortSignal[] = [];
  const scheduler = create((signal) => {
   signals.push(signal);
   // ES2021 target does not expose Promise.withResolvers.
   return new Promise<{ running: boolean }>((resolve) => { finish = resolve; });
  });
  scheduler.setVisible(true); await vi.advanceTimersByTimeAsync(0);
  scheduler.notify(); scheduler.setVisible(false);
  expect(signals[0].aborted).toBe(true);
  finish({ running: true }); await vi.advanceTimersByTimeAsync(10000);
  expect(signals).toHaveLength(1);
  scheduler.setVisible(true); await vi.advanceTimersByTimeAsync(0);
  scheduler.dispose(); expect(signals[1].aborted).toBe(true);
  finish({ running: false }); await vi.advanceTimersByTimeAsync(0);
 });
});
