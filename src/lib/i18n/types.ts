/** Supported application locales. */
export type Locale = "zh-CN" | "en-US";

export const DEFAULT_LOCALE: Locale = "zh-CN";

export interface LocaleOption {
	value: Locale;
	label: string;
	nativeLabel: string;
}

export const SUPPORTED_LOCALES: LocaleOption[] = [
	{ value: "zh-CN", label: "简体中文", nativeLabel: "简体中文" },
	{ value: "en-US", label: "English", nativeLabel: "English" },
];

