// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("right tab persistence", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it("never restores per-instance groups (sidechat/files) as ghost tabs", async () => {
		localStorage.setItem("ompws:right-tabs", JSON.stringify(["git", "sidechat", "files", "terminal"]));
		const { useUi } = await import("./ui");
		expect(useUi.getState().openRightTabs).toEqual(["git", "terminal"]);
	});

	it("does not persist instance groups", async () => {
		const { useUi } = await import("./ui");
		useUi.getState().setRightTab("git");
		useUi.getState().setRightTab("sidechat");
		expect(JSON.parse(localStorage.getItem("ompws:right-tabs") ?? "[]")).toEqual(["git"]);
		expect(localStorage.getItem("ompws:right-tab")).toBe("");
	});

	it("closing the active tab activates the right neighbour, else the left", async () => {
		const { useUi } = await import("./ui");
		for (const t of ["git", "explorer", "plan"] as const) useUi.getState().setRightTab(t);
		useUi.getState().setRightTab("explorer");
		useUi.getState().closeRightTab("explorer");
		expect(useUi.getState().rightTab).toBe("plan");
		useUi.getState().closeRightTab("plan");
		expect(useUi.getState().rightTab).toBe("git");
	});
});
