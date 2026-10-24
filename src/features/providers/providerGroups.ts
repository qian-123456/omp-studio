/** [providers] Status buckets the settings list is folded into (sidebar-style collapsible groups). */

import type { ProviderRow } from "../../lib/contracts";

export type ProviderGroupId = "ready" | "needsKey" | "disabled";

/** Display order of the groups. */
export const PROVIDER_GROUP_ORDER: ProviderGroupId[] = ["ready", "needsKey", "disabled"];

/** Rows shown per group before the "展开更多" control; also the step of each expansion. */
export const GROUP_PAGE_SIZE = 8;

/** Groups open on first render (nothing to act on in the disabled one). */
export const GROUP_DEFAULT_OPEN: Record<ProviderGroupId, boolean> = { ready: true, needsKey: true, disabled: false };

/** A usable provider has a key (or needs none); an enabled one without a resolvable key needs setup. */
export function providerGroupOf(row: ProviderRow): ProviderGroupId {
	if (!row.enabled) return "disabled";
	if (row.authNone) return "ready";
	switch (row.key.kind) {
		case "vaultMissing":
		case "missing":
			return "needsKey";
		case "envVar":
			return row.key.envSet === true ? "ready" : "needsKey";
		default:
			return "ready";
	}
}

/** Splits rows into the three groups, preserving input order inside each. */
export function groupProviders(rows: ProviderRow[]): Record<ProviderGroupId, ProviderRow[]> {
	const out: Record<ProviderGroupId, ProviderRow[]> = { ready: [], needsKey: [], disabled: [] };
	for (const r of rows) out[providerGroupOf(r)].push(r);
	return out;
}
