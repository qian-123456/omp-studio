// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("right tab persistence", () => {
	beforeEach(() => {
		localStorage.clear();
		vi.resetModules();
	});

	it("never restores per-instance groups (sidechat/files) as ghost tabs", async () => {
		localStorage.setItem(
			"ompws:right-by-session",
			JSON.stringify({ "": { open: true, tabs: ["git", "sidechat", "files", "terminal"], at: Date.now() } }),
		);
		const { useUi } = await import("./ui");
		expect(useUi.getState().openRightTabs).toEqual(["git", "terminal"]);
	});

	it("does not persist instance groups", async () => {
		const { useUi } = await import("./ui");
		useUi.getState().setRightTab("git");
		useUi.getState().setRightTab("sidechat");
		expect(JSON.parse(localStorage.getItem("ompws:right-by-session") ?? "{}")[""].tabs).toEqual(["git"]);
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
		expect(localStorage.getItem("ompws:right-by-session")).toBe("{}");
	});

	it("a session never opened before starts closed with no tabs", async () => {
		const { useUi } = await import("./ui");
		useUi.getState().selectSession("a");
		useUi.getState().setRightTab("git");
		useUi.getState().selectSession("b");
		expect(useUi.getState().rightOpen).toBe(false);
		expect(useUi.getState().openRightTabs).toEqual([]);
		expect(useUi.getState().rightTab).toBeNull();
	});

	it("remembers open state and tabs independently per session", async () => {
		const { useUi } = await import("./ui");
		useUi.getState().selectSession("a");
		useUi.getState().setRightTab("git");
		useUi.getState().selectSession("b");
		useUi.getState().setRightTab("terminal");
		useUi.getState().toggleRight(); // collapse b
		useUi.getState().selectSession("a");
		expect(useUi.getState().openRightTabs).toEqual(["git"]);
		expect(useUi.getState().rightTab).toBe("git");
		expect(useUi.getState().rightOpen).toBe(true);
		useUi.getState().selectSession("b");
		expect(useUi.getState().openRightTabs).toEqual(["terminal"]);
		expect(useUi.getState().rightOpen).toBe(false);
	});

	it("restores per-session memory on the next launch, with no active tab", async () => {
		let m = await import("./ui");
		m.useUi.getState().selectSession("a");
		m.useUi.getState().setRightTab("git");
		m.useUi.getState().selectSession("b");
		m.useUi.getState().setRightTab("terminal");
		vi.resetModules();
		m = await import("./ui");
		m.useUi.getState().selectSession("a");
		expect(m.useUi.getState().openRightTabs).toEqual(["git"]);
		expect(m.useUi.getState().rightOpen).toBe(true);
		expect(m.useUi.getState().rightTab).toBeNull();
		m.useUi.getState().selectSession("b");
		expect(m.useUi.getState().openRightTabs).toEqual(["terminal"]);
	});

	it("the new-session placeholder hands its panel to the session it becomes", async () => {
		const { useUi } = await import("./ui");
		useUi.setState({ selectedSessionId: null, centerView: "session" });
		useUi.getState().setRightTab("git");
		useUi.getState().selectSession("fresh");
		expect(useUi.getState().openRightTabs).toEqual(["git"]);
		expect(useUi.getState().rightOpen).toBe(true);
		// The home view must not keep the placeholder's panel.
		useUi.getState().leaveSession();
		expect(useUi.getState().rightOpen).toBe(false);
		expect(useUi.getState().openRightTabs).toEqual([]);
	});

	it("drops the pre-per-session global keys", async () => {
		localStorage.setItem("ompws:right-open", "true");
		localStorage.setItem("ompws:right-tabs", JSON.stringify(["git"]));
		localStorage.setItem("ompws:right-by-mode", JSON.stringify({ code: { open: true, tabs: ["git"] } }));
		const { useUi } = await import("./ui");
		expect(useUi.getState().rightOpen).toBe(false);
		expect(useUi.getState().openRightTabs).toEqual([]);
		expect(localStorage.getItem("ompws:right-by-mode")).toBeNull();
	});

	it("forgets a session's panel state after 30 days, keeps it before", async () => {
		const day = 24 * 60 * 60 * 1000;
		const now = Date.now();
		localStorage.setItem(
			"ompws:right-by-session",
			JSON.stringify({
				old: { open: true, tabs: ["git"], at: now - 31 * day },
				recent: { open: true, tabs: ["terminal"], at: now - 29 * day },
			}),
		);
		const { useUi } = await import("./ui");
		useUi.getState().selectSession("old");
		expect(useUi.getState().openRightTabs).toEqual([]);
		expect(useUi.getState().rightOpen).toBe(false);
		useUi.getState().selectSession("recent");
		expect(useUi.getState().openRightTabs).toEqual(["terminal"]);
	});

	it("drops expired entries from storage on the next write", async () => {
		const day = 24 * 60 * 60 * 1000;
		vi.useFakeTimers();
		try {
			const { useUi } = await import("./ui");
			useUi.getState().selectSession("a");
			useUi.getState().setRightTab("git");
			useUi.getState().selectSession("b");
			vi.setSystemTime(Date.now() + 31 * day);
			useUi.getState().setRightTab("terminal");
			const stored = JSON.parse(localStorage.getItem("ompws:right-by-session") ?? "{}");
			expect(Object.keys(stored)).toEqual(["b"]);
		} finally {
			vi.useRealTimers();
		}
	});
});
