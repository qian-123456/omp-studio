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

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BacklogItem } from "../../lib/contracts";
import { useBacklog } from "./backlogStore";

const item = (over: Partial<BacklogItem> = {}): BacklogItem => ({
	id: "b1",
	text: "Fix the top bar overflow issue",
	kind: "bug",
	status: "inbox",
	refs: [],
	targetSessionId: null,
	projectDir: null,
	createdAt: "2026-09-26T00:00:00Z",
	updatedAt: "2026-09-26T00:00:00Z",
	...over,
});

const { backlogList, onBacklogChanged } = vi.hoisted(() => ({
	backlogList: vi.fn(),
	onBacklogChanged: vi.fn(),
}));

vi.mock("../../lib/toast", () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
	},
}));

vi.mock("../../lib/ipc", () => ({ backlogList }));

vi.mock("../../lib/events", () => ({ onBacklogChanged }));

describe("useBacklog store", () => {
	// The store subscribes on first load(); capture the callback across tests.
	const captured: { listener: (() => void) | null } = { listener: null };

	beforeEach(() => {
		useBacklog.setState({ items: [], loading: false });
		backlogList.mockReset().mockResolvedValue([]);
		onBacklogChanged.mockReset().mockImplementation(async (cb: () => void) => {
			captured.listener = cb;
			return () => {};
		});
		vi.clearAllMocks();
	});

	it("initializes with empty items and loading=false", () => {
		expect(useBacklog.getState().items).toEqual([]);
		expect(useBacklog.getState().loading).toBe(false);
	});

	it("load fetches items, flips loading, and subscribes to change events once", async () => {
		backlogList.mockResolvedValue([item(), item({ id: "b2", status: "done" })]);

		await useBacklog.getState().load();

		expect(backlogList).toHaveBeenCalledTimes(1);
		expect(useBacklog.getState().items).toHaveLength(2);
		expect(useBacklog.getState().loading).toBe(false);
		expect(onBacklogChanged).toHaveBeenCalledTimes(1);

		// Subsequent loads reuse the single event subscription.
		await useBacklog.getState().load();
		expect(onBacklogChanged).toHaveBeenCalledTimes(1);
	});

	it("a backlog:changed event triggers a reload", async () => {
		await useBacklog.getState().load();
		expect(captured.listener).not.toBeNull();

		backlogList.mockResolvedValue([item()]);
		captured.listener?.();
		await vi.waitFor(() => {
			expect(useBacklog.getState().items).toHaveLength(1);
		});
		expect(backlogList).toHaveBeenCalledTimes(2);
	});

	it("persists draft and last kind, restoring them on a fresh module load", async () => {
		mem.clear();
		useBacklog.getState().setLastKind("bug");
		useBacklog.getState().setDraft({ text: "半句话", images: ["/tmp/a.png"] });
		useBacklog.getState().setDraft({ kind: "idea" });

		vi.resetModules();
		const fresh = (await import("./backlogStore")).useBacklog.getState();
		expect(fresh.lastKind).toBe("bug");
		expect(fresh.draft).toEqual({ text: "半句话", kind: "idea", images: ["/tmp/a.png"] });

		fresh.clearDraft();
		expect(fresh.lastKind).toBe("bug");
		vi.resetModules();
		const cleared = (await import("./backlogStore")).useBacklog.getState();
		expect(cleared.draft).toEqual({ text: "", kind: "bug", images: [] });
	});

	it("ignores corrupt stored values and defaults to todo", async () => {
		mem.clear();
		mem.set("ompws:backlog-last-kind", "nope");
		mem.set("ompws:backlog-draft", "{broken");
		vi.resetModules();
		const fresh = (await import("./backlogStore")).useBacklog.getState();
		expect(fresh.lastKind).toBe("todo");
		expect(fresh.draft).toEqual({ text: "", kind: "todo", images: [] });
	});
});
