import { useMemo } from "react";
import { create } from "zustand";
import type { Model } from "../lib/contracts";
import { listModels, ompModelsContextWindowOverrides, ompModelsSetContextWindows } from "../lib/ipc";
import { type ModelOption, parseModels } from "../lib/models";
import { loadProviderWindows, loadRules, pickRule } from "../features/settings/contextWindow/core";
import { errMsg } from "../lib/dialogs";
import { toast } from "../lib/toast";
import { tNow } from "./language";

const CACHE_KEY = "ompws:cached-models";

/**
 * Last catalog persisted in localStorage. Accepts both the current shape
 * (raw `Model[]`) and the legacy parsed `ModelOption[]` (a subset of `Model`);
 * malformed entries are dropped, unusable payloads yield null.
 */
export function readCachedModels(): Model[] | null {
	try {
		const raw = globalThis.localStorage?.getItem(CACHE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!Array.isArray(parsed)) return null;
		const out: Model[] = [];
		for (const item of parsed) {
			if (!item || typeof item !== "object") continue;
			const o = item as Record<string, unknown>;
			if (typeof o.provider !== "string" || typeof o.id !== "string") continue;
			if (!o.provider || !o.id) continue;
			out.push({
				provider: o.provider,
				id: o.id,
				name: typeof o.name === "string" && o.name ? o.name : `${o.provider}/${o.id}`,
				thinking: Array.isArray(o.thinking)
					? o.thinking.filter((t): t is string => typeof t === "string")
					: undefined,
				contextWindow: typeof o.contextWindow === "number" ? o.contextWindow : null,
				reasoning: typeof o.reasoning === "boolean" ? o.reasoning : undefined,
			});
		}
		return parsed.length === 0 || out.length > 0 ? out : null;
	} catch {
		return null;
	}
}

function writeCachedModels(models: Model[]): void {
	try {
		globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(models));
	} catch {
		// Storage full/unavailable: the in-memory catalog still works.
	}
}

interface ModelCatalogState {
	/** Last-known catalog, not a guarantee of current provider availability. */
	models: Model[] | null;
	loading: boolean;
	status: "idle" | "unverified" | "stale" | "failed";
	error: string | null;
	/** Ordinary opens deduplicate. Confirmed mutations evict affected providers
	 * from memory/cache and supersede every request started before the mutation. */
	refresh: (invalidateProviders?: readonly string[]) => Promise<void>;
}

let inflight: Promise<void> | null = null;
let generation = 0;
const cachedModels = readCachedModels();

export const useModelCatalog = create<ModelCatalogState>((set, get) => ({
	models: cachedModels,
	loading: false,
	status: cachedModels === null ? "idle" : "stale",
	error: null,
	refresh: (invalidateProviders) => {
		if (invalidateProviders === undefined && inflight) return inflight;
		const current = ++generation;
		if (invalidateProviders !== undefined) {
			const affected = new Set(invalidateProviders);
			const previous = get().models;
			if (previous !== null) {
				const models = previous.filter((model) => !affected.has(model.provider));
				set({ models, status: "stale" });
				writeCachedModels(models);
			}
		}
		set({ loading: true, error: null });
		// Keep one last-known snapshot, not a union claiming missing entries valid.
		const publish = (list: Model[]): boolean => {
			if (current !== generation) return false;
			const keys = new Set(list.map((m) => `${m.provider}\0${m.id}`));
			if (get().models?.some((m) => !keys.has(`${m.provider}\0${m.id}`))) {
				set({ status: "stale", error: tNow("models.catalogShrink") });
				return false;
			}
			set({ models: list, status: "unverified", error: null });
			writeCachedModels(list);
			return true;
		};
		const request = (async () => {
			try {
				const snapshot = await listModels();
				const list = snapshot.models;
				if (!publish(list)) return;
				const rules = loadRules();
				const providerWindows = loadProviderWindows();
				let writing = false;
				if (rules.length > 0 || Object.keys(providerWindows).length > 0) {
					try {
						const overrides = await ompModelsContextWindowOverrides();
						if (current !== generation) return;
						const explicit = new Set(overrides.map((o) => `${o.providerId}\0${o.modelId}`));
						const edits = list.flatMap((model) => {
							const window = providerWindows[model.provider] ?? pickRule(rules, model.id)?.contextWindow;
							return window != null && !explicit.has(`${model.provider}\0${model.id}`)
								? [{ providerId: model.provider, modelId: model.id, contextWindow: window }]
								: [];
						});
						if (edits.length > 0) {
							writing = true;
							await ompModelsSetContextWindows(edits, true);
							if (current !== generation) return;
							publish((await listModels()).models);
						}
					} catch (error) {
						if (current !== generation) return;
						set({ status: "stale", error: tNow("models.catalogRefreshFailed", { error: errMsg(error) }) });
						toast.error(tNow(writing ? "settingsSectionsContext.context.writeFailed" : "settingsSectionsContext.context.readOverridesFailed", { error: errMsg(error) }));
					}
				}
			} catch (error) {
				if (current === generation) set({
					status: get().models === null ? "failed" : "stale",
					error: tNow("models.catalogRefreshFailed", { error: errMsg(error) }),
				});
			} finally {
				if (current === generation) {
					inflight = null;
					set({ loading: false });
				}
			}
		})();
		inflight = request;
		return request;
	},
}));

/** Catalog as picker options; null until the first load. */
export function useModelOptions(): ModelOption[] | null {
	const models = useModelCatalog((s) => s.models);
	return useMemo(() => (models ? parseModels(models) : null), [models]);
}
