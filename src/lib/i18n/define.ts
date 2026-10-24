/** A nested dictionary of UI strings; leaves are message templates with `{param}` tokens. */
export interface MessageTree {
	readonly [key: string]: string | MessageTree;
}

/** Same keys as `T`, every leaf a string: the shape a translation must match exactly. */
export type SameShape<T> = {
	readonly [K in keyof T]: T[K] extends string ? string : SameShape<T[K]>;
};

export interface NamespaceMessages<T extends MessageTree = MessageTree> {
	"zh-CN": T;
	"en-US": SameShape<T>;
}

/**
 * Declare one i18n namespace (the file name under `messages/` is the key prefix).
 * `zh-CN` is the source shape; `en-US` must have exactly the same keys — tsc
 * reports missing or extra keys at the call site.
 */
export function defineMessages<T extends MessageTree>(messages: {
	"zh-CN": T;
	"en-US": NoInfer<SameShape<T>>;
}): NamespaceMessages<T> {
	return messages;
}
