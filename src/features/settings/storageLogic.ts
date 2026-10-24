/** Pure helpers for the 存储空间 page and the startup image GC. */
import { tNow } from "../../stores/language";
import type { StorageProjectRow, StorageSessionRow } from "../../lib/contracts";

export const DEFAULT_STALE_DAYS = 90;
export const MAX_STALE_DAYS = 3650;

/** Clamp the 「N 天」 input; falls back to the default for empty/invalid text. */
export function parseStaleDays(raw: string): number {
	const n = Number.parseInt(raw, 10);
	if (!Number.isFinite(n) || n < 1) return DEFAULT_STALE_DAYS;
	return Math.min(MAX_STALE_DAYS, n);
}

/** Sessions of a project the user may tick (not running / pinned / held by a terminal). */
export function selectableSessions(project: StorageProjectRow): StorageSessionRow[] {
	return project.sessions.filter((s) => s.skipReason === null);
}

export function selectedBytes(project: StorageProjectRow, selected: ReadonlySet<string>): number {
	return project.sessions.reduce((sum, s) => (selected.has(s.id) ? sum + s.bytes : sum), 0);
}

/**
 * Backend commands added after the user launched the app do not exist until a
 * restart; turn Tauri's raw "not found" error into an actionable message.
 */
export function describeStorageError(err: unknown): string {
	const msg = err instanceof Error ? err.message : String(err);
	if (/not found|unknown command|did not match/i.test(msg) && /storage_/i.test(msg)) {
		return tNow("settingsCore.storageLogic.restartRequired");
	}
	return msg;
}

/** Every string that could mention an image file and is not in the DB: localStorage + live composer state. */
export function collectDraftTexts(
	composer: {
		drafts?: Record<string, string>;
		sideChatDrafts?: Record<string, string>;
		images?: unknown;
		files?: unknown;
		history?: string[];
	},
	storage: Pick<Storage, "length" | "key" | "getItem"> | null,
): string[] {
	const out: string[] = [];
	const push = (v: unknown) => {
		if (v === undefined || v === null) return;
		out.push(typeof v === "string" ? v : JSON.stringify(v));
	};
	push(composer.drafts);
	push(composer.sideChatDrafts);
	push(composer.images);
	push(composer.files);
	push(composer.history);
	if (storage) {
		for (let i = 0; i < storage.length; i++) {
			const key = storage.key(i);
			if (key === null) continue;
			const v = storage.getItem(key);
			if (v) out.push(v);
		}
	}
	return out;
}
