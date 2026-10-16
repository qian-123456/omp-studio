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

export interface BacklogEditBuffer {
	id: string;
	/** Editable text: image tokens (`🖼️ #N`) index into `images`. */
	text: string;
	images?: string[];
}

const DRAFT_KEY = "ompws:backlog-draft";
const CAPTURE_KEY = "ompws:backlog-capture-draft";
const EDIT_KEY = "ompws:backlog-edit-buffer";
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

function readDraft(key: string, fallbackKind: BacklogKind): BacklogDraft {
	const empty = { text: "", kind: fallbackKind, images: [] };
	try {
		const raw = localStorage.getItem(key);
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

function readEditBuffer(): BacklogEditBuffer | null {
	try {
		const raw = localStorage.getItem(EDIT_KEY);
		if (!raw) return null;
		const v = JSON.parse(raw) as Partial<BacklogEditBuffer>;
		if (typeof v.id !== "string" || typeof v.text !== "string") return null;
		return Array.isArray(v.images)
			? { id: v.id, text: v.text, images: v.images.filter((p): p is string => typeof p === "string") }
			: { id: v.id, text: v.text };
	} catch {
		return null;
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
	/** Quick-capture modal input, persisted so a page reload does not lose it. */
	captureDraft: BacklogDraft;
	setCaptureDraft(patch: Partial<BacklogDraft>): void;
	clearCaptureDraft(): void;
	/** Unsaved edit of an existing item; dropped on load() if the item is gone. */
	editBuffer: BacklogEditBuffer | null;
	setEditBuffer(buf: BacklogEditBuffer): void;
	clearEditBuffer(): void;
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
			const buf = get().editBuffer;
			set({ items });
			if (buf && !items.some((i) => i.id === buf.id)) get().clearEditBuffer();
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
	draft: readDraft(DRAFT_KEY, initialLastKind),
	setDraft: (patch) => {
		const draft = { ...get().draft, ...patch };
		set({ draft });
		write(DRAFT_KEY, JSON.stringify(draft));
	},
	clearDraft: () => {
		set({ draft: { text: "", kind: get().lastKind, images: [] } });
		write(DRAFT_KEY, null);
	},
	captureDraft: readDraft(CAPTURE_KEY, initialLastKind),
	setCaptureDraft: (patch) => {
		const captureDraft = { ...get().captureDraft, ...patch };
		set({ captureDraft });
		write(CAPTURE_KEY, JSON.stringify(captureDraft));
	},
	clearCaptureDraft: () => {
		set({ captureDraft: { text: "", kind: get().lastKind, images: [] } });
		write(CAPTURE_KEY, null);
	},
	editBuffer: readEditBuffer(),
	setEditBuffer: (buf) => {
		set({ editBuffer: buf });
		write(EDIT_KEY, JSON.stringify(buf));
	},
	clearEditBuffer: () => {
		set({ editBuffer: null });
		write(EDIT_KEY, null);
	},
	lastKind: initialLastKind,
	setLastKind: (k) => {
		set({ lastKind: k });
		write(LAST_KIND_KEY, k);
	},
}));
