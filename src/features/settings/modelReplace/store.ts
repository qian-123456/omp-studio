/**
 * [D] Cross-panel invalidation after a bulk model replace.
 *
 * A replace writes config files, app settings and schedule rows behind the
 * settings pages' backs, so every store they read must re-read: the omp config
 * entries, the app settings, the schedule list and — through `revision` — the
 * model-role panel, whose snapshot lives in local component state.
 */
import { create } from "zustand";
import { useSchedulesStore } from "../../schedules/schedulesStore";
import { useOmpConfigStore } from "../ompConfigStore";
import { useSettings } from "../store";

interface ModelReplaceState {
	/** Bumped after every successful apply/undo. */
	revision: number;
	bump: () => void;
}

export const useModelReplaceStore = create<ModelReplaceState>((set) => ({
	revision: 0,
	bump: () => set((state) => ({ revision: state.revision + 1 })),
}));

/** Re-read every source a replace or undo touched. */
export function invalidateAfterModelReplace(): void {
	useModelReplaceStore.getState().bump();
	useOmpConfigStore.getState().invalidate();
	void useSettings.getState().load();
	void useSchedulesStore.getState().load();
}
