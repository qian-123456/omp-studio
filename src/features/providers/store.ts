/** [providers] OMP provider rows for the settings panel. */

import { create } from "zustand";
import type {
	BuiltinOverride,
	ProviderRow,
	ProviderTestResult,
	ProviderUpsert,
} from "../../lib/contracts";
import { invalidateWarmDrafts } from "../sessions/draftSession";
import { markLiveSessionsStale } from "../sessions/modelRegistrySync";
import { useModelCatalog } from "../../stores/modelCatalog";
import { useModelKindCatalog } from "../../stores/modelKinds";
import { moveProviderWindow, setProviderWindow } from "../settings/contextWindow/core";
import {
	providerSaveBuiltin,
	providerDelete,
	providerExportEnvText,
	providerRows,
	providerSetEnabled,
	providerSetKey,
	providerTest,
	providerTestModel,
	providerUpsert,
} from "../../lib/ipc";

export type TestStatus =
	| { state: "testing" }
	| { state: "done"; result: ProviderTestResult };

interface ProvidersState {
	rows: ProviderRow[];
	loaded: boolean;
	error: string | null;
	/** Per-provider inline probe state. */
	tests: Record<string, TestStatus>;
	/** Per-model inline probe state. Key: `${providerId}::${modelId}` */
	modelTests: Record<string, TestStatus>;
	load(): Promise<void>;
	/** Optimistic toggle of OMP's `disabledProviders`; rolls back and rethrows on failure. */
	setEnabled(id: string, enabled: boolean): Promise<void>;
	/** Null keeps the current key; external references stay unchanged. */
	upsert(input: ProviderUpsert, apiKey: string | null): Promise<ProviderRow>;
	/** Null keeps the current key; external references stay unchanged. */
	saveBuiltin(input: BuiltinOverride, apiKey: string | null): Promise<ProviderRow>;
	setKey(id: string, apiKey: string): Promise<ProviderRow>;
	remove(id: string): Promise<void>;
	runTest(id: string): Promise<void>;
	runModelTest(providerId: string, modelId: string): Promise<void>;
	exportEnvText(ids?: string[]): Promise<string>;
}

const failedTest = (e: unknown): TestStatus => ({
	state: "done",
	result: { ok: false, latencyMs: 0, detail: String(e) },
});

/**
 * models.yml changed: refresh the catalog, drop blank prewarmed drafts, and mark live sessions
 * stale. Stale sessions are restarted lazily when the user picks a model for them; nothing is
 * restarted here.
 */
async function syncModelConfig(invalidateProviders: readonly string[]): Promise<void> {
	await Promise.all([
		useModelCatalog.getState().refresh(invalidateProviders).catch(() => {}),
		useModelKindCatalog.getState().load(true),
	]);
	await invalidateWarmDrafts().catch(() => {});
	await markLiveSessionsStale().catch(() => {});
}

export const useProviders = create<ProvidersState>((set, get) => {
	/** Replace a row in place (or append when new), keeping the list sorted by id. */
	const applyRow = (row: ProviderRow, replacing: string = row.id) =>
		set((s) => {
			const rest = s.rows.filter((r) => r.id !== replacing && r.id !== row.id);
			return { rows: [...rest, row].sort((a, b) => a.id.localeCompare(b.id)) };
		});

	return {
		rows: [],
		loaded: false,
		error: null,
		tests: {},
		modelTests: {},

		load: async () => {
			try {
				const rows = await providerRows();
				set({ rows, loaded: true, error: null });
			} catch (e) {
				set({ error: String(e), loaded: true });
			}
		},

		setEnabled: async (id, enabled) => {
			const prev = get().rows;
			set((s) => ({ rows: s.rows.map((r) => (r.id === id ? { ...r, enabled } : r)) }));
			try {
				await providerSetEnabled(id, enabled);
			} catch (e) {
				set({ rows: prev });
				throw e;
			}
			await syncModelConfig([id]);
		},

		upsert: async (input, apiKey) => {
			const row = await providerUpsert(input, apiKey);
			if (input.originalId && input.originalId !== row.id) moveProviderWindow(input.originalId, row.id);
			applyRow(row, input.originalId ?? row.id);
			await syncModelConfig([input.originalId ?? row.id, row.id]);
			return row;
		},

		saveBuiltin: async (input, apiKey) => {
			const row = await providerSaveBuiltin(input, apiKey);
			applyRow(row, input.id);
			await syncModelConfig([input.id]);
			return row;
		},

		setKey: async (id, apiKey) => {
			const row = await providerSetKey(id, apiKey);
			applyRow(row);
			await syncModelConfig([id]);
			return row;
		},

		remove: async (id) => {
			await providerDelete(id);
			// Evict on confirmed deletion, even if reloading provider rows fails.
			setProviderWindow(id, null);
			const sync = syncModelConfig([id]);
			await get().load();
			await sync;
			set((s) => ({
				tests: Object.fromEntries(Object.entries(s.tests).filter(([key]) => key !== id)),
				modelTests: Object.fromEntries(
					Object.entries(s.modelTests).filter(([key]) => !key.startsWith(`${id}::`)),
				),
			}));
		},

		runTest: async (id) => {
			set((s) => ({ tests: { ...s.tests, [id]: { state: "testing" } } }));
			try {
				const result = await providerTest(id);
				set((s) => ({ tests: { ...s.tests, [id]: { state: "done", result } } }));
			} catch (e) {
				set((s) => ({ tests: { ...s.tests, [id]: failedTest(e) } }));
			}
		},

		runModelTest: async (providerId, modelId) => {
			const key = `${providerId}::${modelId}`;
			set((s) => ({ modelTests: { ...s.modelTests, [key]: { state: "testing" } } }));
			try {
				const result = await providerTestModel(providerId, modelId);
				set((s) => ({ modelTests: { ...s.modelTests, [key]: { state: "done", result } } }));
			} catch (e) {
				set((s) => ({ modelTests: { ...s.modelTests, [key]: failedTest(e) } }));
			}
		},

		exportEnvText: (ids) => providerExportEnvText(ids ?? null),
	};
});
