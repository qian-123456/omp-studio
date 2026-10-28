// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transcript: vi.fn(), diagnose: vi.fn() }));
vi.mock("../../lib/ipc", () => ({ getTranscript: mocks.transcript, heatmapDiagnose: mocks.diagnose }));
// Hoisted mock factories must load zustand before this test module's imports initialize.
vi.mock("../../stores/sessions", async () => {
 const { create } = await import("zustand");
 return { useSessions: create(() => ({ sessions: {} })) };
});
vi.mock("../../stores/live", async () => {
 const { create } = await import("zustand");
 return { useLive: create(() => ({ sessions: {} })) };
});
vi.mock("../settings/store", async () => {
 const { create } = await import("zustand");
 return { useSettings: create(() => ({ settings: {} })) };
});
import { useSessions } from "../../stores/sessions";
import { useSettings } from "../settings/store";
import { useDoctor, useDoctorAutoScheduler } from "./doctorStore";

const meta = (id: string, ageHours: number) => ({ id, updatedAt: new Date(Date.now() - ageHours * 3_600_000).toISOString(), status: "idle", attention: "none" });
beforeEach(() => {
 vi.useFakeTimers();
 vi.setSystemTime(new Date("2026-10-29T12:00:00Z"));
 localStorage.clear();
 useDoctor.setState({ bySession: {}, history: [], attemptedActivity: {} });
 useSessions.setState({ sessions: { newer: meta("newer", 3), older: meta("older", 5) } as never });
 useSettings.setState({ settings: { doctorAutoMode: "idle", doctorIdleMinutes: 30 } as never });
 mocks.transcript.mockReset().mockRejectedValue(new Error("transcript unavailable"));
 mocks.diagnose.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("automatic doctor failure lifecycle", () => {
 it("attempts each unchanged session once and reaches older sessions after a failure", async () => {
  renderHook(() => useDoctorAutoScheduler());
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
  expect(mocks.transcript.mock.calls.map(([id]) => id)).toEqual(["newer", "older"]);
  expect(useDoctor.getState().bySession.newer.status).toBe("error");
  expect(useDoctor.getState().bySession.older.status).toBe("error");
  expect(JSON.parse(localStorage.getItem("omp.doctor.attemptedActivity") ?? "{}")).toEqual(useDoctor.getState().attemptedActivity);
 });

 it("allows manual retry without new activity", async () => {
  renderHook(() => useDoctorAutoScheduler());
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await useDoctor.getState().runDiagnosis("newer", "cost"); });
  expect(mocks.transcript.mock.calls.map(([id]) => id)).toEqual(["newer", "newer"]);
 });

 it("allows automatic diagnosis after new activity and another idle period", async () => {
  renderHook(() => useDoctorAutoScheduler());
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  const sessions = useSessions.getState().sessions;
  act(() => { useSessions.setState({ sessions: { ...sessions, newer: { ...sessions.newer, updatedAt: new Date(Date.now()).toISOString() } } }); });
  await act(async () => { await vi.advanceTimersByTimeAsync(31 * 60_000); });
  expect(mocks.transcript.mock.calls.map(([id]) => id)).toEqual(["newer", "older", "newer"]);
 });

 it("keeps failed activity watermarks after scheduler remount", async () => {
  const hook = renderHook(() => useDoctorAutoScheduler());
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  hook.unmount();
  renderHook(() => useDoctorAutoScheduler());
  await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
  expect(mocks.transcript).toHaveBeenCalledTimes(2);
 });

 it("does not diagnose concurrently when a manual diagnosis is already running", async () => {
  let fail!: (reason: Error) => void;
  mocks.transcript.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const manual = useDoctor.getState().runDiagnosis("newer", "cost");
  renderHook(() => useDoctorAutoScheduler());
  await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
  expect(mocks.transcript).toHaveBeenCalledTimes(1);
  await act(async () => { fail(new Error("failed")); await manual; await vi.advanceTimersByTimeAsync(60_000); });
  expect(mocks.transcript.mock.calls.map(([id]) => id)).toEqual(["newer", "older"]);
 });

 it("loads persisted failed-activity watermarks after application reload", async () => {
  await useDoctor.getState().runDiagnosis("newer", "cost");
  const attempted = useDoctor.getState().attemptedActivity;
  // Intentionally reload module initialization to exercise persisted state hydration.
  vi.resetModules();
  const reloaded = await import("./doctorStore");
  expect(reloaded.useDoctor.getState().attemptedActivity).toEqual(attempted);
 });
});
