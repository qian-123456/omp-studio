// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("right tab persistence", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it("never restores per-instance groups (sidechat/files) as ghost tabs", async () => {
		localStorage.setItem(
			"ompws:right-by-mode",
			JSON.stringify({ code: { open: true, tabs: ["git", "sidechat", "files", "terminal"] } }),
		);
		const { useUi } = await import("./ui");
		expect(useUi.getState().openRightTabs).toEqual(["git", "terminal"]);
	});

	it("does not persist instance groups", async () => {
		const { useUi } = await import("./ui");
		useUi.getState().setRightTab("git");
		useUi.getState().setRightTab("sidechat");
		expect(JSON.parse(localStorage.getItem("ompws:right-by-mode") ?? "{}").code.tabs).toEqual(["git"]);
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

	it("closing the last tab collapses the whole panel; closing a non-last tab keeps it open", async () => {
		const { useUi } = await import("./ui");
		useUi.getState().setRightTab("git");
		useUi.getState().setRightTab("plan");
		useUi.getState().closeRightTab("plan");
		expect(useUi.getState().rightOpen).toBe(true);
		useUi.getState().closeRightTab("git");
		expect(useUi.getState().rightOpen).toBe(false);
		expect(useUi.getState().rightTab).toBeNull();
		expect(JSON.parse(localStorage.getItem("ompws:right-by-mode") ?? "{}").code.open).toBe(false);
	});

	it("seeds the Code area from the legacy global keys; other areas start closed", async () => {
		localStorage.setItem("ompws:right-open", "true");
		localStorage.setItem("ompws:right-tabs", JSON.stringify(["git"]));
		const { useUi } = await import("./ui");
		const { useSidebarStore } = await import("../features/sessions/sidebarStore");
		expect(useUi.getState().rightOpen).toBe(true);
		expect(useUi.getState().openRightTabs).toEqual(["git"]);
		useSidebarStore.getState().setActiveMode("chat");
		expect(useUi.getState().rightOpen).toBe(false);
		expect(useUi.getState().openRightTabs).toEqual([]);
		expect(useUi.getState().rightTab).toBeNull();
	});

	it("remembers open state and tabs independently per area", async () => {
		const { useUi } = await import("./ui");
		const { useSidebarStore } = await import("../features/sessions/sidebarStore");
		const sidebar = useSidebarStore.getState();
		sidebar.setActiveMode("code");
		useUi.getState().setRightTab("git");
		sidebar.setActiveMode("chat");
		expect(useUi.getState().openRightTabs).toEqual([]);
		expect(useUi.getState().rightOpen).toBe(false);
		useUi.getState().setRightTab("terminal");
		sidebar.setActiveMode("code");
		expect(useUi.getState().openRightTabs).toEqual(["git"]);
		expect(useUi.getState().rightTab).toBe("git");
		expect(useUi.getState().rightOpen).toBe(true);
		useUi.getState().toggleRight();
		sidebar.setActiveMode("chat");
		expect(useUi.getState().openRightTabs).toEqual(["terminal"]);
		expect(useUi.getState().rightOpen).toBe(true);
		sidebar.setActiveMode("code");
		expect(useUi.getState().rightOpen).toBe(false);
	});

	it("restores per-area memory on the next launch", async () => {
		let m = await import("./ui");
		const sb = await import("../features/sessions/sidebarStore");
		m.useUi.getState().setRightTab("git");
		sb.useSidebarStore.getState().setActiveMode("chat");
		m.useUi.getState().setRightTab("terminal");
		vi.resetModules();
		m = await import("./ui");
		expect(m.useUi.getState().openRightTabs).toEqual(["terminal"]);
		sb.useSidebarStore.getState().setActiveMode("code");
	});
});
