const mem = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => mem.get(k) ?? null,
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
	key: () => null,
	get length() {
		return mem.size;
	},
} as Storage;

// Stub window for height clamping before exercising the store
(globalThis as { window?: unknown }).window = { innerHeight: 1000 };

import { beforeEach, describe, expect, it } from "vitest";
import {
	clampHeight,
	DRAWER_HEIGHT_MIN,
	useDrawerStore,
	type DrawerTab,
} from "./drawerStore";

function reset(overrides: Partial<{ open: boolean; height: number; tabs: DrawerTab[]; activeTabId: string | null }> = {}) {
	useDrawerStore.setState({
		open: false,
		height: 400,
		tabs: [],
		activeTabId: null,
		...overrides,
	});
}

describe("drawerStore", () => {
	beforeEach(() => {
		mem.clear();
		reset();
	});

	it("clamps height into [140px, 80vh]", () => {
		expect(clampHeight(10)).toBe(DRAWER_HEIGHT_MIN);
		expect(clampHeight(50)).toBe(DRAWER_HEIGHT_MIN);
		// innerHeight 1000 → max 800
		expect(clampHeight(5000)).toBe(800);
		expect(clampHeight(500)).toBe(500);
		expect(clampHeight(400.6)).toBe(401);
	});

	it("toggles and persists open state", () => {
		const s = useDrawerStore.getState();
		s.setOpen(true);
		expect(useDrawerStore.getState().open).toBe(true);
		expect(mem.get("ompws:drawer-open")).toBe("true");

		useDrawerStore.getState().toggle();
		expect(useDrawerStore.getState().open).toBe(false);
		expect(mem.get("ompws:drawer-open")).toBe("false");
	});

	it("clamps and persists height on setHeight", () => {
		useDrawerStore.getState().setHeight(50);
		expect(useDrawerStore.getState().height).toBe(DRAWER_HEIGHT_MIN);
		expect(Number(mem.get("ompws:drawer-height"))).toBe(DRAWER_HEIGHT_MIN);

		useDrawerStore.getState().setHeight(600);
		expect(useDrawerStore.getState().height).toBe(600);
	});

	it("addTab appends, activates and persists tab metas", () => {
		const id1 = useDrawerStore.getState().addTab("/tmp/a", "a");
		const id2 = useDrawerStore.getState().addTab("/tmp/b", "b");
		const { tabs, activeTabId } = useDrawerStore.getState();
		expect(tabs).toHaveLength(2);
		expect(tabs[0]).toMatchObject({ id: id1, cwd: "/tmp/a", title: "a", status: "opening", exitCode: null });
		expect(activeTabId).toBe(id2);
		expect(id1).not.toBe(id2);

		const stored = JSON.parse(mem.get("ompws:drawer-tabs") ?? "[]") as Array<Record<string, string>>;
		expect(stored).toHaveLength(2);
		// Only metas are persisted, not transient status
		expect(Object.keys(stored[0]).sort()).toEqual(["cwd", "id", "title"]);
	});

	it("removeTab drops the tab and reassigns the active tab to a neighbor", () => {
		const id1 = useDrawerStore.getState().addTab("/tmp/a", "a");
		const id2 = useDrawerStore.getState().addTab("/tmp/b", "b");
		const id3 = useDrawerStore.getState().addTab("/tmp/c", "c");

		useDrawerStore.getState().removeTab(id2);
		expect(useDrawerStore.getState().tabs.map((t) => t.id)).toEqual([id1, id3]);
		expect(useDrawerStore.getState().activeTabId).toBe(id3);

		useDrawerStore.getState().removeTab(id3);
		expect(useDrawerStore.getState().activeTabId).toBe(id1);

		useDrawerStore.getState().removeTab(id1);
		expect(useDrawerStore.getState().tabs).toHaveLength(0);
		expect(useDrawerStore.getState().activeTabId).toBeNull();
		expect(JSON.parse(mem.get("ompws:drawer-tabs") ?? "[]")).toHaveLength(0);
	});

	it("removeTab ignores unknown ids", () => {
		useDrawerStore.getState().addTab("/tmp/a", "a");
		useDrawerStore.getState().removeTab("nope");
		expect(useDrawerStore.getState().tabs).toHaveLength(1);
	});

	it("updateTab patches transient status fields only", () => {
		const id = useDrawerStore.getState().addTab("/tmp/a", "a");
		useDrawerStore.getState().updateTab(id, { status: "exited", exitCode: 3 });
		const tab = useDrawerStore.getState().tabs[0];
		expect(tab.status).toBe("exited");
		expect(tab.exitCode).toBe(3);
		expect(tab.cwd).toBe("/tmp/a");
	});

	it("hydrate restores open/height/tabs from localStorage with fresh statuses", () => {
		mem.set("ompws:drawer-open", "true");
		mem.set("ompws:drawer-height", "300");
		mem.set(
			"ompws:drawer-tabs",
			JSON.stringify([{ id: "t1", cwd: "/tmp/x", title: "x" }]),
		);

		useDrawerStore.getState().hydrate();
		const s = useDrawerStore.getState();
		expect(s.open).toBe(true);
		expect(s.height).toBe(300);
		expect(s.tabs).toHaveLength(1);
		expect(s.tabs[0]).toMatchObject({ id: "t1", cwd: "/tmp/x", title: "x", status: "opening", exitCode: null });
		expect(s.activeTabId).toBe("t1");
	});

	it("hydrate falls back to defaults when storage is empty or corrupted", () => {
		mem.set("ompws:drawer-tabs", "not json");
		useDrawerStore.getState().hydrate();
		const s = useDrawerStore.getState();
		expect(s.open).toBe(false);
		expect(s.height).toBeGreaterThanOrEqual(DRAWER_HEIGHT_MIN);
		expect(s.tabs).toHaveLength(0);
		expect(s.activeTabId).toBeNull();
	});
});
