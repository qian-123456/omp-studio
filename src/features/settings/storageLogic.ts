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

export interface StorageCategoryBreakdown {
	key: "sessions" | "images" | "webCache" | "db" | "status";
	bytes: number;
	percent: number;
	color: string;
}

export interface StorageTotalBreakdown {
	totalBytes: number;
	categories: StorageCategoryBreakdown[];
}

export function calculateStorageBreakdown(
	overview: { images?: { bytes: number }; webCacheBytes?: number; dbBytes?: number; status?: { bytes: number } } | null,
	sessions: { totalBytes: number } | null,
): StorageTotalBreakdown | null {
	if (!overview && !sessions) return null;
	const sBytes = sessions?.totalBytes ?? 0;
	const imgBytes = overview?.images?.bytes ?? 0;
	const webBytes = overview?.webCacheBytes ?? 0;
	const dbBytes = overview?.dbBytes ?? 0;
	const statusBytes = overview?.status?.bytes ?? 0;

	const totalBytes = sBytes + imgBytes + webBytes + dbBytes + statusBytes;
	const categories: StorageCategoryBreakdown[] = (
		[
			{ key: "sessions" as const, bytes: sBytes, percent: totalBytes > 0 ? (sBytes / totalBytes) * 100 : 0, color: "var(--accent, #6366f1)" },
			{ key: "images" as const, bytes: imgBytes, percent: totalBytes > 0 ? (imgBytes / totalBytes) * 100 : 0, color: "#38bdf8" },
			{ key: "webCache" as const, bytes: webBytes, percent: totalBytes > 0 ? (webBytes / totalBytes) * 100 : 0, color: "#fbbf24" },
			{ key: "db" as const, bytes: dbBytes, percent: totalBytes > 0 ? (dbBytes / totalBytes) * 100 : 0, color: "#34d399" },
			{ key: "status" as const, bytes: statusBytes, percent: totalBytes > 0 ? (statusBytes / totalBytes) * 100 : 0, color: "#a78bfa" },
		] as const
	).filter((c) => c.bytes > 0);

	return { totalBytes, categories };
}

export type ProjectSortOrder = "bytesDesc" | "updatedAtDesc" | "nameAsc";

export function sortProjects(
	projects: StorageProjectRow[],
	order: ProjectSortOrder,
): StorageProjectRow[] {
	const copy = [...projects];
	if (order === "bytesDesc") {
		return copy.sort((a, b) => b.bytes - a.bytes);
	}
	if (order === "updatedAtDesc") {
		return copy.sort((a, b) => {
			const aMax = a.sessions.reduce((max, s) => (s.updatedAt > max ? s.updatedAt : max), "");
			const bMax = b.sessions.reduce((max, s) => (s.updatedAt > max ? s.updatedAt : max), "");
			return bMax.localeCompare(aMax);
		});
	}
	if (order === "nameAsc") {
		return copy.sort((a, b) => (a.cwd ?? a.name).localeCompare(b.cwd ?? b.name));
	}
	return copy;
}
export interface StorageWorktreeGroup {
	key: string;
	isMain: boolean;
	worktreeName: string | null;
	path: string;
	bytes: number;
	project: StorageProjectRow;
}

export interface StorageWorkspaceGroup {
	rootPath: string;
	name: string;
	bytes: number;
	sessionCount: number;
	worktrees: StorageWorktreeGroup[];
}

export function groupProjectsByWorkspace(
	projects: StorageProjectRow[],
	knownWorkspaces: Array<{ path: string; name: string }> = [],
): StorageWorkspaceGroup[] {
	const groups = new Map<string, { rootPath: string; name: string; worktrees: StorageWorktreeGroup[] }>();

	const getRootAndName = (dir: string, cwd: string | null, name: string): { rootPath: string; name: string; worktreeName: string | null; isMain: boolean } => {
		const effectivePath = cwd || dir;
		// 1. Check if effectivePath matches or is inside a known workspace
		const matchedWs = knownWorkspaces
			.filter((w) => effectivePath === w.path || effectivePath.startsWith(`${w.path.replace(/\/+$/, "")}/`))
			.sort((a, b) => b.path.length - a.path.length)[0];

		// 2. Extract worktree name if path contains .worktrees or .cache/wt-
		const wtMatch =
			effectivePath.match(/[/\\]\.worktrees[/\\]([^/\\]+)/) ??
			effectivePath.match(/[/\\]\.cache[/\\](wt-[^/\\]+)/);

		if (matchedWs) {
			const isMain = effectivePath.replace(/\/+$/, "") === matchedWs.path.replace(/\/+$/, "");
			const worktreeName = wtMatch ? wtMatch[1] : isMain ? null : effectivePath.split("/").pop() || null;
			return { rootPath: matchedWs.path, name: matchedWs.name, worktreeName, isMain };
		}

		if (wtMatch) {
			const idx = effectivePath.indexOf("/.worktrees/");
			const winIdx = effectivePath.indexOf("\\.worktrees\\");
			const root = idx !== -1 ? effectivePath.slice(0, idx) : winIdx !== -1 ? effectivePath.slice(0, winIdx) : effectivePath;
			const rootName = root.split("/").filter(Boolean).pop() || name;
			return { rootPath: root, name: rootName, worktreeName: wtMatch[1], isMain: false };
		}

		const rootName = (cwd || dir).split("/").filter(Boolean).pop() || name;
		return { rootPath: effectivePath, name: rootName, worktreeName: null, isMain: true };
	};

	for (const p of projects) {
		const { rootPath, name, worktreeName, isMain } = getRootAndName(p.dir, p.cwd, p.name);
		let g = groups.get(rootPath);
		if (!g) {
			g = { rootPath, name, worktrees: [] };
			groups.set(rootPath, g);
		}
		g.worktrees.push({
			key: p.dir,
			isMain,
			worktreeName,
			path: p.cwd || p.dir,
			bytes: p.bytes,
			project: p,
		});
	}

	const result: StorageWorkspaceGroup[] = [];
	for (const g of groups.values()) {
		// Sort worktrees: main first, then by bytes desc
		g.worktrees.sort((a, b) => {
			if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
			return b.bytes - a.bytes;
		});
		const bytes = g.worktrees.reduce((sum, w) => sum + w.bytes, 0);
		const sessionCount = g.worktrees.reduce((sum, w) => sum + w.project.sessions.length, 0);
		result.push({
			rootPath: g.rootPath,
			name: g.name,
			bytes,
			sessionCount,
			worktrees: g.worktrees,
		});
	}

	return result;
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
