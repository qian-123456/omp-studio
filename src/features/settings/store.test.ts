import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import { _resetSettingsStore, DEFAULT_SETTINGS, useSettings } from "./store";

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
});
