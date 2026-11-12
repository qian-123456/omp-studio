import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelKindEntry, ProviderRow, ProviderUpsert } from "../../lib/contracts";

const mocks = vi.hoisted(() => ({
	modelKindCatalog: vi.fn<() => Promise<ModelKindEntry[]>>(),
	providerRows: vi.fn(),
	providerSetEnabled: vi.fn(),
	providerUpsert: vi.fn(),
	providerSaveBuiltin: vi.fn(),
	providerSetKey: vi.fn(),
	providerDelete: vi.fn(),
	providerTest: vi.fn(),
	providerTestModel: vi.fn(),
	providerExportEnvText: vi.fn(),
}));
const sessionSync = vi.hoisted(() => ({
	refresh: vi.fn(async () => {}),
	invalidateWarmDrafts: vi.fn(async () => {}),
	markLiveSessionsStale: vi.fn(async () => {}),
}));
vi.mock("../../lib/ipc", () => mocks);
vi.mock("../../stores/modelCatalog", () => ({ useModelCatalog: { getState: () => ({ refresh: sessionSync.refresh }) } }));
vi.mock("../sessions/draftSession", () => ({ invalidateWarmDrafts: sessionSync.invalidateWarmDrafts }));
vi.mock("../sessions/modelRegistrySync", () => ({ markLiveSessionsStale: sessionSync.markLiveSessionsStale }));

import { useModelKindCatalog } from "../../stores/modelKinds";
import { useProviders } from "./store";

const row: ProviderRow = {
	id: "custom",
	displayName: null,
	slug: "custom",
	origin: "custom",
	sources: ["models.yml"],
	baseUrl: "http://localhost:9000/v1",
	api: "openai-completions",
	models: ["unregistered-image-runner"],
	key: { kind: "none", envVar: null, envSet: null },
	enabled: true,
	testable: true,
	defaultBaseUrl: null,
	extraModels: [],
	authNone: true,
};
const input: ProviderUpsert = {
	originalId: null,
	id: row.id,
	displayName: null,
	baseUrl: "http://localhost:9000/v1",
	api: "openai-completions",
	models: row.models,
	authNone: true,
};
const registered: ModelKindEntry = { selector: "runtime/image", provider: "runtime", kind: "image", name: null, thinking: [] };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.modelKindCatalog.mockReset().mockResolvedValue([registered]);
	mocks.providerRows.mockResolvedValue([row]);
	mocks.providerUpsert.mockResolvedValue(row);
	mocks.providerSaveBuiltin.mockResolvedValue(row);
	mocks.providerSetKey.mockResolvedValue(row);
	mocks.providerSetEnabled.mockReset().mockResolvedValue(undefined);
	useModelKindCatalog.setState({ entries: [], kindBySelector: new Map(), loading: false, error: null });
	useProviders.setState({ rows: [row], loaded: true, error: null, tests: {}, modelTests: {} });
});

describe("provider mutations refresh registered candidates", () => {
	it.each([
		["save custom", () => useProviders.getState().upsert(input, null)],
		["save builtin", () => useProviders.getState().saveBuiltin({ id: row.id, baseUrl: null, authNone: true, extraModels: [] }, null)],
		["change key", () => useProviders.getState().setKey(row.id, "updated-key")],
		["disable", () => useProviders.getState().setEnabled(row.id, false)],
		["remove", () => useProviders.getState().remove(row.id)],
	] as const)("reloads the all-kind catalog after %s", async (_name, mutate) => {
		await mutate();
		expect(mocks.modelKindCatalog).toHaveBeenCalledTimes(1);
		expect(useModelKindCatalog.getState().entries).toEqual([registered]);
		expect(useProviders.getState().rows[0].models).toEqual(row.models);
	});

	it("does not make raw configured model names executable when runtime omits them", async () => {
		mocks.modelKindCatalog.mockResolvedValue([]);
		await useProviders.getState().upsert(input, null);
		expect(useProviders.getState().rows[0].models).toEqual(["unregistered-image-runner"]);
		expect(useModelKindCatalog.getState().entries).toEqual([]);
		expect(useModelKindCatalog.getState().kindBySelector.size).toBe(0);
	});

	it("rolls back a failed enable save without replacing registered candidates", async () => {
		useModelKindCatalog.setState({ entries: [registered], kindBySelector: new Map([[registered.selector, registered.kind]]) });
		mocks.providerSetEnabled.mockRejectedValueOnce(new Error("write failed"));
		await expect(useProviders.getState().setEnabled(row.id, false)).rejects.toThrow("write failed");
		expect(useProviders.getState().rows[0].enabled).toBe(true);
		expect(useModelKindCatalog.getState().entries).toEqual([registered]);
		expect(mocks.modelKindCatalog).not.toHaveBeenCalled();
	});
});
