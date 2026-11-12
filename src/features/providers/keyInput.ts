/** [providers] Logic shared by every place a key is entered: plain text vs environment variable. */

import type { ProviderRow } from "../../lib/contracts";
import { toast } from "../../lib/toast";
import { tNow } from "../../stores/language";

/** Same shape the backend accepts as an env-var reference (rows.rs::is_env_name). */
export const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/;

export type KeyInputMode = "plain" | "env";

export type KeyInputProblem = "envEmpty" | "envInvalid" | "plainLooksLikeName" | "plainRequired";

export const isEnvName = (value: string): boolean => ENV_NAME_RE.test(value.trim());

/** `envVar` rows open in env mode; everything else is plain text. */
export function initialKeyInputMode(row?: Pick<ProviderRow, "key"> | null): KeyInputMode {
	return row?.key.kind === "envVar" ? "env" : "plain";
}

/** The row's current variable name, else the preset's conventional one, else empty. */
export function initialEnvName(row?: Pick<ProviderRow, "key"> | null, presetEnvVar?: string): string {
	if (row?.key.kind === "envVar" && row.key.envVar) return row.key.envVar;
	return presetEnvVar ?? "";
}

export function keyInputProblem(args: {
	mode: KeyInputMode;
	envName: string;
	plainKey: string;
	/** Plain mode must carry a typed key (e.g. switching away from an env reference). */
	requirePlainKey?: boolean;
}): KeyInputProblem | null {
	if (args.mode === "env") {
		const name = args.envName.trim();
		if (!name) return "envEmpty";
		return isEnvName(name) ? null : "envInvalid";
	}
	const key = args.plainKey.trim();
	if (key && isEnvName(key)) return "plainLooksLikeName";
	if (!key && args.requirePlainKey) return "plainRequired";
	return null;
}

/** What goes into `apiKey`: the variable name in env mode, the typed key (or null = keep) in plain mode. */
export function keyToSend(args: { mode: KeyInputMode; envName: string; plainKey: string }): string | null {
	if (args.mode === "env") return args.envName.trim();
	return args.plainKey.trim() || null;
}

/** True when env mode was saved but the variable is missing from the app's own environment. */
export function isEnvUnsetAfterSave(row: ProviderRow | undefined, mode: KeyInputMode): boolean {
	return mode === "env" && !!row && row.key.kind === "envVar" && row.key.envSet !== true;
}

/** Long how-to-fix notice for a saved-but-unset variable. */
export function toastEnvUnset(row: ProviderRow): void {
	toast.info(tNow("providers.envSavedUnsetToast", { name: row.key.envVar ?? "" }), 15000);
}

/** Success toast; in env mode with the variable missing, the how-to-fix notice instead. */
export function toastKeySaved(row: ProviderRow | undefined, mode: KeyInputMode, successText: string): void {
	if (row && isEnvUnsetAfterSave(row, mode)) toastEnvUnset(row);
	else toast.success(successText);
}
