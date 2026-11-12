import type { ProviderRow } from "../../lib/contracts";
import type { ServiceCapability } from "./serviceCapabilities";
import { OAUTH_ONLY_SUPPLIERS } from "./presets";

export type SupplierAction = "account" | "key" | "settings" | "advanced" | null;
export interface SupplierStatus {
	label: string;
	warning?: boolean;
	action: SupplierAction;
	actionLabel?: string;
	reuse?: "account" | "key";
}
/** Stored evidence only: this deliberately does not assert credential validity or service availability. */
export function supplierStatus(capability: ServiceCapability, row: ProviderRow | undefined, loaded: boolean, error: string | null): SupplierStatus {
	if (error) return { label: "supplierUnknown", action: null };
	if (!loaded && !row) return { label: "supplierLoading", action: null };
	const settings = capability.method === "settings" || capability.method === "local";
	const keyless = capability.method === "keyless" || capability.method === "local" || capability.supplier === "local" || row?.authNone;
	const oauthRequired = Boolean(OAUTH_ONLY_SUPPLIERS[capability.supplier]) || (capability.supplier === "kimi" && capability.method === "advanced");
	let status: SupplierStatus;
	if (row?.key.kind === "oauth") status = { label: "supplierLoggedIn", action: "account", actionLabel: "supplierManageAccount", reuse: "account" };
	else if (oauthRequired) status = { label: "supplierNotLoggedIn", warning: true, action: "account", actionLabel: "supplierLogin" };
	else if (capability.method === "settings") status = { label: "supplierParameters", action: "settings", actionLabel: "supplierParameters" };
	else if (keyless) status = { label: "supplierKeyless", action: settings ? "settings" : capability.method === "advanced" ? "advanced" : null, actionLabel: settings ? "supplierParameters" : "supplierAdvancedAction" };
	else if (row && ["plaintext", "loginStored"].includes(row.key.kind)) status = { label: "supplierKeyAdded", action: "key", actionLabel: "supplierChangeKey", reuse: "key" };
	else if (row?.key.kind === "envVar" && row.key.envSet === true) status = { label: "supplierEnvSet", action: "key", actionLabel: "supplierChangeKey", reuse: "key" };
	else if (row?.key.kind === "envVar" && row.key.envSet === false) status = { label: "supplierEnvUnset", warning: true, action: "key", actionLabel: "supplierChangeKey" };
	else if (row?.key.kind === "command") status = { label: "supplierCommand", action: "key", actionLabel: "supplierChangeKey" };
	else if (capability.method === "optional-key") status = { label: "supplierOptionalKey", action: "key", actionLabel: "supplierAddKey" };
	else if (capability.method === "advanced") status = { label: "supplierAdvanced", action: "advanced", actionLabel: "supplierAdvancedAction" };
	else if (row?.key.kind === "envVar" && row.key.envSet === null) status = { label: "supplierUnknown", action: "key", actionLabel: "supplierChangeKey" };
	else status = { label: "supplierKeyMissing", warning: true, action: "key", actionLabel: "supplierAddKey" };
	return row?.enabled === false ? { ...status, label: "supplierDisabled", warning: false, reuse: undefined } : status;
}
