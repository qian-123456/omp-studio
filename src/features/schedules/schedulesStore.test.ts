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

import { toast } from "../../lib/toast";
import { useSchedulesStore } from "./schedulesStore";

describe("schedulesStore", () => {
	beforeEach(() => {
		listSchedules.mockReset();
		deleteSchedule.mockReset();
		vi.mocked(toast.error).mockClear();
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

	it("keeps an active schedule and history when deletion is refused, showing the reason", async () => {
		const schedules = [{ id: "active" }] as never;
		const runs = { active: [] };
		useSchedulesStore.setState({ schedules, runs });
		deleteSchedule.mockRejectedValueOnce("任务仍在运行，请结束后再删除");
		await useSchedulesStore.getState().removeSchedule("active");
		expect(useSchedulesStore.getState().schedules).toBe(schedules);
		expect(useSchedulesStore.getState().runs).toBe(runs);
		expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("任务仍在运行，请结束后再删除"));
	});
});
