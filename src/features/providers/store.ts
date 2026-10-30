/** [providers] OMP provider rows for the settings panel. */

import { create } from "zustand";
import type {
	BuiltinOverride,
	KeyMode,
	ProviderBulkResult,
	ProviderRow,
	ProviderTestResult,
	ProviderUpsert,
} from "../../lib/contracts";
import { invalidateWarmDrafts } from "../sessions/draftSession";
import { markLiveSessionsStale } from "../sessions/modelRegistrySync";
import { useModelCatalog } from "../../stores/modelCatalog";
import {
	providerSaveBuiltin,
	providerDecrypt,
	providerDelete,
	providerEncrypt,
	providerEncryptAll,
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
	/** Moves the plaintext key into the vault (models.yml keeps a command reference). */
	encrypt(id: string): Promise<ProviderRow>;
	/** Writes the key back into models.yml as plaintext and drops the vault entry. */
	decrypt(id: string): Promise<ProviderRow>;
	/** Encrypts every plaintext-key provider; reloads rows afterwards. */
	encryptAll(): Promise<ProviderBulkResult[]>;
	/** Null keeps key material, honoring keyMode for plaintext/managed encrypted keys; external references stay unchanged. */
	upsert(input: ProviderUpsert, apiKey: string | null, keyMode: KeyMode): Promise<ProviderRow>;
	/** Null keeps key material, honoring keyMode for plaintext/managed encrypted keys; external references stay unchanged. */
	saveBuiltin(input: BuiltinOverride, apiKey: string | null, keyMode: KeyMode): Promise<ProviderRow>;
	setKey(id: string, apiKey: string, keyMode: KeyMode): Promise<ProviderRow>;
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
async function syncModelConfig(): Promise<void> {
	await useModelCatalog.getState().refresh().catch(() => {});
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
		},

		encrypt: async (id) => {
			const row = await providerEncrypt(id);
			applyRow(row);
			return row;
		},

		decrypt: async (id) => {
			const row = await providerDecrypt(id);
			applyRow(row);
			return row;
		},

		encryptAll: async () => {
			const results = await providerEncryptAll();
			await get().load();
			return results;
		},

		upsert: async (input, apiKey, keyMode) => {
			const row = await providerUpsert(input, apiKey, keyMode);
			applyRow(row, input.originalId ?? row.id);
			await syncModelConfig();
			return row;
		},

		saveBuiltin: async (input, apiKey, keyMode) => {
			const row = await providerSaveBuiltin(input, apiKey, keyMode);
			applyRow(row, input.id);
			await syncModelConfig();
			return row;
		},

		setKey: async (id, apiKey, keyMode) => {
			const row = await providerSetKey(id, apiKey, keyMode);
			applyRow(row);
			return row;
		},

		remove: async (id) => {
			await providerDelete(id);
			await get().load();
			await syncModelConfig();
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
