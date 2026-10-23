/** Pure helpers for the shared settings file editor. */

/** Files larger than this open read-only. */
export const MAX_EDIT_BYTES = 1024 * 1024;

/** Prefix the Rust side puts on stamp-mismatch errors (omp_files.rs CONFLICT_PREFIX). */
export const CONFLICT_PREFIX = "CONFLICT:";

export function isTooLargeToEdit(text: string): boolean {
	return new TextEncoder().encode(text).length > MAX_EDIT_BYTES;
}

/** Tauri rejects with the Rust `String`; tolerate Error wrappers too. */
export function isConflictError(e: unknown): boolean {
	const msg = typeof e === "string" ? e : e instanceof Error ? e.message : "";
	return msg.startsWith(CONFLICT_PREFIX);
}

/**
 * Readable text for failures of the omp file commands. A missing command means
 * the running app predates this feature and must be restarted.
 */
export function describeFileCommandError(e: unknown): string {
	const msg = typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
	if (/not found|unknown command|did not find/i.test(msg) && /omp_(memory|rule)/.test(msg)) {
		return "当前运行的应用还不包含这项功能，请重启应用后再试";
	}
	return msg;
}
