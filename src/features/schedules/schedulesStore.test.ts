import { beforeEach, describe, expect, it, vi } from "vitest";

const { listSchedules, deleteSchedule } = vi.hoisted(() => ({
	listSchedules: vi.fn(),
	deleteSchedule: vi.fn(),
}));

vi.mock("../../lib/events", () => ({ onSchedulesChanged: vi.fn(async () => () => {}) }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../lib/ipc", () => ({
	listSchedules,
	deleteSchedule,
	listScheduleRuns: vi.fn(),
	runScheduleNow: vi.fn(),
	saveSchedule: vi.fn(),
	setScheduleEnabled: vi.fn(),
}));

import { useSchedulesStore } from "./schedulesStore";

describe("schedulesStore", () => {
	beforeEach(() => {
		listSchedules.mockReset();
		deleteSchedule.mockReset();
		useSchedulesStore.setState({ schedules: [], runs: {}, loadError: null });
	});

	it("records the full load error and clears it on a later success", async () => {
		listSchedules.mockRejectedValueOnce(new Error("config.json locked: /a/very/long/path"));
		await useSchedulesStore.getState().load();
		expect(useSchedulesStore.getState().loadError).toBe("config.json locked: /a/very/long/path");
		expect(useSchedulesStore.getState().loading).toBe(false);

		listSchedules.mockResolvedValueOnce([]);
		await useSchedulesStore.getState().load();
		expect(useSchedulesStore.getState().loadError).toBeNull();
	});

	it("drops the run history of a removed schedule", async () => {
		useSchedulesStore.setState({
			schedules: [{ id: "a" }, { id: "b" }] as never,
			runs: { a: [], b: [] },
		});
		deleteSchedule.mockResolvedValue(undefined);
		await useSchedulesStore.getState().removeSchedule("a");
		expect(Object.keys(useSchedulesStore.getState().runs)).toEqual(["b"]);
	});
});
