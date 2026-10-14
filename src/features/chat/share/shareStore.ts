import { create } from "zustand";

export interface ShareSelectionState {
	/** Non-null while selection mode is active for that session. */
	sessionId: string | null;
	/** Selected TranscriptItem ids: a turn's userItem.id and/or answerItem.id. */
	selectedIds: string[];
	/** Enter selection mode for `sessionId`, replacing any previous selection. */
	begin(sessionId: string, preselectedIds?: string[]): void;
	toggle(itemId: string): void;
	setSelected(ids: string[]): void;
	/** Leave selection mode and clear the selection. */
	cancel(): void;
}

export const useShareSelection = create<ShareSelectionState>((set) => ({
	sessionId: null,
	selectedIds: [],
	begin: (sessionId, preselectedIds = []) =>
		set({ sessionId, selectedIds: [...new Set(preselectedIds)] }),
	toggle: (itemId) =>
		set((s) => ({
			selectedIds: s.selectedIds.includes(itemId)
				? s.selectedIds.filter((id) => id !== itemId)
				: [...s.selectedIds, itemId],
		})),
	setSelected: (ids) => set({ selectedIds: [...new Set(ids)] }),
	cancel: () => set({ sessionId: null, selectedIds: [] }),
}));
