// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUi } from "../../stores/ui";
import {
	closeTabResult,
	isBlankTab,
	openNewSideChat,
	replaceTab,
	resolveActiveTab,
	revealSideChat,
	useSideChatView,
	withTab,
} from "./viewStore";

describe("side-chat tab helpers", () => {
	it("withTab appends once, keeping order", () => {
		expect(withTab(["a"], "b")).toEqual(["a", "b"]);
		expect(withTab(["a", "b"], "a")).toEqual(["a", "b"]);
	});

	it("closing the active tab activates the right neighbour, else left, else none", () => {
		expect(closeTabResult(["a", "b", "c"], "b", "b")).toEqual({ tabs: ["a", "c"], active: "c" });
		expect(closeTabResult(["a", "b"], "b", "b")).toEqual({ tabs: ["a"], active: "a" });
		expect(closeTabResult(["a"], "a", "a")).toEqual({ tabs: [], active: null });
	});

	it("closing an inactive tab keeps the active one", () => {
		expect(closeTabResult(["a", "b"], "a", "b")).toEqual({ tabs: ["a"], active: "a" });
	});

	it("replaceTab swaps in place and never duplicates", () => {
		expect(replaceTab(["a", "new:1", "c"], "new:1", "s1")).toEqual(["a", "s1", "c"]);
		expect(replaceTab(["a", "new:1", "s1"], "new:1", "s1")).toEqual(["a", "s1"]);
		expect(replaceTab(["a"], "new:1", "s1")).toEqual(["a", "s1"]);
	});

	it("resolveActiveTab falls back to the first open tab", () => {
		expect(resolveActiveTab(["a", "b"], "b")).toBe("b");
		expect(resolveActiveTab(["a", "b"], "gone")).toBe("a");
		expect(resolveActiveTab(["a"], undefined)).toBe("a");
		expect(resolveActiveTab(undefined, "a")).toBeNull();
	});
});

describe("useSideChatView", () => {
	beforeEach(() => {
		localStorage.clear();
		useSideChatView.setState({ openChild: {}, openTabs: {}, pending: {} });
		useUi.setState({ rightTab: null, openRightTabs: [], rightOpen: false });
	});

	it("keeps several threads open per parent and switches between them", () => {
		const v = useSideChatView.getState();
		v.setOpenChild("p1", "c1");
		v.setOpenChild("p1", "c2");
		v.setOpenChild("p2", "x1");
		const s = useSideChatView.getState();
		expect(s.openTabs).toEqual({ p1: ["c1", "c2"], p2: ["x1"] });
		expect(s.openChild).toEqual({ p1: "c2", p2: "x1" });
		v.setOpenChild("p1", "c1");
		expect(useSideChatView.getState().openChild["p1"]).toBe("c1");
	});

	it("closeTab removes only that tab and persists", () => {
		const v = useSideChatView.getState();
		v.setOpenChild("p1", "c1");
		v.setOpenChild("p1", "c2");
		v.closeTab("p1", "c2");
		const s = useSideChatView.getState();
		expect(s.openTabs["p1"]).toEqual(["c1"]);
		expect(s.openChild["p1"]).toBe("c1");
		expect(JSON.parse(localStorage.getItem("omp_sidechat_open_tabs") ?? "{}")).toEqual({ p1: ["c1"] });
	});

	it("closing the last tab closes the side-chat group of the right panel", () => {
		useUi.getState().setRightTab("explorer");
		useUi.getState().setRightTab("sidechat");
		useSideChatView.getState().setOpenChild("p1", "c1");
		useSideChatView.getState().closeTab("p1", "c1");
		expect(useSideChatView.getState().openTabs["p1"]).toBeUndefined();
		expect(useUi.getState().openRightTabs).toEqual(["explorer"]);
		expect(useUi.getState().rightTab).toBe("explorer");
	});

	it("revealSideChat expands a collapsed right panel on the side chat group", () => {
		useSideChatView.getState().setOpenChild("p1", "c1");
		revealSideChat();
		const ui = useUi.getState();
		expect(ui.rightOpen).toBe(true);
		expect(ui.rightTab).toBe("sidechat");
		// The open thread is kept.
		expect(useSideChatView.getState().openChild["p1"]).toBe("c1");
	});

	it("openNewSideChat adds an active blank tab and reveals the panel", () => {
		useSideChatView.getState().setOpenChild("p1", "c1");
		const id = openNewSideChat("p1");
		expect(isBlankTab(id)).toBe(true);
		const s = useSideChatView.getState();
		expect(s.openTabs["p1"]).toEqual(["c1", id]);
		expect(s.openChild["p1"]).toBe(id);
		expect(useUi.getState().rightTab).toBe("sidechat");
		expect(useUi.getState().rightOpen).toBe(true);
	});

	it("bindTab swaps the blank id for the session id in place, keeping it active", () => {
		const v = useSideChatView.getState();
		v.setOpenChild("p1", "c1");
		const id = v.openBlankTab("p1");
		v.setOpenChild("p1", "c1");
		v.bindTab("p1", id, "s9");
		let s = useSideChatView.getState();
		expect(s.openTabs["p1"]).toEqual(["c1", "s9"]);
		// Active tab was c1: untouched.
		expect(s.openChild["p1"]).toBe("c1");
		const id2 = s.openBlankTab("p1");
		s.bindTab("p1", id2, "s10");
		s = useSideChatView.getState();
		expect(s.openChild["p1"]).toBe("s10");
	});

	it("pending text is tracked per blank tab and cleared with null", () => {
		const v = useSideChatView.getState();
		v.setPending("new:a", "hello");
		expect(useSideChatView.getState().pending).toEqual({ "new:a": "hello" });
		v.setPending("new:a", null);
		expect(useSideChatView.getState().pending).toEqual({});
	});
});

describe("side-chat tab restore", () => {
	it("a reload restores real side chats but not blank (never created) tabs", async () => {
		localStorage.setItem("omp_sidechat_open_tabs", JSON.stringify({ p1: ["c1", "new:a0", "new:b1"], p2: ["new:c2"] }));
		localStorage.setItem("omp_sidechat_open_child", JSON.stringify({ p1: "new:b1", p2: "new:c2" }));
		vi.resetModules();
		const fresh = await import("./viewStore");
		const s = fresh.useSideChatView.getState();
		expect(s.openTabs).toEqual({ p1: ["c1"] });
		expect(s.openChild).toEqual({});
	});
});
