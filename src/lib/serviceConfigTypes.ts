export interface ServiceConfigSnapshot {
	target: string;
	stamp: string;
	values: Record<string, string | number | boolean>;
	secrets: Record<string, boolean>;
}
/** Omit to preserve; null explicitly resets; secret values are never read back. */
export type ServiceConfigChanges = Record<string, string | number | boolean | null>;
