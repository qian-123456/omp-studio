import { DEFAULT_LOCALE, type Locale, type TranslationSchema } from "./types";
import { zhCN } from "./locales/zh-CN";
import { enUS } from "./locales/en-US";

export * from "./types";

export const LOCALES: Record<Locale, TranslationSchema> = {
	"zh-CN": zhCN,
	"en-US": enUS,
};

function flattenDictionary(schema: TranslationSchema): Map<string, string> {
	const map = new Map<string, string>();
	function walk(node: unknown, prefix: string): void {
		if (typeof node === "string") {
			map.set(prefix, node);
			return;
		}
		if (node && typeof node === "object") {
			for (const [key, val] of Object.entries(node)) {
				const nextKey = prefix ? `${prefix}.${key}` : key;
				walk(val, nextKey);
			}
		}
	}
	walk(schema, "");
	return map;
}

const FLAT_DICTS: Record<Locale, Map<string, string>> = {
	"zh-CN": flattenDictionary(zhCN),
	"en-US": flattenDictionary(enUS),
};

/**
 * Replace placeholders like `{name}` or `{count}` with values.
 */
export function interpolate(template: string, params?: Record<string, string | number>): string {
	if (!params) return template;
	return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (match, key: string) => {
		const val = params[key];
		return val != null ? String(val) : match;
	});
}

/**
 * Translate a key into the target locale string, falling back to DEFAULT_LOCALE and then key name.
 *
 * @param key Dot-notated key path, e.g. "common.confirm" or "settings.appearance.title"
 * @param params Optional replacement variables for `{param}` tokens
 * @param locale Explicit locale override; defaults to DEFAULT_LOCALE ("zh-CN")
 */
export function t(
	key: string,
	params?: Record<string, string | number>,
	locale: Locale = DEFAULT_LOCALE,
): string {
	const currentDict = FLAT_DICTS[locale] ?? FLAT_DICTS[DEFAULT_LOCALE];
	let pattern = currentDict.get(key);

	// Fallback to default locale if not found in current dictionary
	if (pattern === undefined && locale !== DEFAULT_LOCALE) {
		pattern = FLAT_DICTS[DEFAULT_LOCALE]?.get(key);
	}

	// Final fallback: return key itself if not resolved
	if (pattern === undefined) {
		return key;
	}

	return interpolate(pattern, params);
}
