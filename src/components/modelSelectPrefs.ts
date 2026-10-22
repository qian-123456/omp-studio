/** Persisted picker prefs shared by every ModelSelect: recent models + dismissed role guides. */
import { create } from "zustand";
import { pushRecent, removeRecent } from "./modelSelectLogic";

const RECENT_KEY = "omp-workspace.recentModels";
const DISMISSED_KEY = "omp-workspace.dismissedRoleGuides";

function readList(key: string): string[] {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
	} catch {
		return [];
	}
}

function writeList(key: string, list: string[]) {
	try {
		localStorage.setItem(key, JSON.stringify(list));
	} catch {
		// Storage unavailable (private mode / quota) — keep in-memory state only.
	}
}

interface ModelSelectPrefs {
	recent: string[];
	dismissedGuides: string[];
	recordRecent(key: string): void;
	removeRecent(key: string): void;
	/** Replace the whole list (used to undo a removal). */
	setRecent(list: string[]): void;
	dismissGuide(role: string): void;
}

export const useModelSelectPrefs = create<ModelSelectPrefs>((set, get) => ({
	recent: readList(RECENT_KEY),
	dismissedGuides: readList(DISMISSED_KEY),
	recordRecent: (key) => {
		const recent = pushRecent(get().recent, key);
		writeList(RECENT_KEY, recent);
		set({ recent });
	},
	removeRecent: (key) => {
		const recent = removeRecent(get().recent, key);
		writeList(RECENT_KEY, recent);
		set({ recent });
	},
	setRecent: (recent) => {
		writeList(RECENT_KEY, recent);
		set({ recent });
	},
	dismissGuide: (role) => {
		if (get().dismissedGuides.includes(role)) return;
		const dismissedGuides = [...get().dismissedGuides, role];
		writeList(DISMISSED_KEY, dismissedGuides);
		set({ dismissedGuides });
	},
}));
