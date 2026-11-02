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

import { beforeEach, describe, expect, it } from "vitest";
import { countLiveCommandTabs, useDrawerStore } from "./drawerStore";

function reset() {
	useDrawerStore.setState({ tabs: [], activeTabId: null, scope: "", activeByScope: {} });
}

describe("drawerStore", () => {
	beforeEach(() => {
		mem.clear();
		reset();
	});

	it("countLiveCommandTabs counts only visible tabs with a running shell", () => {
		const a = useDrawerStore.getState().addTab("/tmp/a", "a");
		const b = useDrawerStore.getState().addTab("/tmp/b", "b");
		useDrawerStore.getState().addTab("/tmp/c", "c");
		useDrawerStore.getState().updateTab(a, { status: "ready" });
		useDrawerStore.getState().updateTab(b, { status: "ready" });
		expect(countLiveCommandTabs(useDrawerStore.getState().tabs)).toBe(2);
		useDrawerStore.getState().detachTab(b);
		expect(countLiveCommandTabs(useDrawerStore.getState().tabs)).toBe(1);
		useDrawerStore.getState().updateTab(a, { status: "exited", exitCode: 0 });
		expect(countLiveCommandTabs(useDrawerStore.getState().tabs)).toBe(0);
	});

	it("detachTab moves the active tab to the first visible one; reattachTab activates it", () => {
		useDrawerStore.getState().setScope("/tmp/a");
		const a = useDrawerStore.getState().addTab("/tmp/a", "a");
		const b = useDrawerStore.getState().addTab("/tmp/a", "b");
		useDrawerStore.getState().detachTab(b);
		expect(useDrawerStore.getState().activeTabId).toBe(a);
		useDrawerStore.getState().reattachTab(b);
		expect(useDrawerStore.getState().activeTabId).toBe(b);
		expect(useDrawerStore.getState().tabs.every((t) => !t.detached)).toBe(true);
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
		expect(Object.keys(stored[0]).sort()).toEqual(["cwd", "id", "scope", "sessionId", "title", "workspaceId"]);
	});

	it("removeTab drops the tab and reassigns the active tab to a neighbor", () => {
		useDrawerStore.getState().setScope("/tmp/a");
		const id1 = useDrawerStore.getState().addTab("/tmp/a", "a");
		const id2 = useDrawerStore.getState().addTab("/tmp/a", "b");
		const id3 = useDrawerStore.getState().addTab("/tmp/a", "c");

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

	it("hydrate restores tabs from localStorage with fresh statuses", () => {
		mem.set(
			"ompws:drawer-tabs",
			JSON.stringify([
				{ id: "t0", cwd: "/tmp/w", title: "w", detached: true },
				{ id: "t1", cwd: "/tmp/x", title: "x" },
			]),
		);

		useDrawerStore.getState().hydrate();
		const s = useDrawerStore.getState();
		expect(s.tabs).toHaveLength(2);
		expect(s.tabs[1]).toMatchObject({ id: "t1", cwd: "/tmp/x", title: "x", status: "opening", exitCode: null });
		expect(s.activeTabId).toBe("t1");
	});

	it("restores the active tab independently per worktree without removing the others", () => {
		const store = useDrawerStore.getState();
		store.setScope("/project/a");
		const a = store.addTab("/project/a", "A", "session-a");
		const a2 = store.addTab("/project/a", "A2", "session-a");
		store.setActive(a);
		store.setScope("/project/b");
		const b = store.addTab("/project/b", "B", "session-b");
		store.setScope("/project/a");
		expect(useDrawerStore.getState().activeTabId).toBe(a);
		expect(useDrawerStore.getState().tabs.map((t) => [t.id, t.scope, t.sessionId])).toEqual([
			[a, "/project/a", "session-a"], [a2, "/project/a", "session-a"], [b, "/project/b", "session-b"],
		]);
		store.setScope("/project/b");
		expect(useDrawerStore.getState().activeTabId).toBe(b);
	});

	it("atomically migrates delayed worktree roots without replacing tab identities", () => {
		const store = useDrawerStore.getState();
		store.setScope("/repo/sub");
		const a = store.addTab("/repo/sub", "a", "session-a", "/repo/sub", "ws");
		const b = store.addTab("/repo/other", "b", "session-b", "/repo/other", "ws");
		store.setActive(a);
		store.reconcileScopes({ [a]: "/repo", [b]: "/repo" });
		expect(useDrawerStore.getState().tabs.map((tab) => [tab.id, tab.scope, tab.cwd, tab.sessionId])).toEqual([
			[a, "/repo", "/repo/sub", "session-a"],
			[b, "/repo", "/repo/other", "session-b"],
		]);
		store.setScope("/repo");
		expect(useDrawerStore.getState().activeTabId).toBe(a);
	});

	it("hydrate starts clean when storage is corrupted", () => {
		mem.set("ompws:drawer-tabs", "not json");
		useDrawerStore.getState().hydrate();
		const s = useDrawerStore.getState();
		expect(s.tabs).toHaveLength(0);
		expect(s.activeTabId).toBeNull();
	});
});
