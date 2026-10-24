import { create } from "zustand";
import {
	DEFAULT_LOCALE,
	type Locale,
	t as translate,
} from "../lib/i18n";

const STORAGE_KEY = "ompws:locale";

function detectInitialLocale(): Locale {
	// Outside a webview (Node 21+ also exposes `navigator.language`) keep the default.
	if (typeof window === "undefined") return DEFAULT_LOCALE;
	try {
		const saved = window.localStorage?.getItem(STORAGE_KEY);
		if (saved === "zh-CN" || saved === "en-US") {
			return saved;
		}
		if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
			if (navigator.language.toLowerCase().startsWith("en")) {
				return "en-US";
			}
		}
	} catch {
		// Ignore storage/navigator access errors (e.g. restricted sandbox)
	}
	return DEFAULT_LOCALE;
}

export interface LanguageState {
	locale: Locale;
	setLocale: (next: Locale) => void;
	t: (key: string, params?: Record<string, string | number>) => string;
}

export const useLanguageStore = create<LanguageState>((set, get) => ({
	locale: detectInitialLocale(),
	setLocale: (next: Locale) => {
		try {
			if (typeof window !== "undefined" && window.localStorage) {
				window.localStorage.setItem(STORAGE_KEY, next);
			}
		} catch {
			// Ignore storage write errors
		}
		set({ locale: next });
	},
	t: (key: string, params?: Record<string, string | number>) => {
		return translate(key, params, get().locale);
	},
}));

export type Translate = (key: string, params?: Record<string, string | number>) => string;

// One translator per locale, so `t` keeps its identity across renders and is
// safe in hook deps: memos/effects re-run only when the locale changes.
const TRANSLATORS: Record<Locale, Translate> = {
	"zh-CN": (key, params) => translate(key, params, "zh-CN"),
	"en-US": (key, params) => translate(key, params, "en-US"),
};

/**
 * Convenient React hook to consume current locale and translate strings reactively.
 */
export function useT() {
	const locale = useLanguageStore((s) => s.locale);
	const setLocale = useLanguageStore((s) => s.setLocale);
	return { locale, setLocale, t: TRANSLATORS[locale] };
}

/**
 * Translate with the current locale outside React (pure helpers, stores,
 * module-level label getters). Call it at use time, never at module load,
 * so a locale switch is picked up on the next render.
 */
export function tNow(key: string, params?: Record<string, string | number>): string {
	return translate(key, params, useLanguageStore.getState().locale);
}
