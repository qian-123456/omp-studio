// Zustand store: backlog items cache + persisted capture draft / last kind.
import { create } from "zustand";
import type { BacklogItem, BacklogKind } from "../../lib/contracts";
import { onBacklogChanged } from "../../lib/events";
import { backlogList } from "../../lib/ipc";

export interface BacklogDraft {
	text: string;
	kind: BacklogKind;
	images: string[];
}

const DRAFT_KEY = "ompws:backlog-draft";
const LAST_KIND_KEY = "ompws:backlog-last-kind";
const KINDS: readonly BacklogKind[] = ["todo", "bug", "idea"];

const isKind = (v: unknown): v is BacklogKind => KINDS.includes(v as BacklogKind);

function readLastKind(): BacklogKind {
	try {
		const v = localStorage.getItem(LAST_KIND_KEY);
		return isKind(v) ? v : "todo";
	} catch {
		return "todo";
	}
}

function readDraft(fallbackKind: BacklogKind): BacklogDraft {
	const empty = { text: "", kind: fallbackKind, images: [] };
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (!raw) return empty;
		const v = JSON.parse(raw) as Partial<BacklogDraft>;
		return {
			text: typeof v.text === "string" ? v.text : "",
			kind: isKind(v.kind) ? v.kind : fallbackKind,
			images: Array.isArray(v.images) ? v.images.filter((p): p is string => typeof p === "string") : [],
		};
	} catch {
		return empty;
	}
}

function write(key: string, value: string | null) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, value);
	} catch {
		// Storage unavailable (private mode / quota); state stays in memory.
	}
}

interface BacklogState {
	items: BacklogItem[];
	loading: boolean;
	load(): Promise<void>;
	/** Unsubmitted capture input, persisted across reopenings. */
	draft: BacklogDraft;
	setDraft(patch: Partial<BacklogDraft>): void;
	clearDraft(): void;
	/** Last chosen category; default for new captures. */
	lastKind: BacklogKind;
	setLastKind(k: BacklogKind): void;
}

const initialLastKind = readLastKind();

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
	draft: readDraft(initialLastKind),
	setDraft: (patch) => {
		const draft = { ...get().draft, ...patch };
		set({ draft });
		write(DRAFT_KEY, JSON.stringify(draft));
	},
	clearDraft: () => {
		set({ draft: { text: "", kind: get().lastKind, images: [] } });
		write(DRAFT_KEY, null);
	},
	lastKind: initialLastKind,
	setLastKind: (k) => {
		set({ lastKind: k });
		write(LAST_KIND_KEY, k);
	},
}));
