import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "../lib/contracts";

const listModels = vi.fn<() => Promise<Model[]>>();
vi.mock("../lib/ipc", () => ({ listModels: () => listModels() }));

const KEY = "ompws:cached-models";
let storage: Record<string, string>;

const OPUS: Model = { provider: "anthropic", id: "opus", name: "Opus", thinking: ["high"], contextWindow: 200000 };
const HAIKU: Model = { provider: "anthropic", id: "haiku", name: "Haiku", thinking: [], contextWindow: null };

// Dynamic import: the store seeds from localStorage at module init, so each
// case needs a fresh module evaluation after stubbing storage.
async function loadStore() {
	vi.resetModules();
	return (await import("./modelCatalog")).useModelCatalog;
}

beforeEach(() => {
	listModels.mockReset();
	storage = {};
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => storage[k] ?? null,
		setItem: (k: string, v: string) => {
			storage[k] = v;
		},
	});
});

describe("useModelCatalog", () => {
	it("starts empty without a cache", async () => {
		const store = await loadStore();
		expect(store.getState().models).toBeNull();
	});

	it("seeds from the current raw shape", async () => {
		storage[KEY] = JSON.stringify([OPUS]);
		const store = await loadStore();
		expect(store.getState().models).toEqual([OPUS]);
	});

	it("seeds from the legacy ModelOption shape and drops junk", async () => {
		storage[KEY] = JSON.stringify([{ provider: "anthropic", id: "haiku", name: "Haiku", thinking: [] }, { id: "x" }, 3]);
		const store = await loadStore();
		expect(store.getState().models).toEqual([HAIKU]);
	});

	it("ignores malformed cache", async () => {
		storage[KEY] = "{not json";
		const store = await loadStore();
		expect(store.getState().models).toBeNull();
	});

	it("shares one in-flight call across concurrent refreshes, refetches afterwards", async () => {
		let resolve!: (v: Model[]) => void;
		listModels.mockReturnValueOnce(new Promise((r) => (resolve = r)));
		const store = await loadStore();
		const a = store.getState().refresh();
		const b = store.getState().refresh();
		expect(listModels).toHaveBeenCalledTimes(1);
		expect(store.getState().loading).toBe(true);
		resolve([OPUS]);
		await Promise.all([a, b]);
		expect(store.getState().models).toEqual([OPUS]);
		expect(store.getState().loading).toBe(false);
		expect(JSON.parse(storage[KEY])).toEqual([OPUS]);

		listModels.mockResolvedValueOnce([OPUS, HAIKU]);
		await store.getState().refresh();
		expect(listModels).toHaveBeenCalledTimes(2);
		expect(store.getState().models).toEqual([OPUS, HAIKU]);
	});

	it("keeps the previous list on failure or empty result", async () => {
		storage[KEY] = JSON.stringify([OPUS]);
		const store = await loadStore();
		listModels.mockRejectedValueOnce(new Error("boom"));
		await store.getState().refresh();
		expect(store.getState().models).toEqual([OPUS]);
		listModels.mockResolvedValueOnce([]);
		await store.getState().refresh();
		expect(store.getState().models).toEqual([OPUS]);
		expect(store.getState().loading).toBe(false);
	});
});
