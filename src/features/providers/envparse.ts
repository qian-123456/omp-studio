/** `.env` paste parsing + masking helpers for the import flow
 * (mirrors the backend parser in `src-tauri/src/providers/vault.rs`). */

export interface ParsedEnvEntry {
	key: string;
	value: string;
}

/** Parse `.env` text: skip comments/blanks, split at the first `=`,
 * trim, strip surrounding quotes. Invalid lines are ignored. */
export function parseEnvText(text: string): ParsedEnvEntry[] {
	const out: ParsedEnvEntry[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		if (!/^[A-Za-z0-9_]+$/.test(key)) continue;
		let value = line.slice(eq + 1).trim();
		if (
			value.length >= 2 &&
			((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'")))
		) {
			value = value.slice(1, -1);
		}
		if (!value) continue;
		out.push({ key, value });
	}
	return out;
}

/** Mask a secret for live previews: keeps the first 3 and last 4 chars. */
export function maskKey(value: string): string {
	const v = value.trim();
	if (v.length <= 8) return "•".repeat(v.length) || "•";
	return `${v.slice(0, 3)}…${v.slice(-4)}`;
}

/** Slug from a display name: lowercase, `[a-z0-9_-]`, `-` collapsed. */
export function slugify(name: string): string {
	const slug = name
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug || "custom";
}
