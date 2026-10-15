/** [B] Cross-component composer/session UI flags: slash commands and deep
 * links open surfaces owned by other widgets (e.g. the bottom-bar session
 * stats popover) through this store instead of prop drilling. */

import { create } from "zustand";

interface ChatUiState {
	/** SessionStatsPopover in BottomBar. */
	statsOpen: boolean;
	setStatsOpen(open: boolean): void;
}

export const useChatUi = create<ChatUiState>((set) => ({
	statsOpen: false,
	setStatsOpen: (open) => set({ statsOpen: open }),
}));
