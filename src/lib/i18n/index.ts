import type { MessageTree, NamespaceMessages } from "./define";
import { DEFAULT_LOCALE, type Locale } from "./types";

export * from "./types";
export { defineMessages } from "./define";

/**
 * Every `messages/<namespace>.ts` registers itself: the file name is the key
 * prefix, so `messages/git.ts` → `t("git.…")`. New namespaces need no edit here.
 */
const NAMESPACES = import.meta.glob<NamespaceMessages>("./messages/*.ts", {
	eager: true,
	import: "default",
});

function flatten(node: MessageTree, prefix: string, into: Map<string, string>): void {
	for (const [key, val] of Object.entries(node)) {
		const path = `${prefix}.${key}`;
		if (typeof val === "string") into.set(path, val);
		else flatten(val, path, into);
	}
}

function buildDict(locale: Locale): Map<string, string> {
	const map = new Map<string, string>();
	for (const [file, messages] of Object.entries(NAMESPACES)) {
		const ns = file.slice(file.lastIndexOf("/") + 1, -".ts".length);
		flatten(messages[locale] as MessageTree, ns, map);
	}
	return map;
}

/** Flattened dot-path → template, per locale. Exported for the parity/coverage tests. */
export const FLAT_DICTS: Record<Locale, ReadonlyMap<string, string>> = {
	"zh-CN": buildDict("zh-CN"),
	"en-US": buildDict("en-US"),
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
	const pattern = FLAT_DICTS[locale]?.get(key) ?? FLAT_DICTS[DEFAULT_LOCALE].get(key);
	return pattern === undefined ? key : interpolate(pattern, params);
}
