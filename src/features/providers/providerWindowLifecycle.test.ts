// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ModelContextWindowEdit, ProviderUpsert } from "../../lib/contracts";

const backend = vi.hoisted(() => ({
	provider: "alpha",
	rejectDelete: false,
	overrides: new Map<string, number>(),
}));
vi.mock("../../lib/ipc", () => ({
	providerRows: vi.fn(async () => []),
	providerDelete: vi.fn(async (id: string) => {
		if (backend.rejectDelete) throw new Error("delete failed");
		for (const key of backend.overrides.keys()) if (key.startsWith(`${id}\0`)) backend.overrides.delete(key);
	}),
	providerUpsert: vi.fn(async (input: ProviderUpsert) => {
		backend.provider = input.id;
		return { id: input.id, models: input.models };
	}),
	listModels: vi.fn(async () => ({ models: [{ provider: backend.provider, id: "shared", name: "Shared", contextWindow: backend.overrides.get(`${backend.provider}\0shared`) ?? null }], source: "cli", completeness: "unverified" })),
	ompModelsContextWindowOverrides: vi.fn(async () => [...backend.overrides].map(([key, contextWindow]) => {
		const [providerId, modelId] = key.split("\0");
		return { providerId, modelId, contextWindow };
	})),
	ompModelsSetContextWindows: vi.fn(async (entries: ModelContextWindowEdit[], onlyIfAbsent: boolean) => {
		for (const entry of entries) {
			const key = `${entry.providerId}\0${entry.modelId}`;
			if (entry.contextWindow != null && (!onlyIfAbsent || !backend.overrides.has(key))) backend.overrides.set(key, entry.contextWindow);
		}
	}),
	modelKindCatalog: vi.fn(async () => []),
}));
vi.mock("../sessions/draftSession", () => ({ invalidateWarmDrafts: vi.fn(async () => {}) }));
vi.mock("../sessions/modelRegistrySync", () => ({ markLiveSessionsStale: vi.fn(async () => {}) }));

import { useProviders } from "./store";
import { useModelCatalog } from "../../stores/modelCatalog";
import { loadProviderWindows, setProviderWindow } from "../settings/contextWindow/core";

const input: ProviderUpsert = {
	originalId: "alpha", id: "beta", displayName: null, baseUrl: "http://localhost:9000/v1",
	api: "openai-completions", models: [{ id: "image", kind: "image", api: "openai-images" }], authNone: true,
};

beforeEach(() => {
	localStorage.clear();
	backend.provider = "alpha";
	backend.rejectDelete = false;
	backend.overrides.clear();
	useProviders.setState({ rows: [], loaded: true, error: null, tests: {}, modelTests: {} });
	setProviderWindow("alpha", 64000);
});

describe("provider window lifecycle", () => {
	it("removes a reset provider default before rediscovery can recreate an override, but preserves it after failed deletion", async () => {
		backend.overrides.set("alpha\0shared", 64000);
		backend.rejectDelete = true;
		await expect(useProviders.getState().remove("alpha")).rejects.toThrow("delete failed");
		expect(loadProviderWindows().alpha).toBe(64000);
		expect(backend.overrides.get("alpha\0shared")).toBe(64000);
		backend.rejectDelete = false;
		await useProviders.getState().remove("alpha");
		expect(loadProviderWindows().alpha).toBeUndefined();
		expect(backend.overrides.has("alpha\0shared")).toBe(false);
	});

	it("moves the default on an other-model provider rename without contaminating a recreated old id", async () => {
		await useProviders.getState().upsert(input, null);
		expect(loadProviderWindows()).toEqual({ beta: 64000 });
		expect(backend.overrides.get("beta\0shared")).toBe(64000);
		backend.provider = "alpha";
		await useModelCatalog.getState().refresh();
		expect(backend.overrides.has("alpha\0shared")).toBe(false);
	});
});
