/** [providers] Plan for applying `.env` entries (`NAME=key`) to OMP provider rows. */

import type { ProviderRow } from "../../lib/contracts";
import { type ParsedEnvEntry, parseEnvText } from "./envparse";
import { matchPresetByEnvVar, type ProviderPreset } from "./presets";

export type EnvImportItem =
	| { entry: ParsedEnvEntry; kind: "setKey"; row: ProviderRow }
	| { entry: ParsedEnvEntry; kind: "create"; preset: ProviderPreset }
	| { entry: ParsedEnvEntry; kind: "unknown" };

/** `<SLUG_UPPER>_API_KEY`: the variable name `provider_export_env_text` writes for a row. */
export function exportVarName(row: Pick<ProviderRow, "slug">): string {
	return `${row.slug.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}_API_KEY`;
}

/**
 * Match each distinct variable to (1) a row whose key is read from that env var,
 * (2) a row named by the export convention, (3) a preset — updating the row with the
 * preset's id if it exists, else creating a new custom provider.
 */
export function planEnvImport(text: string, rows: ProviderRow[]): EnvImportItem[] {
	const seen = new Set<string>();
	const items: EnvImportItem[] = [];
	for (const entry of parseEnvText(text)) {
		if (seen.has(entry.key)) continue;
		seen.add(entry.key);
		const byEnv = rows.find((r) => r.key.kind === "envVar" && r.key.envVar === entry.key);
		const byExport = rows.find((r) => exportVarName(r) === entry.key);
		const existing = byEnv ?? byExport;
		if (existing) {
			items.push({ entry, kind: "setKey", row: existing });
			continue;
		}
		const preset = matchPresetByEnvVar(entry.key);
		if (!preset) {
			items.push({ entry, kind: "unknown" });
			continue;
		}
		const presetRow = rows.find((r) => r.id === preset.id);
		items.push(
			presetRow
				? { entry, kind: "setKey", row: presetRow }
				: { entry, kind: "create", preset },
		);
	}
	return items;
}
