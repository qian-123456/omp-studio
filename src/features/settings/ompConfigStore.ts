/** [D] Shared store for OMP config entries — feeds the settings sub-nav and panel. */

import { create } from "zustand";
import { tNow } from "../../stores/language";
import type { OmpConfigEntry } from "../../lib/contracts";
import { ompConfigList } from "../../lib/ipc";

interface OmpConfigState {
	entries: OmpConfigEntry[];
	loading: boolean;
	loaded: boolean;
	error: string | null;
	/** Fetch once; `force` re-runs even when already loaded (after edits). */
	load(force?: boolean): Promise<void>;
	/**
	 * Mark the cached list stale without reading, so the next load() re-reads.
	 * Used after writes made through another channel (model-role panel).
	 */
	invalidate(): void;
}

let inflight: Promise<void> | null = null;
let inflightGeneration = 0;
/** Bumped by invalidate(); a read started before a bump must not publish its result. */
let generation = 0;

export const useOmpConfigStore = create<OmpConfigState>((set, get) => ({
	entries: [],
	loading: false,
	loaded: false,
	error: null,
	load: (force = false) => {
		if (get().loaded && !force) return Promise.resolve();
		if (inflight && inflightGeneration === generation) return inflight;
		const gen = generation;
		set({ loading: true, error: null });
		const request: Promise<void> = ompConfigList()
			.then((r) => {
				if (gen !== generation) return;
				if (r.found) {
					set({ entries: r.entries, loaded: true, error: null });
				} else {
					set({ error: r.error ?? tNow("settingsCore.ompConfigStore.loadFailed"), loaded: false });
				}
			})
			.catch((e) => {
				if (gen === generation) set({ error: String(e), loaded: false });
			})
			.finally(() => {
				if (inflight === request) {
					inflight = null;
					set({ loading: false });
				}
			});
		inflight = request;
		inflightGeneration = gen;
		return request;
	},
	invalidate: () => {
		generation += 1;
		set({ loaded: false });
	},
}));
