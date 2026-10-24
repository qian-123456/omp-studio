import { create } from "zustand";
import {
	DEFAULT_LOCALE,
	type Locale,
	t as translate,
} from "../lib/i18n";

const STORAGE_KEY = "ompws:locale";

function detectInitialLocale(): Locale {
	try {
		if (typeof window !== "undefined" && window.localStorage) {
			const saved = window.localStorage.getItem(STORAGE_KEY);
			if (saved === "zh-CN" || saved === "en-US") {
				return saved;
			}
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

/**
 * Convenient React hook to consume current locale and translate strings reactively.
 */
export function useT() {
	const locale = useLanguageStore((s) => s.locale);
	const setLocale = useLanguageStore((s) => s.setLocale);
	const t = (key: string, params?: Record<string, string | number>) => {
		return translate(key, params, locale);
	};
	return { locale, setLocale, t };
}
