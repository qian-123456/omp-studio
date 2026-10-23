/**
 * Effective in-window shortcut bindings: registry defaults plus the user's
 * overrides (persisted in localStorage like the other UI preferences).
 * An override of "" means "unbound".
 */
import { create } from "zustand";
import { canonicalAccelerator, eventMatchesAccelerator } from "./accelerator";
import { SHORTCUTS, shortcutDef, type ShortcutId } from "./registry";

const STORAGE_KEY = "ompws:shortcut-overrides";

type Overrides = Partial<Record<ShortcutId, string>>;

function load(): Overrides {
	try {
		const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as unknown;
		if (!raw || typeof raw !== "object") return {};
		const out: Overrides = {};
		for (const s of SHORTCUTS) {
			const v = (raw as Record<string, unknown>)[s.id];
			if (s.editable && typeof v === "string" && v !== s.defaultAccelerator) out[s.id] = v;
		}
		return out;
	} catch {
		return {};
	}
}

function persist(o: Overrides): void {
	try {
		if (Object.keys(o).length === 0) localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
	} catch {
		/* storage unavailable: keep in-memory only */
	}
}

interface BindingsState {
	overrides: Overrides;
	/** Bind `id` to `accelerator` ("" unbinds). Caller resolves conflicts first (`findConflict`). */
	setBinding(id: ShortcutId, accelerator: string): void;
	resetBinding(id: ShortcutId): void;
	resetAll(): void;
}

export const useShortcutBindings = create<BindingsState>((set, get) => ({
	overrides: load(),
	setBinding: (id, accelerator) => {
		const def = shortcutDef(id);
		if (!def.editable) return;
		const next = { ...get().overrides };
		if (accelerator === def.defaultAccelerator) delete next[id];
		else next[id] = accelerator;
		persist(next);
		set({ overrides: next });
	},
	resetBinding: (id) => get().setBinding(id, shortcutDef(id).defaultAccelerator),
	resetAll: () => {
		persist({});
		set({ overrides: {} });
	},
}));

/** Effective accelerator of `id` ("" = unbound). */
export function acceleratorOf(id: ShortcutId, overrides: Overrides = useShortcutBindings.getState().overrides): string {
	return overrides[id] ?? shortcutDef(id).defaultAccelerator;
}

/** The editable shortcut `e` triggers, or null. Fixed entries are never matched here. */
export function matchShortcut(e: KeyboardEvent): ShortcutId | null {
	const { overrides } = useShortcutBindings.getState();
	for (const s of SHORTCUTS) {
		if (s.editable && eventMatchesAccelerator(e, acceleratorOf(s.id, overrides))) return s.id;
	}
	return null;
}

/** Another shortcut (editable or fixed) already on `accelerator`, or null. */
export function findConflict(id: ShortcutId, accelerator: string): ShortcutId | null {
	const want = canonicalAccelerator(accelerator);
	if (!want) return null;
	const { overrides } = useShortcutBindings.getState();
	for (const s of SHORTCUTS) {
		if (s.id !== id && canonicalAccelerator(acceleratorOf(s.id, overrides)) === want) return s.id;
	}
	return null;
}
