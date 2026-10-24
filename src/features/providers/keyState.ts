/** [providers] Presentation + click behavior of a provider row's key state (the merged 密钥 column). */

import type { ProviderRow } from "../../lib/contracts";
import { tNow } from "../../stores/language";
export type KeyTone = "success" | "warning" | "error" | "info" | "muted";

/** What clicking the key status does. `none` = plain, non-interactive text. */
export type KeyAction =
	| "decrypt"
	| "encrypt"
	| "setKey"
	| "oauth"
	| "explainLogin"
	| "none";

export interface KeyPresentation {
	label: string;
	tone: KeyTone;
	action: KeyAction;
	/** Tooltip: says what a click does (or why nothing happens). */
	title: string;
}

export const VAULT_PATH = "~/.omp-workspace/env/keys.env";
export const MODELS_YML_PATH = "~/.omp/agent/models.yml";
export const AGENT_DB_PATH = "~/.omp/agent/agent.db";

export function describeKey(row: Pick<ProviderRow, "key">): KeyPresentation {
	const { kind, envVar, envSet } = row.key;
	switch (kind) {
		case "encrypted":
			return {
				label: tNow("providers.labelEncrypted"),
				tone: "success",
				action: "decrypt",
				title: tNow("providers.titleEncrypted"),
			};
		case "plaintext":
			return {
				label: tNow("providers.labelPlaintext"),
				tone: "warning",
				action: "encrypt",
				title: tNow("providers.titlePlaintext", { path: MODELS_YML_PATH }),
			};
		case "vaultMissing":
			return {
				label: tNow("providers.labelVaultMissing"),
				tone: "error",
				action: "setKey",
				title: tNow("providers.titleVaultMissing"),
			};
		case "envVar": {
			const name = envVar ?? "";
			const set = envSet === true;
			return {
				label: set ? tNow("providers.labelEnvVarSet") : tNow("providers.labelEnvVarUnset"),
				tone: set ? "info" : "warning",
				action: "setKey",
				title: tNow("providers.titleEnvVar", {
					name,
					status: set ? tNow("providers.statusSet") : tNow("providers.statusUnset"),
				}),
			};
		}
		case "missing":
			return {
				label: tNow("providers.labelMissing"),
				tone: "warning",
				action: "setKey",
				title: tNow("providers.titleMissing"),
			};
		case "oauth":
			return {
				label: tNow("providers.labelOauth"),
				tone: "info",
				action: "oauth",
				title: tNow("providers.titleOauth"),
			};
		case "loginStored":
			return {
				label: tNow("providers.labelLoginStored"),
				tone: "info",
				action: "explainLogin",
				title: tNow("providers.titleLoginStored"),
			};
		case "none":
			return {
				label: tNow("providers.labelNone"),
				tone: "muted",
				action: "none",
				title: tNow("providers.titleNone"),
			};
		case "command":
			return {
				label: tNow("providers.labelCommand"),
				tone: "muted",
				action: "none",
				title: tNow("providers.titleCommand"),
			};
	}
}
export interface AuthBadge {
	label: string;
	tone: KeyTone;
}

export function authBadge(row: Pick<ProviderRow, "key"> & { authNone?: boolean }): AuthBadge {
	if (row.authNone) return { label: tNow("providers.badgeAuthNone"), tone: "muted" };
	switch (row.key.kind) {
		case "oauth":
			return { label: "OAuth", tone: "info" };
		case "none":
			return { label: tNow("providers.badgeAuthNone"), tone: "muted" };
		default:
			return { label: "API Key", tone: "success" };
	}
}

/** One-line "where does the key live" text for the expanded row. */
export function keyLocation(row: Pick<ProviderRow, "key">): string {
	switch (row.key.kind) {
		case "encrypted":
			return tNow("providers.locEncrypted", { path: VAULT_PATH });
		case "plaintext":
			return MODELS_YML_PATH;
		case "oauth":
		case "loginStored":
			return AGENT_DB_PATH;
		case "envVar":
			return tNow("providers.locEnvVar", {
				name: row.key.envVar ?? "",
				status: row.key.envSet ? tNow("providers.statusSet") : tNow("providers.statusUnset"),
			});
		case "command":
			return tNow("providers.locCommand", { path: MODELS_YML_PATH });
		case "vaultMissing":
			return tNow("providers.locVaultMissing", {
				modelsPath: MODELS_YML_PATH,
				vaultPath: VAULT_PATH,
			});
		case "none":
			return tNow("providers.locNone");
		case "missing":
			return tNow("providers.locMissing");
	}
}

export const keyToneClass: Record<KeyTone, string> = {
	success: "text-emerald-400",
	warning: "text-amber-400",
	error: "text-rose-400",
	info: "text-sky-300",
	muted: "text-neutral-500",
};

/** Host (with port) of a base URL, or the trimmed text when it does not parse. */
export function hostOf(rawUrl: string | null | undefined): string | null {
	const trimmed = rawUrl?.trim();
	if (!trimmed) return null;
	try {
		return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).host || trimmed;
	} catch {
		return trimmed;
	}
}
