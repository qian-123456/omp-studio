// Reproduction evidence for AiDoctor.tla FailedNotRetried / NoStarvation. Drives the real hook useDoctorAutoScheduler.
import { renderHook } from "<repo>/node_modules/@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const calls: string[] = [];
vi.mock("<repo>/src/lib/ipc", () => ({
	getTranscript: vi.fn(async () => { throw new Error("transcript unavailable"); }),
	heatmapDiagnose: vi.fn(async () => { throw new Error("model failed"); }),
}));
import { useDoctor, useDoctorAutoScheduler } from "<repo>/src/features/heatmap/doctorStore";
import { useSettings } from "<repo>/src/features/settings/store";
import { useSessions } from "<repo>/src/stores/sessions";
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => vi.useRealTimers());
it("failed newest idle session is retried every minute and the older one is never reached", async () => {
	const now = Date.now();
	const mk = (id: string, ago: number) => ({ id, updatedAt: new Date(now - ago).toISOString(), status: "idle", attention: "none" }) as any;
	useSessions.setState({ sessions: { A: mk("A", 3 * 3600e3), B: mk("B", 5 * 3600e3) } } as any);
	useSettings.setState({ settings: { doctorAutoMode: "idle", doctorIdleMinutes: 30 } } as any);
	const spy = vi.spyOn(useDoctor.getState(), "runDiagnosis");
	const orig = useDoctor.getState().runDiagnosis;
	useDoctor.setState({ runDiagnosis: async (id: string, l: any, q?: any) => { calls.push(id); return orig(id, l, q); } } as any);
	renderHook(() => useDoctorAutoScheduler());
	await vi.advanceTimersByTimeAsync(5 * 60_000 + 10);
	console.log("diagnosis attempts:", calls.join(","), "status:", JSON.stringify(Object.fromEntries(Object.entries(useDoctor.getState().bySession).map(([k, v]) => [k, v.status]))));
	expect(calls.filter((c) => c === "A").length).toBeGreaterThan(3);
	expect(calls).not.toContain("B");
});
