import type { ModelEntry, ModelSpec } from "../../lib/contracts";

/** Extract the model id string from a ModelEntry (bare string or ModelSpec). */
export function modelEntryId(e: ModelEntry): string {
	return typeof e === "string" ? e : e.id;
}

/** Normalize ModelEntry into a ModelSpec object. */
export function modelEntrySpec(e: ModelEntry): ModelSpec {
	return typeof e === "string" ? { id: e } : e;
}

export interface ModelRow {
	id: string;
	name?: string | null;
	contextWindow: string;
	maxTokens: string;
}

/** Convert ModelEntry array to editable table rows for ProviderDialog. */
export function modelEntriesToRows(entries: ModelEntry[]): ModelRow[] {
	return entries.map((e) => {
		if (typeof e === "string") {
			return { id: e, name: null, contextWindow: "", maxTokens: "" };
		}
		return {
			id: e.id,
			name: e.name ?? null,
			contextWindow: e.contextWindow != null ? String(e.contextWindow) : "",
			maxTokens: e.maxTokens != null ? String(e.maxTokens) : "",
		};
	});
}

/** Convert editable table rows back into ModelEntry array.
 * Bare id when contextWindow and maxTokens are empty; ModelSpec when limits are set. */
export function rowsToModelEntries(rows: ModelRow[]): ModelEntry[] {
	const result: ModelEntry[] = [];
	for (const r of rows) {
		const id = r.id.trim();
		if (!id) continue;
		const ctxRaw = r.contextWindow.trim();
		const maxRaw = r.maxTokens.trim();
		const ctx = ctxRaw ? parseInt(ctxRaw, 10) : null;
		const max = maxRaw ? parseInt(maxRaw, 10) : null;
		const validCtx = ctx !== null && !Number.isNaN(ctx) && ctx > 0 ? ctx : null;
		const validMax = max !== null && !Number.isNaN(max) && max > 0 ? max : null;

		if (validCtx == null && validMax == null && !r.name) {
			result.push(id);
		} else {
			const spec: ModelSpec = { id };
			if (r.name) spec.name = r.name;
			if (validCtx != null) spec.contextWindow = validCtx;
			if (validMax != null) spec.maxTokens = validMax;
			result.push(spec);
		}
	}
	return result;
}

/** Parse a single line like "id" or "id|ctx|max" into a ModelEntry. */
export function parseModelEntryLine(line: string): ModelEntry | null {
	const trimmed = line.trim();
	if (!trimmed) return null;
	const parts = trimmed.split("|").map((p) => p.trim());
	const id = parts[0];
	if (!id) return null;
	if (parts.length === 1) return id;

	const ctxRaw = parts[1] ?? "";
	const maxRaw = parts[2] ?? "";
	const ctx = ctxRaw ? parseInt(ctxRaw, 10) : null;
	const max = maxRaw ? parseInt(maxRaw, 10) : null;
	const validCtx = ctx !== null && !Number.isNaN(ctx) && ctx > 0 ? ctx : null;
	const validMax = max !== null && !Number.isNaN(max) && max > 0 ? max : null;

	if (validCtx == null && validMax == null) {
		return id;
	}
	const spec: ModelSpec = { id };
	if (validCtx != null) spec.contextWindow = validCtx;
	if (validMax != null) spec.maxTokens = validMax;
	return spec;
}

/** Parse lines (string with newlines or string array) into ModelEntries. */
export function toModelEntries(input: string | string[]): ModelEntry[] {
	const lines = Array.isArray(input) ? input : input.split("\n");
	const result: ModelEntry[] = [];
	for (const line of lines) {
		const entry = parseModelEntryLine(line);
		if (entry) result.push(entry);
	}
	return result;
}

/** Format token counts compactly (e.g. 200000 -> 200k, 32768 -> 32k, 1000000 -> 1m). */
export function formatTokens(n: number): string {
	if (n <= 0) return "0";
	if (n % 1_000_000 === 0) return `${n / 1_000_000}m`;
	if (n % 1_048_576 === 0) return `${n / 1_048_576}m`;
	if (n >= 1_000_000) {
		const m = n / 1_000_000;
		return `${Number(m.toFixed(1))}m`;
	}
	if (n % 1000 === 0) return `${n / 1000}k`;
	if (n % 1024 === 0) return `${n / 1024}k`;
	if (n >= 1000) {
		const k = n / 1000;
		return `${Number(k.toFixed(1))}k`;
	}
	return String(n);
}
