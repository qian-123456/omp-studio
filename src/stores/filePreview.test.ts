// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useUi } from "./ui";
import { useFilePreview } from "./filePreview";

describe("useFilePreview", () => {
	beforeEach(() => {
		localStorage.clear();
		useFilePreview.setState({ tabs: [], activePath: null });
		useUi.setState({ rightTab: null, openRightTabs: [], rightOpen: true });
	});

	it("opens a file as a preview tab and reveals the right panel", () => {
		useFilePreview.getState().openFile("/a/AGENTS.md", { cwd: "/a" });
		const s = useFilePreview.getState();
		expect(s.tabs).toEqual([{ path: "/a/AGENTS.md", cwd: "/a", mode: "preview" }]);
		expect(s.activePath).toBe("/a/AGENTS.md");
		expect(useUi.getState().rightTab).toBe("files");
		expect(useUi.getState().openRightTabs).toContain("files");
		expect(useUi.getState().rightOpen).toBe(true);
	});

	it("reuses an open tab instead of duplicating it", () => {
		const store = useFilePreview.getState();
		store.openFile("/a/x.ts");
		store.openFile("/a/y.ts");
		store.openFile("/a/x.ts", { mode: "edit" });
		const s = useFilePreview.getState();
		expect(s.tabs.map((t) => t.path)).toEqual(["/a/x.ts", "/a/y.ts"]);
		expect(s.tabs[0].mode).toBe("edit");
		expect(s.activePath).toBe("/a/x.ts");
	});

	it("activates the neighbour after closing the active tab", () => {
		const store = useFilePreview.getState();
		store.openFile("/a/x.ts");
		store.openFile("/a/y.ts");
		store.openFile("/a/z.ts");
		store.setActive("/a/y.ts");
		store.closeFile("/a/y.ts");
		expect(useFilePreview.getState().tabs.map((t) => t.path)).toEqual(["/a/x.ts", "/a/z.ts"]);
		expect(useFilePreview.getState().activePath).toBe("/a/z.ts");
	});

	it("closes the right-panel tab group with the last file", () => {
		const store = useFilePreview.getState();
		store.openFile("/a/x.ts");
		store.closeFile("/a/x.ts");
		expect(useFilePreview.getState().tabs).toEqual([]);
		expect(useFilePreview.getState().activePath).toBeNull();
		expect(useUi.getState().openRightTabs).not.toContain("files");
	});

	it("normalizes paths so one file never opens two tabs", () => {
		const store = useFilePreview.getState();
		store.openFile("/a//x.ts");
		store.openFile("/a/./x.ts");
		store.openFile("/a/x.ts/");
		const s = useFilePreview.getState();
		expect(s.tabs.map((t) => t.path)).toEqual(["/a/x.ts"]);
		expect(s.activePath).toBe("/a/x.ts");
	});
});
