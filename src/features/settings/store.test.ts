import { describe, expect, it, vi } from "vitest";
import type { Settings } from "../../lib/contracts";
import * as ipc from "../../lib/ipc";
import { useSettings } from "./store";

const mockSettings: Settings = {
	systemDetection: true,
	supervisorEnabled: false,
	supervisorModel: "smol",
	smartContextRouting: false,
	idleSuspendMinutes: 15,
	defaultApprovalMode: "write",
	ompBinary: "omp",
	notifyTurnEnd: true,
	notifyApproval: true,
	notifyExit: true,
	notifySound: false,
	capsuleVisible: true,
	mobileEnabled: false,
	mobilePort: 7788,
	tunnelMode: "off",
	tunnelName: null,
	tunnelHostname: null,
	quickCaptureShortcut: "CommandOrControl+Shift+I",
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
		const p2 = useSettings.getState().update({ supervisorEnabled: true });

		await expect(Promise.all([p1, p2])).rejects.toThrow("Disk full");

		// Should have rolled back to the last confirmed settings
		const current = useSettings.getState().settings;
		expect(current?.systemDetection).toBe(false);
		expect(current?.supervisorEnabled).toBe(false);
		expect(useSettings.getState().error).toContain("Disk full");

		saveSpy.mockRestore();
	});
});
