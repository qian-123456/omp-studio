// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Model, ModelCatalogSnapshot, ProviderRow, ProviderUpsert } from "../../lib/contracts";

const ipc = vi.hoisted(() => ({
	listModels: vi.fn<() => Promise<ModelCatalogSnapshot>>(),
	providerUpsert: vi.fn(), providerSaveBuiltin: vi.fn(), providerSetKey: vi.fn(),
	providerSetEnabled: vi.fn(), providerDelete: vi.fn(), providerRows: vi.fn(),
	modelKindCatalog: vi.fn(async () => []),
	ompModelsContextWindowOverrides: vi.fn(async () => []),
	ompModelsSetContextWindows: vi.fn(async () => {}),
}));
vi.mock("../../lib/ipc", () => ipc);
vi.mock("../sessions/draftSession", () => ({ invalidateWarmDrafts: vi.fn(async () => {}) }));
vi.mock("../sessions/modelRegistrySync", () => ({ markLiveSessionsStale: vi.fn(async () => {}) }));

const KEY = "ompws:cached-models";
const alpha: Model = { provider: "alpha", id: "old", name: "Old" };
const beta: Model = { provider: "beta", id: "keep", name: "Keep" };
const updated: Model = { provider: "alpha", id: "new", name: "New" };
const snapshot = (models: Model[]): ModelCatalogSnapshot => ({ models, source: "cli", completeness: "unverified" });
const selectors = (models: readonly Model[] | null): string[] | null =>
	models?.map(({ provider, id }) => `${provider}/${id}`) ?? null;
const row: ProviderRow = {
	id: "alpha", displayName: null, slug: "alpha", origin: "custom", sources: ["models.yml"],
	baseUrl: "http://localhost/v1", api: "openai-completions", models: ["new"],
	key: { kind: "none", envVar: null, envSet: null }, enabled: true, testable: true,
	defaultBaseUrl: null, extraModels: [], authNone: true,
};
const input: ProviderUpsert = { originalId: "alpha", id: "alpha", displayName: null, baseUrl: row.baseUrl!, api: "openai-completions", models: ["new"], authNone: true };

function deferred<T>() {
	// The supported ES2021 library does not provide Promise.withResolvers.
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}

// Intentional module-loading boundary: catalogs seed from each case's persistent cache.
async function stores() {
	vi.resetModules();
	const { useModelCatalog } = await import("../../stores/modelCatalog");
	const { useProviders } = await import("./store");
	useProviders.setState({ rows: [row], loaded: true, error: null });
	return { catalog: useModelCatalog, providers: useProviders };
}

beforeEach(() => {
	vi.clearAllMocks();
	ipc.listModels.mockReset();
	ipc.providerUpsert.mockReset().mockResolvedValue(row);
	ipc.providerSaveBuiltin.mockResolvedValue(row);
	ipc.providerSetKey.mockResolvedValue(row);
	ipc.providerDelete.mockReset().mockResolvedValue(undefined);
	ipc.providerSetEnabled.mockReset().mockResolvedValue(undefined);
	ipc.providerRows.mockResolvedValue([]);
	localStorage.clear();
	localStorage.setItem(KEY, JSON.stringify([alpha, beta]));
});

describe("provider mutation catalog boundary with real stores", () => {
	it.each(["disable", "remove"] as const)("evicts %s even when the post-mutation refresh fails", async (action) => {
		const { catalog, providers } = await stores();
		ipc.listModels.mockRejectedValueOnce(new Error("MODEL_CATALOG_EXIT_FAILED"));
		if (action === "disable") await providers.getState().setEnabled("alpha", false);
		else await providers.getState().remove("alpha");
		expect(selectors(catalog.getState().models)).toEqual(selectors([beta]));
		expect(selectors(JSON.parse(localStorage.getItem(KEY)!))).toEqual(selectors([beta]));
		expect(catalog.getState().status).toBe("stale");
		expect(catalog.getState().error).toContain("MODEL_CATALOG_EXIT_FAILED");
	});

	it.each(["disable", "remove"] as const)("accepts a legitimate %s without resurrecting the affected provider", async (action) => {
		const { catalog, providers } = await stores();
		ipc.listModels.mockResolvedValueOnce(snapshot([beta]));
		if (action === "disable") await providers.getState().setEnabled("alpha", false);
		else await providers.getState().remove("alpha");
		expect(catalog.getState()).toMatchObject({ models: [beta], status: "unverified", error: null });
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([beta]);
	});

	it("accepts zero available models after the last provider is disabled", async () => {
		localStorage.setItem(KEY, JSON.stringify([alpha]));
		const { catalog, providers } = await stores();
		ipc.listModels.mockResolvedValueOnce(snapshot([]));
		await providers.getState().setEnabled("alpha", false);
		expect(catalog.getState()).toMatchObject({ models: [], status: "unverified", loading: false });
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([]);
	});

	it("does not invalidate after a failed mutation", async () => {
		const { catalog, providers } = await stores();
		ipc.providerSetEnabled.mockRejectedValueOnce(new Error("write failed"));
		await expect(providers.getState().setEnabled("alpha", false)).rejects.toThrow("write failed");
		expect(selectors(catalog.getState().models)).toEqual(selectors([alpha, beta]));
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([alpha, beta]);
		expect(ipc.listModels).not.toHaveBeenCalled();
	});

	it.each(["old-first", "new-first"] as const)("starts a post-save request instead of joining the old flight (%s)", async (order) => {
		const { catalog, providers } = await stores();
		const old = deferred<ModelCatalogSnapshot>();
		const fresh = deferred<ModelCatalogSnapshot>();
		ipc.listModels.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
		const oldRefresh = catalog.getState().refresh();
		const save = providers.getState().upsert(input, null);
		await vi.waitFor(() => expect(ipc.listModels).toHaveBeenCalledTimes(2));
		expect(selectors(catalog.getState().models)).toEqual(selectors([beta]));
		if (order === "old-first") {
			old.resolve(snapshot([alpha, beta]));
			await oldRefresh;
			expect(catalog.getState().loading).toBe(true);
			expect(selectors(catalog.getState().models)).toEqual(selectors([beta]));
			const joined = catalog.getState().refresh();
			expect(ipc.listModels).toHaveBeenCalledTimes(2);
			fresh.resolve(snapshot([updated, beta]));
			await joined;
		} else {
			fresh.resolve(snapshot([updated, beta]));
			await save;
			old.resolve(snapshot([alpha, beta]));
			await oldRefresh;
		}
		await save;
		expect(catalog.getState()).toMatchObject({ models: [updated, beta], loading: false, status: "unverified" });
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([updated, beta]);
	});

	it("keeps unaffected providers when a post-save successful response is also partial", async () => {
		const { catalog, providers } = await stores();
		ipc.listModels.mockResolvedValueOnce(snapshot([updated]));
		await providers.getState().upsert(input, null);
		expect(selectors(catalog.getState().models)).toEqual(selectors([beta]));
		expect(selectors(JSON.parse(localStorage.getItem(KEY)!))).toEqual(selectors([beta]));
		expect(catalog.getState().status).toBe("stale");
	});

	it("evicts both ids on provider rename while retaining unrelated providers", async () => {
		const { catalog, providers } = await stores();
		const renamed = { ...updated, provider: "renamed" };
		ipc.providerUpsert.mockResolvedValueOnce({ ...row, id: "renamed" });
		ipc.listModels.mockResolvedValueOnce(snapshot([renamed, beta]));
		await providers.getState().upsert({ ...input, id: "renamed" }, null);
		expect(catalog.getState().models).toEqual([renamed, beta]);
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual([renamed, beta]);
	});
});
