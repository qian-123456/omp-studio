import { beforeEach, describe, expect, it } from "vitest";
import { heldItems, useHeldQueue } from "./heldQueue";

const SID = "s1";

// Node test env: minimal localStorage stub.
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

beforeEach(() => {
	useHeldQueue.setState({ queues: {}, dismissed: {} });
	localStorage.clear();
});

describe("held queue", () => {
	it("push / update / remove / clear", () => {
		const q = useHeldQueue.getState();
		q.push(SID, "第一条");
		q.push(SID, "第二条");
		q.push(SID, "   ");
		expect(heldItems(SID)).toEqual(["第一条", "第二条"]);
		q.update(SID, 0, "改过的");
		expect(heldItems(SID)[0]).toBe("改过的");
		q.remove(SID, 1);
		expect(heldItems(SID)).toEqual(["改过的"]);
		q.clear(SID);
		expect(heldItems(SID)).toEqual([]);
	});

	it("move reorders within bounds", () => {
		const q = useHeldQueue.getState();
		q.push(SID, "a");
		q.push(SID, "b");
		q.push(SID, "c");
		q.move(SID, 0, 1);
		expect(heldItems(SID)).toEqual(["b", "a", "c"]);
		q.move(SID, 0, -1); // out of bounds: no-op
		expect(heldItems(SID)).toEqual(["b", "a", "c"]);
	});

	it("drain returns all items and empties the queue", () => {
		const q = useHeldQueue.getState();
		q.push(SID, "x");
		q.push(SID, "y");
		expect(q.drain(SID)).toEqual(["x", "y"]);
		expect(heldItems(SID)).toEqual([]);
	});

	it("persists to localStorage per session and hydrates on read", () => {
		useHeldQueue.getState().push(SID, "持久化");
		expect(localStorage.getItem("ompws-held:s1")).toContain("持久化");
		// Simulate a reload: in-memory queue gone, storage still has it.
		useHeldQueue.setState({ queues: {}, dismissed: {} });
		expect(heldItems(SID)).toEqual(["持久化"]);
	});

	it("push resets the dismissed flag; empty queue removes the key", () => {
		const q = useHeldQueue.getState();
		q.push(SID, "hi");
		q.setDismissed(SID, true);
		q.push(SID, "again");
		expect(useHeldQueue.getState().dismissed[SID]).toBe(false);
		q.clear(SID);
		expect(localStorage.getItem("ompws-held:s1")).toBeNull();
	});

	it("can explicitly dismiss and restore queue bar", () => {
		const q = useHeldQueue.getState();
		q.push(SID, "msg");
		expect(useHeldQueue.getState().dismissed[SID]).toBe(false);
		q.setDismissed(SID, true);
		expect(useHeldQueue.getState().dismissed[SID]).toBe(true);
		q.setDismissed(SID, false);
		expect(useHeldQueue.getState().dismissed[SID]).toBe(false);
	});

	it("maintains stable item IDs across updates to prevent focus loss", () => {
		const q = useHeldQueue.getState();
		q.push(SID, "hello");
		const idBefore = useHeldQueue.getState().queues[SID][0].id;
		expect(idBefore).toBeDefined();

		// Update the text
		q.update(SID, 0, "hello world!");
		const idAfter = useHeldQueue.getState().queues[SID][0].id;
		expect(idAfter).toBe(idBefore);
		expect(useHeldQueue.getState().queues[SID][0].text).toBe("hello world!");
	});
});
