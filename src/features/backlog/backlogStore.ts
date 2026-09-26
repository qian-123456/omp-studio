// Zustand store: backlog panel open state + items cache for the top capsule.
import { create } from "zustand";
import type { BacklogItem } from "../../lib/contracts";
import { onBacklogChanged } from "../../lib/events";
import { backlogList } from "../../lib/ipc";

interface BacklogState {
	/** Panel open (anchored popover under top capsule). */
	open: boolean;
	items: BacklogItem[];
	loading: boolean;
	setOpen(v: boolean): void;
	toggle(): void;
	load(): Promise<void>;
}

let subscribed = false;
export const useBacklog = create<BacklogState>((set, get) => ({
	open: false,
	items: [],
	loading: false,
	setOpen: (v) => set({ open: v }),
	toggle: () => set((s) => ({ open: !s.open })),
	load: async () => {
		set({ loading: true });
		try {
			const items = await backlogList();
			set({ items });
		} finally {
			set({ loading: false });
		}
		if (!subscribed) {
			subscribed = true;
			void onBacklogChanged(() => {
				get()
					.load()
					.catch(() => {});
			});
		}
	},
}));
