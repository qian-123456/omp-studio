import { useMemo } from "react";
import { create } from "zustand";
import type { Model } from "../lib/contracts";
import { listModels } from "../lib/ipc";
import { type ModelOption, parseModels } from "../lib/models";

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
		return out.length > 0 ? out : null;
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
	/** Raw `list_models` result; null = never loaded. */
	models: Model[] | null;
	loading: boolean;
	/** Re-fetch the catalog; concurrent calls share one in-flight request. */
	refresh: () => Promise<void>;
}

let inflight: Promise<void> | null = null;

/** App-wide model catalog (`omp models --json`), refreshed whenever a picker opens. */
export const useModelCatalog = create<ModelCatalogState>((set) => ({
	models: readCachedModels(),
	loading: false,
	refresh: () => {
		inflight ??= (async () => {
			set({ loading: true });
			try {
				const list = await listModels();
				if (Array.isArray(list) && list.length > 0) {
					set({ models: list });
					writeCachedModels(list);
				}
			} catch {
				// Keep the previous catalog on failure.
			} finally {
				inflight = null;
				set({ loading: false });
			}
		})();
		return inflight;
	},
}));

/** Catalog as picker options; null until the first load. */
export function useModelOptions(): ModelOption[] | null {
	const models = useModelCatalog((s) => s.models);
	return useMemo(() => (models ? parseModels(models) : null), [models]);
}
