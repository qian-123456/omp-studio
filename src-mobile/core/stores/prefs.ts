import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Skin = "chatgpt" | "gemini";
export type SchemePref = "system" | "light" | "dark";
export type Scheme = "light" | "dark";
export type PrefValue = string | number | boolean;

export const PREFS_KEY = "ompm.prefs";

interface PrefsState {
	skin: Skin;
	/** `system` follows prefers-color-scheme. */
	scheme: SchemePref;
	/** In-page sound when a session needs attention (LAN fallback for web push). */
	notifySound: boolean;
	/** Flash document.title when a session needs attention while the page is hidden. */
	titleFlash: boolean;
	/** Free-form slice-owned prefs (`usePref("chat.showThinking", true)`), persisted with the rest. */
	extra: Record<string, PrefValue>;
	set: (patch: Partial<Pick<PrefsState, "skin" | "scheme" | "notifySound" | "titleFlash">>) => void;
	setExtra: (key: string, value: PrefValue) => void;
}

export const usePrefs = create<PrefsState>()(
	persist(
		(set) => ({
			skin: "chatgpt",
			scheme: "system",
			notifySound: true,
			titleFlash: true,
			extra: {},
			set: (patch) => set(patch),
			setExtra: (key, value) => set((s) => ({ extra: { ...s.extra, [key]: value } })),
		}),
		{
			name: PREFS_KEY,
			version: 1,
			partialize: (s) => ({ skin: s.skin, scheme: s.scheme, notifySound: s.notifySound, titleFlash: s.titleFlash, extra: s.extra }),
		},
	),
);

/** Read/write one slice-owned pref: `const [v, setV] = usePref("chat.showThinking", true)`. */
export function usePref<T extends PrefValue>(key: string, fallback: T): [T, (v: T) => void] {
	const value = usePrefs((s) => s.extra[key]);
	const setExtra = usePrefs.getState().setExtra;
	return [(value === undefined ? fallback : (value as T)), (v: T) => setExtra(key, v)];
}

/** Resolve the effective colour scheme. */
export const resolveScheme = (pref: SchemePref, systemDark: boolean): Scheme =>
	pref === "system" ? (systemDark ? "dark" : "light") : pref;
