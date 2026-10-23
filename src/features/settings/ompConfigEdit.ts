/** [D] Pure helpers behind the OMP config editors (default detection, list/record
 * transforms, project-override lookup). Kept React-free so they are unit tested. */

import { parse as parseYaml } from "yaml";
import { OMP_CONFIG_DEFAULTS } from "./ompConfigDefaults";

// ── Default detection ────────────────────────────────────────────────

/** `Object.hasOwn` for the ES2021 lib target. */
function hasOwn(obj: object, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

/** Structural equality for JSON-ish values; `null` and `undefined` are equal (both "unset"). */
export function jsonEqual(a: unknown, b: unknown): boolean {
	if (a === undefined) a = null;
	if (b === undefined) b = null;
	if (a === b) return true;
	if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((v, i) => jsonEqual(v, b[i]));
	}
	const ao = a as Record<string, unknown>;
	const bo = b as Record<string, unknown>;
	const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
	const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
	return ak.length === bk.length && ak.every((k) => hasOwn(bo, k) && jsonEqual(ao[k], bo[k]));
}

export type DefaultState = "default" | "modified" | "unknown";

/**
 * Compare a current value with the schema default. `unknown` when the default
 * is computed at runtime (not extractable) or the value is redacted.
 */
export function defaultState(
	key: string,
	value: unknown,
	redacted = false,
	defaults: Record<string, unknown> = OMP_CONFIG_DEFAULTS,
): DefaultState {
	if (redacted || !hasOwn(defaults, key)) return "unknown";
	return jsonEqual(value, defaults[key]) ? "default" : "modified";
}

/** Schema default (if known) as display text. */
export function defaultText(key: string, defaults: Record<string, unknown> = OMP_CONFIG_DEFAULTS): string | null {
	if (!hasOwn(defaults, key)) return null;
	const v = defaults[key];
	if (v === null || v === undefined) return "未设置";
	if (typeof v === "string") return v === "" ? "（空）" : v;
	return JSON.stringify(v);
}

// ── String lists ─────────────────────────────────────────────────────

/** Coerce a config value into a list of strings (non-strings are JSON-encoded). */
export function toStringList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v)));
}

/** True when every element is a string (the chip editor can round-trip it). */
export function isStringList(value: unknown): boolean {
	return value === null || value === undefined || (Array.isArray(value) && value.every((v) => typeof v === "string"));
}

/** Append trimmed items, skipping blanks and duplicates. Accepts comma/newline separated input. */
export function listAdd(list: readonly string[], raw: string): string[] {
	const next = [...list];
	for (const part of raw.split(/[\n,]/)) {
		const item = part.trim();
		if (item && !next.includes(item)) next.push(item);
	}
	return next;
}

export function listRemove(list: readonly string[], index: number): string[] {
	return list.filter((_, i) => i !== index);
}

/** Move item at `index` by `delta` (clamped); returns the same order when out of range. */
export function listMove(list: readonly string[], index: number, delta: number): string[] {
	const target = index + delta;
	if (index < 0 || index >= list.length || target < 0 || target >= list.length) return [...list];
	const next = [...list];
	const [item] = next.splice(index, 1);
	next.splice(target, 0, item);
	return next;
}

export function listDedupe(list: readonly string[]): string[] {
	return [...new Set(list)];
}

// ── Records ──────────────────────────────────────────────────────────

export interface RecordRow {
	key: string;
	/** Raw text: plain string for `kind: "string"`, JSON for `kind: "json"`. */
	text: string;
	kind: "string" | "json";
}

/** Split a record into editable rows; non-string values become JSON rows. */
export function recordToRows(value: unknown): RecordRow[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	return Object.entries(value as Record<string, unknown>).map(([key, v]) =>
		typeof v === "string" ? { key, text: v, kind: "string" } : { key, text: JSON.stringify(v), kind: "json" },
	);
}

export type RowsResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string; index: number };

/** Rebuild a record from rows, validating keys and JSON values; fully blank rows are skipped. */
export function rowsToRecord(rows: readonly RecordRow[]): RowsResult {
	const out: Record<string, unknown> = {};
	for (let i = 0; i < rows.length; i++) {
		const { key, text, kind } = rows[i];
		const k = key.trim();
		if (!k && text.trim() === "") continue;
		if (!k) return { ok: false, error: `第 ${i + 1} 行的名称不能为空`, index: i };
		if (hasOwn(out, k)) return { ok: false, error: `名称「${k}」重复`, index: i };
		if (kind === "json") {
			try {
				out[k] = JSON.parse(text);
			} catch {
				return { ok: false, error: `「${k}」的值不是有效的 JSON`, index: i };
			}
		} else {
			out[k] = text;
		}
	}
	return { ok: true, value: out };
}

// ── JSON escape hatch ────────────────────────────────────────────────

export type JsonResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Parse JSON typed for an array/record setting, with a readable error. */
export function parseJsonFor(valueType: string, text: string): JsonResult {
	let value: unknown;
	try {
		value = JSON.parse(text.trim() === "" ? (valueType === "array" ? "[]" : "{}") : text);
	} catch (e) {
		return { ok: false, error: `JSON 格式不正确：${e instanceof Error ? e.message : String(e)}` };
	}
	if (valueType === "array" && !Array.isArray(value)) {
		return { ok: false, error: "这里需要一个列表（以 [ 开头）" };
	}
	if (valueType === "record" && (value === null || typeof value !== "object" || Array.isArray(value))) {
		return { ok: false, error: "这里需要一个对象（以 { 开头）" };
	}
	return { ok: true, value };
}

// ── Project overrides (<cwd>/.omp/config.yml) ─────────────────────────

/** Parse project YAML into a mapping; `{}` on empty/invalid/non-mapping documents. */
export function parseProjectConfig(content: string): Record<string, unknown> {
	try {
		const doc = parseYaml(content) as unknown;
		return doc && typeof doc === "object" && !Array.isArray(doc) ? (doc as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/**
 * Look up a dotted config key in a (possibly nested) mapping. Tries nested
 * segments as well as literal dotted keys at any level (`a: { "b.c": 1 }`).
 */
export function lookupDotPath(root: unknown, key: string): { found: boolean; value?: unknown } {
	if (!root || typeof root !== "object" || Array.isArray(root)) return { found: false };
	const obj = root as Record<string, unknown>;
	if (hasOwn(obj, key)) return { found: true, value: obj[key] };
	const parts = key.split(".");
	for (let i = parts.length - 1; i >= 1; i--) {
		const head = parts.slice(0, i).join(".");
		if (!hasOwn(obj, head)) continue;
		const hit = lookupDotPath(obj[head], parts.slice(i).join("."));
		if (hit.found) return hit;
	}
	return { found: false };
}
