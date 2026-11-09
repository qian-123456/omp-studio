import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import type { Settings } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import { captureDiagnosticError, recordDiagnostic, setDiagnosticsEnabled } from "../../lib/diagnostics";
import { _resetSettingsStore, DEFAULT_SETTINGS, useSettings } from "./store";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

beforeEach(() => {
	_resetSettingsStore();
	useSettings.setState({ settings: null, error: null });
	vi.useFakeTimers();
	vi.stubGlobal("document", {});
	vi.mocked(invoke).mockReset().mockResolvedValue({ status: "accepted", accepted: 20 });
});

afterEach(() => {
	setDiagnosticsEnabled(false);
	vi.useRealTimers();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function recordObservation(removedRows: number): void {
	recordDiagnostic({ event: "frontend.state_reconciled", source: "state_reconcile", occurredAt: new Date().toISOString(), removedRows });
}

function diagnosticBatches() {
	return vi.mocked(invoke).mock.calls.filter(([command]) => command === "diagnostics_record").map(([, args]) => args);
}

const mockSettings: Settings = {
	...DEFAULT_SETTINGS,
	defaultApprovalMode: "write",
};

describe("settings store", () => {
	it("serializes concurrent updates and rolls back to confirmed state on error", async () => {
		useSettings.setState({ settings: { ...mockSettings }, error: null });

		let callCount = 0;
		const saveSpy = vi.spyOn(ipc, "saveSettings").mockImplementation(async (target) => {
			callCount++;
			if (callCount === 2) {
				throw new Error("Disk full");
			}
			return { ...target };
		});

		// Call update twice concurrently
		const p1 = useSettings.getState().update({ systemDetection: false });
		const p2 = useSettings.getState().update({ dockBadgeEnabled: false });

		await expect(Promise.all([p1, p2])).rejects.toThrow("Disk full");

		// Should have rolled back to the last confirmed settings
		const current = useSettings.getState().settings;
		expect(current?.systemDetection).toBe(false);
		expect(current?.dockBadgeEnabled).toBe(true);
		expect(useSettings.getState().error).toContain("Disk full");

		saveSpy.mockRestore();
	});

	it("rolls back only the failed update when A fails and B succeeds", async () => {
		_resetSettingsStore();
		useSettings.setState({ settings: { ...mockSettings }, error: null });

		let callCount = 0;
		const saveSpy = vi.spyOn(ipc, "saveSettings").mockImplementation(async (target) => {
			callCount++;
			if (callCount === 1) {
				throw new Error("Update A failed");
			}
			return { ...target };
		});

		// Call update A and update B concurrently
		const p1 = useSettings.getState().update({ systemDetection: false });
		const p2 = useSettings.getState().update({ dockBadgeEnabled: false });

		await expect(p1).rejects.toThrow("Update A failed");
		await expect(p2).resolves.toBeUndefined();

		const current = useSettings.getState().settings;
		// A should have rolled back to initial (true), B should remain applied (true)
		expect(current?.systemDetection).toBe(true);
		expect(current?.dockBadgeEnabled).toBe(false);

		saveSpy.mockRestore();
	});

	it("loads a saved-false preference without emitting startup or disabled observations", async () => {
		vi.spyOn(ipc, "getSettings").mockResolvedValue({ ...mockSettings, diagnosticsEnabled: false });
		vi.spyOn(ipc, "saveSettings").mockImplementation(async (target) => ({ ...target }));
		recordObservation(1);
		await useSettings.getState().load();
		recordObservation(2);
		captureDiagnosticError("bootstrap", new Error("disabled"));
		await vi.runAllTimersAsync();
		expect(diagnosticBatches()).toEqual([]);
		await useSettings.getState().update({ diagnosticsEnabled: true });
		recordObservation(3);
		await vi.runAllTimersAsync();
		expect(diagnosticBatches()).toEqual([{ events: [expect.objectContaining({ removedRows: 3 })], droppedEvents: 0 }]);
	});

	it("stops immediately for an optimistic off and restores future recording after a failed save", async () => {
		vi.spyOn(ipc, "getSettings").mockResolvedValue({ ...mockSettings });
		let rejectSave!: (error: Error) => void;
		// The app targets ES2021, where Promise.withResolvers is not available.
		vi.spyOn(ipc, "saveSettings").mockReturnValue(new Promise<Settings>((_, reject) => { rejectSave = reject; }));
		await useSettings.getState().load();
		const unsubscribe = useSettings.subscribe((state, previous) => {
			if (state.settings?.diagnosticsEnabled !== previous.settings?.diagnosticsEnabled) recordObservation(99);
		});
		recordObservation(1);
		const saving = useSettings.getState().update({ diagnosticsEnabled: false });
		unsubscribe();
		expect(useSettings.getState().settings?.diagnosticsEnabled).toBe(false);
		recordObservation(2);
		await vi.runAllTimersAsync();
		expect(diagnosticBatches()).toEqual([]);
		const rejected = expect(saving).rejects.toThrow("Disk full");
		rejectSave(new Error("Disk full"));
		await rejected;
		expect(useSettings.getState().settings?.diagnosticsEnabled).toBe(true);
		recordObservation(3);
		await vi.runAllTimersAsync();
		expect(diagnosticBatches()).toEqual([{ events: [expect.objectContaining({ removedRows: 3 })], droppedEvents: 0 }]);
	});

	it("discards optimistic enable observations when a failed save rolls back to saved-false", async () => {
		vi.spyOn(ipc, "getSettings").mockResolvedValue({ ...mockSettings, diagnosticsEnabled: false });
		vi.spyOn(ipc, "saveSettings").mockRejectedValue(new Error("Disk full"));
		await useSettings.getState().load();
		const saving = useSettings.getState().update({ diagnosticsEnabled: true });
		recordObservation(1);
		await expect(saving).rejects.toThrow("Disk full");
		expect(useSettings.getState().settings?.diagnosticsEnabled).toBe(false);
		recordObservation(2);
		await vi.runAllTimersAsync();
		expect(diagnosticBatches()).toEqual([]);
	});

	it.each(["before", "after"] as const)("ignores an old reload resolved %s the off save succeeds", async (order) => {
		let resolveReload!: (settings: Settings) => void;
		let confirmOff!: () => void;
		// The app targets ES2021, where Promise.withResolvers is not available.
		const oldReload = new Promise<Settings>((resolve) => { resolveReload = resolve; });
		const getSpy = vi.spyOn(ipc, "getSettings")
			.mockResolvedValueOnce({ ...mockSettings })
			.mockReturnValueOnce(oldReload);
		const saveSpy = vi.spyOn(ipc, "saveSettings")
			.mockImplementation(async (target) => ({ ...target }))
			.mockImplementationOnce((target) => new Promise<Settings>((resolve) => {
				confirmOff = () => resolve({ ...target });
			}));
		await useSettings.getState().load();
		const reloading = useSettings.getState().load();
		await Promise.resolve();
		expect(getSpy).toHaveBeenCalledTimes(2);
		const saving = useSettings.getState().update({ diagnosticsEnabled: false });
		await Promise.resolve();
		expect(saveSpy.mock.calls[0][0].diagnosticsEnabled).toBe(false);
		if (order === "before") {
			resolveReload({ ...mockSettings });
			await reloading;
			expect(useSettings.getState().settings?.diagnosticsEnabled).toBe(false);
			recordObservation(1);
			await vi.runAllTimersAsync();
			expect(diagnosticBatches()).toEqual([]);
			confirmOff();
			await saving;
		} else {
			confirmOff();
			await saving;
			resolveReload({ ...mockSettings });
			await reloading;
		}
		expect(useSettings.getState().settings?.diagnosticsEnabled).toBe(false);
		recordObservation(2);
		await vi.runAllTimersAsync();
		expect(diagnosticBatches()).toEqual([]);
		await useSettings.getState().update({ dockBadgeEnabled: false });
		expect(saveSpy.mock.calls[1][0]).toMatchObject({ diagnosticsEnabled: false, dockBadgeEnabled: false });
		expect(useSettings.getState().settings?.diagnosticsEnabled).toBe(false);
		recordObservation(3);
		await vi.runAllTimersAsync();
		expect(diagnosticBatches()).toEqual([]);
	});
});
