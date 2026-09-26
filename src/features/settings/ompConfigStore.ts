/** [D] Shared store for OMP config entries — feeds the settings sub-nav and panel. */

import { create } from "zustand";
import type { OmpConfigEntry } from "../../lib/contracts";
import { ompConfigList } from "../../lib/ipc";

interface OmpConfigState {
	entries: OmpConfigEntry[];
	loading: boolean;
	loaded: boolean;
	error: string | null;
	/** Fetch once; `force` re-runs even when already loaded (after edits). */
	load(force?: boolean): Promise<void>;
}

let inflight: Promise<void> | null = null;

export const useOmpConfigStore = create<OmpConfigState>((set, get) => ({
	entries: [],
	loading: false,
	loaded: false,
	error: null,
	load: (force = false) => {
		if (get().loaded && !force) return Promise.resolve();
		if (inflight) return inflight;
		set({ loading: true, error: null });
		inflight = ompConfigList()
			.then((r) => {
				if (r.found) {
					set({ entries: r.entries, loaded: true, error: null });
				} else {
					set({ error: r.error ?? "无法读取 OMP 配置", loaded: false });
				}
			})
			.catch((e) => set({ error: String(e), loaded: false }))
			.finally(() => {
				inflight = null;
				set({ loading: false });
			});
		return inflight;
	},
}));
