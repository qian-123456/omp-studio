import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model } from "../lib/contracts";

const listModels = vi.fn<() => Promise<Model[]>>();
const readOverrides = vi.fn(async () => [] as { providerId: string; modelId: string; contextWindow: number }[]);
const writeOverrides = vi.fn(async (_entries: unknown, _onlyIfAbsent: boolean) => {});
vi.mock("../lib/ipc", () => ({
	listModels: async () => ({ models: await listModels(), source: "cli", completeness: "unverified" }),
	ompModelsContextWindowOverrides: () => readOverrides(),
	ompModelsSetContextWindows: (entries: unknown, onlyIfAbsent: boolean) => writeOverrides(entries, onlyIfAbsent),
}));

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
	readOverrides.mockReset();
	readOverrides.mockResolvedValue([]);
	writeOverrides.mockReset();
	writeOverrides.mockResolvedValue(undefined);
	storage = {};
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => storage[k] ?? null,
		setItem: (k: string, v: string) => {
			storage[k] = v;
		},
	});
});

describe("useModelCatalog", () => {
	it("applies provider defaults to future models without crossing providers or overwriting explicit values", async () => {
		storage["ompws.providerContextWindows.v1"] = JSON.stringify({ alpha: 64000 });
		storage["ompws.contextWindowRules.v1"] = JSON.stringify([{ id: "gpt", keywords: ["gpt"], contextWindow: 272000, createdAt: 1 }]);
		const models: Model[] = [
			{ provider: "alpha", id: "gpt-shared", name: "A", contextWindow: null },
			{ provider: "beta", id: "gpt-shared", name: "B", contextWindow: null },
			{ provider: "alpha", id: "gpt-custom", name: "C", contextWindow: 32000 },
		];
		readOverrides.mockResolvedValue([{ providerId: "alpha", modelId: "gpt-custom", contextWindow: 32000 }]);
		listModels.mockResolvedValueOnce(models).mockResolvedValueOnce(models);
		const store = await loadStore();
		await store.getState().refresh();
		expect(writeOverrides).toHaveBeenCalledWith([
			{ providerId: "alpha", modelId: "gpt-shared", contextWindow: 64000 },
			{ providerId: "beta", modelId: "gpt-shared", contextWindow: 272000 },
		], true);
	});

	it("reopens without rewriting overrides and caches the actual post-write catalog", async () => {
		storage["ompws.contextWindowRules.v1"] = JSON.stringify([{ id: "gpt", keywords: ["gpt"], contextWindow: 272000, createdAt: 1 }]);
		const discovered: Model[] = [
			{ provider: "openai", id: "gpt-new", name: "New", contextWindow: 128000 },
			{ provider: "openai", id: "gpt-explicit", name: "Explicit", contextWindow: 64000 },
		];
		// A newer explicit edit wins in the backend while the automatic write is pending.
		const actual = [{ ...discovered[0], contextWindow: 196608 }, discovered[1]];
		const reopened = [{ ...actual[0], contextWindow: 300000 }, actual[1]];
		readOverrides
			.mockResolvedValueOnce([{ providerId: "openai", modelId: "gpt-explicit", contextWindow: 64000 }])
			.mockResolvedValueOnce([
				{ providerId: "openai", modelId: "gpt-new", contextWindow: 300000 },
				{ providerId: "openai", modelId: "gpt-explicit", contextWindow: 64000 },
			]);
		listModels.mockResolvedValueOnce(discovered).mockResolvedValueOnce(actual).mockResolvedValueOnce(reopened);
		const store = await loadStore();

		await store.getState().refresh();
		expect(store.getState().models).toEqual(actual);
		expect(JSON.parse(storage[KEY])).toEqual(actual);

		await store.getState().refresh();
		expect(store.getState().models).toEqual(reopened);
		expect(JSON.parse(storage[KEY])).toEqual(reopened);
		expect(store.getState().loading).toBe(false);
		expect(writeOverrides).toHaveBeenCalledTimes(1);
	});

	it("applies matching rules to discovered model windows and respects explicit overrides", async () => {
		storage["ompws.contextWindowRules.v1"] = JSON.stringify([{ id: "gpt", keywords: ["gpt"], contextWindow: 272000, createdAt: 1 }]);
		const models = [
			{ provider: "openai-codex", id: "gpt6.1sol", name: "new", contextWindow: 128000 },
			{ provider: "openai-codex", id: "gpt-old", name: "old", contextWindow: 128000 },
		];
		readOverrides.mockResolvedValue([{ providerId: "openai-codex", modelId: "gpt-old", contextWindow: 64000 }]);
		listModels.mockResolvedValueOnce(models).mockResolvedValueOnce([{ ...models[0], contextWindow: 272000 }, models[1]]);
		const store = await loadStore();
		await store.getState().refresh();
		expect(writeOverrides).toHaveBeenCalledWith([{ providerId: "openai-codex", modelId: "gpt6.1sol", contextWindow: 272000 }], true);
		expect(store.getState().models?.[0].contextWindow).toBe(272000);
	});
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

	it("retains a last-known snapshot with an explicit stale status on failure or shrinking empty read", async () => {
		storage[KEY] = JSON.stringify([OPUS]);
		const store = await loadStore();
		listModels.mockRejectedValueOnce(new Error("boom"));
		await store.getState().refresh();
		expect(store.getState().models).toEqual([OPUS]);
		expect(store.getState().status).toBe("stale");
		expect(store.getState().error).toContain("boom");
		listModels.mockResolvedValueOnce([]);
		await store.getState().refresh();
		expect(store.getState().models).toEqual([OPUS]);
		expect(store.getState().loading).toBe(false);
		expect(store.getState().status).toBe("stale");
		expect(store.getState().error).toContain("缺少既有条目");
	});

	it("rejects unchanged 24-provider to 4-provider successful shrink without evicting memory or cache", async () => {
		const full = Array.from({ length: 24 }, (_, i) => ({ provider: `p${i}`, id: "m", name: `M${i}` }));
		storage[KEY] = JSON.stringify(full);
		const store = await loadStore();
		listModels.mockResolvedValueOnce(full.slice(0, 4));
		await store.getState().refresh();
		expect(store.getState().models?.map(({ provider, id }) => `${provider}/${id}`))
			.toEqual(full.map(({ provider, id }) => `${provider}/${id}`));
		expect(JSON.parse(storage[KEY])).toEqual(full);
		expect(store.getState().status).toBe("stale");
		expect(store.getState().error).toContain("缺少既有条目");
		expect(writeOverrides).not.toHaveBeenCalled();
	});

	it("reports failed initial reads without inventing a database subset or cache", async () => {
		const store = await loadStore();
		listModels.mockRejectedValueOnce(new Error("MODEL_CATALOG_EXIT_FAILED"));
		await store.getState().refresh();
		expect(store.getState()).toMatchObject({ models: null, status: "failed", loading: false });
		expect(store.getState().error).toContain("MODEL_CATALOG_EXIT_FAILED");
		expect(storage[KEY]).toBeUndefined();
	});

	it("represents an initial successful empty catalog deliberately and reloads its empty cache", async () => {
		const store = await loadStore();
		listModels.mockResolvedValueOnce([]);
		await store.getState().refresh();
		expect(store.getState()).toMatchObject({ models: [], status: "unverified", error: null });
		expect(JSON.parse(storage[KEY])).toEqual([]);
		expect((await loadStore()).getState().models).toEqual([]);
	});

	it("labels an initial nonempty CLI read unverified rather than complete", async () => {
		const store = await loadStore();
		listModels.mockResolvedValueOnce([OPUS]);
		await store.getState().refresh();
		expect(store.getState()).toMatchObject({ models: [OPUS], status: "unverified", error: null });
	});

	it("protects the first accepted snapshot from shrink in the post-context-window read", async () => {
		storage["ompws.contextWindowRules.v1"] = JSON.stringify([{ id: "opus", keywords: ["opus"], contextWindow: 272000, createdAt: 1 }]);
		const store = await loadStore();
		listModels.mockResolvedValueOnce([OPUS, HAIKU]).mockResolvedValueOnce([HAIKU]);
		await store.getState().refresh();
		expect(writeOverrides).toHaveBeenCalledTimes(1);
		expect(store.getState().models).toEqual([OPUS, HAIKU]);
		expect(JSON.parse(storage[KEY])).toEqual([OPUS, HAIKU]);
		expect(store.getState().status).toBe("stale");
	});

	it("does not start derived writes after a provider mutation supersedes override discovery", async () => {
		storage["ompws.providerContextWindows.v1"] = JSON.stringify({ anthropic: 64000 });
		// ES2021 does not expose Promise.withResolvers.
		let resolveOverrides!: (value: []) => void;
		readOverrides.mockReturnValueOnce(new Promise((resolve) => { resolveOverrides = resolve; }));
		listModels.mockResolvedValueOnce([OPUS]);
		const store = await loadStore();
		const old = store.getState().refresh();
		await vi.waitFor(() => expect(readOverrides).toHaveBeenCalledTimes(1));
		listModels.mockResolvedValueOnce([]);
		await store.getState().refresh(["anthropic"]);
		resolveOverrides([]);
		await old;
		expect(writeOverrides).not.toHaveBeenCalled();
		expect(store.getState().models).toEqual([]);
		expect(JSON.parse(storage[KEY])).toEqual([]);
	});

	it("does not publish a late post-write response after invalidation", async () => {
		storage["ompws.providerContextWindows.v1"] = JSON.stringify({ anthropic: 64000 });
		// ES2021 does not expose Promise.withResolvers.
		let resolveOld!: (models: Model[]) => void;
		listModels.mockResolvedValueOnce([OPUS]).mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }));
		const store = await loadStore();
		const old = store.getState().refresh();
		await vi.waitFor(() => expect(listModels).toHaveBeenCalledTimes(2));
		listModels.mockResolvedValueOnce([]);
		await store.getState().refresh(["anthropic"]);
		resolveOld([OPUS]);
		await old;
		expect(store.getState()).toMatchObject({ models: [], loading: false, status: "unverified" });
		expect(JSON.parse(storage[KEY])).toEqual([]);
	});
});
