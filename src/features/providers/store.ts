/** [providers] Provider list store for the settings panel. */

import { create } from "zustand";
import type {
	OmpProviderInfo,
	ProviderConfig,
	ProviderTestResult,
} from "../../lib/contracts";
import {
	providerDelete,
	providerExportEnvText,
	ompProvidersList,
	providerList,
	providerReorder,
	providerSave,
	providerSetEnabled,
	providerTest,
} from "../../lib/ipc";

export type TestStatus =
	| { state: "testing" }
	| { state: "done"; result: ProviderTestResult };

interface ProvidersState {
	providers: ProviderConfig[];
	loaded: boolean;
	error: string | null;
	ompProviders: OmpProviderInfo[];
	ompLoaded: boolean;
	ompError: string | null;
	/** Per-provider inline probe state (ProviderPanel rows). */
	tests: Record<string, TestStatus>;
	load(): Promise<void>;
	loadOmp(): Promise<void>;
	/** Upsert via backend; returns the saved config. */
	save(config: ProviderConfig, apiKey?: string | null): Promise<ProviderConfig>;
	remove(id: string): Promise<void>;
	setEnabled(id: string, enabled: boolean): Promise<void>;
	reorder(ids: string[]): Promise<void>;
	runTest(id: string): Promise<void>;
	exportEnvText(ids?: string[]): Promise<string>;
}

export const useProviders = create<ProvidersState>((set, get) => ({
	providers: [],
	loaded: false,
	error: null,
	ompProviders: [],
	ompLoaded: false,
	ompError: null,
	tests: {},

	loadOmp: async () => {
		try {
			const ompProviders = await ompProvidersList();
			set({ ompProviders, ompLoaded: true, ompError: null });
		} catch (e) {
			set({ ompError: String(e), ompLoaded: true });
		}
	},

	load: async () => {
		const loadWorkbench = async () => {
			try {
				const providers = await providerList();
				set({ providers, loaded: true, error: null });
			} catch (e) {
				set({ error: String(e), loaded: true });
			}
		};
		await Promise.all([loadWorkbench(), get().loadOmp()]);
	},

	save: async (config, apiKey) => {
		const saved = await providerSave(config, apiKey ?? null);
		set((s) => {
			const exists = s.providers.some((p) => p.id === saved.id);
			const providers = exists
				? s.providers.map((p) => (p.id === saved.id ? saved : p))
				: [...s.providers, saved];
			providers.sort((a, b) => a.sort - b.sort);
			return { providers };
		});
		return saved;
	},

	remove: async (id) => {
		await providerDelete(id);
		set((s) => ({
			providers: s.providers.filter((p) => p.id !== id),
			tests: Object.fromEntries(
				Object.entries(s.tests).filter(([key]) => key !== id),
			),
		}));
	},

	setEnabled: async (id, enabled) => {
		// Optimistic toggle; revert on failure.
		const prev = get().providers;
		set((s) => ({
			providers: s.providers.map((p) => (p.id === id ? { ...p, enabled } : p)),
		}));
		try {
			await providerSetEnabled(id, enabled);
		} catch (e) {
			set({ providers: prev });
			throw e;
		}
	},

	reorder: async (ids) => {
		await providerReorder(ids);
		await get().load();
	},

	runTest: async (id) => {
		set((s) => ({ tests: { ...s.tests, [id]: { state: "testing" } } }));
		try {
			const result = await providerTest(id);
			set((s) => ({
				tests: { ...s.tests, [id]: { state: "done", result } },
			}));
		} catch (e) {
			set((s) => ({
				tests: {
					...s.tests,
					[id]: {
						state: "done",
						result: { ok: false, latencyMs: 0, detail: String(e) },
					},
				},
			}));
		}
	},

	exportEnvText: (ids) => providerExportEnvText(ids ?? null),
}));
