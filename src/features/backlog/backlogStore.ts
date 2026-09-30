// Zustand store: backlog items cache.
import { create } from "zustand";
import type { BacklogItem } from "../../lib/contracts";
import { onBacklogChanged } from "../../lib/events";
import { backlogList } from "../../lib/ipc";

interface BacklogState {
	items: BacklogItem[];
	loading: boolean;
	load(): Promise<void>;
}

let subscribed = false;
export const useBacklog = create<BacklogState>((set, get) => ({
	items: [],
	loading: false,
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
