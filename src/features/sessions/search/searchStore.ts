import { create } from "zustand";

interface SearchDialogState {
	open: boolean;
	/** Bumped on every open request (⌘F while open too) so the input re-focuses. */
	focusSeq: number;
	openDialog: () => void;
	closeDialog: () => void;
}

export const useSearchDialog = create<SearchDialogState>((set) => ({
	open: false,
	focusSeq: 0,
	openDialog: () => set((s) => ({ open: true, focusSeq: s.focusSeq + 1 })),
	closeDialog: () => set({ open: false }),
}));
