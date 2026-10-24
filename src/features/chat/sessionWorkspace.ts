/**
 * Where a session lives, resolved from stored catalog facts only — never from a
 * running RPC process. A selected session that is not started still knows its
 * cwd / repo root / workspace id, so the composer pill and the Git panel must
 * derive the same answer without waiting for omp.
 */
import type { SessionMeta, Workspace } from "../../lib/contracts";
import { basename, isInside } from "../../lib/paths";
import { tNow } from "../../stores/language";

export type SessionLocation =
	/** Registered project workspace (by stored id, or matched from repoRoot/cwd). */
	| { kind: "project"; workspace: Workspace; label: string }
	/** The project-less 🌐 workspace (only 通用对话 has one). */
	| { kind: "global"; workspace: Workspace | null; label: string }
	/** A directory outside every registered workspace: show it instead of guessing. */
	| { kind: "location"; path: string; label: string }
	/** No cwd recorded at all. */
	| { kind: "unknown"; label: string };

const UNKNOWN_LABEL = () => tNow("chatView.workspace.noDirectory");

/** Last path segment, or the whole path when it has none. */
export const baseName = basename;

/** `path` is `root` or inside it (no `..` resolution, matching the catalog). */
export const pathWithin = isInside;

/** Deepest project workspace containing `target` within `mode` (when given). */
function projectContaining(
	workspaces: readonly Workspace[],
	target: string | null,
	mode?: string,
): Workspace | null {
	if (!target) return null;
	let best: Workspace | null = null;
	for (const w of workspaces) {
		if (w.kind !== "project") continue;
		if (mode && w.mode !== mode) continue;
		if (!pathWithin(target, w.path)) continue;
		if (!best || w.path.length > best.path.length) best = w;
	}
	return best;
}

/**
 * Resolve a session's location. Stored `workspaceId` wins when it still exists,
 * but a global row is re-checked against the cwd: sessions recorded before their
 * project was registered would otherwise claim 全局 forever. Never reports
 * 全局 merely because the workspace list has not loaded — it reports the cwd.
 */
export function resolveSessionLocation(
	meta: Pick<SessionMeta, "cwd" | "repoRoot" | "workspaceId" | "mode"> | null | undefined,
	workspaces: readonly Workspace[],
): SessionLocation {
	if (!meta) return { kind: "unknown", label: UNKNOWN_LABEL() };
	const cwd = meta.cwd ?? "";
	const stored = meta.workspaceId
		? (workspaces.find((w) => w.id === meta.workspaceId) ?? null)
		: null;

	if (stored?.kind === "project") {
		return { kind: "project", workspace: stored, label: stored.name };
	}

	// repoRoot first (a worktree cwd resolves to its main checkout), then cwd.
	// Spaces never share projects, so the session's own mode is authoritative.
	const matched =
		projectContaining(workspaces, meta.repoRoot, meta.mode) ??
		projectContaining(workspaces, cwd, meta.mode);
	if (matched) return { kind: "project", workspace: matched, label: matched.name };

	// A cwd under the global dir IS 通用对话 (the catalog derives the space from
	// the path), so the row is matched by path, not by the stored mode.
	const global = workspaces.find((w) => w.kind === "global" && pathWithin(cwd, w.path));
	if (global) return { kind: "global", workspace: global, label: global.name };
	if (stored?.kind === "global" && !cwd) {
		return { kind: "global", workspace: stored, label: stored.name };
	}
	if (cwd) return { kind: "location", path: cwd, label: baseName(cwd) };
	return { kind: "unknown", label: UNKNOWN_LABEL() };
}

/** Directory the Git panel should inspect for `meta`: cwd, else its repo root. */
export function gitDirOf(
	meta: Pick<SessionMeta, "cwd" | "repoRoot"> | null | undefined,
): string | null {
	if (!meta) return null;
	return meta.cwd || meta.repoRoot || null;
}

/**
 * True only for a session that has never shown a message, i.e. the composer may
 * offer the new-session project / branch selector. An existing session must
 * never look blank: while its transcript is still loading (`live` undefined)
 * the stored meta decides, and a session with a title or a reply is not blank.
 */
export function isBlankComposerSession(
	meta: SessionMeta | null | undefined,
	live:
		| {
				items: readonly unknown[];
				pendingUserEchoes: readonly unknown[];
				streaming: boolean;
				streamingMessage: unknown;
		  }
		| null
		| undefined,
): boolean {
	if (!meta) return false;
	// Catalog activity is durable and wins over an empty/initial live snapshot,
	// which can briefly exist while a selected session's transcript is loading.
	if (meta.title?.trim() || meta.label?.trim() || meta.lastAssistant) return false;
	if (live) {
		return (
			live.items.length === 0 &&
			live.pendingUserEchoes.length === 0 &&
			!live.streaming &&
			live.streamingMessage == null
		);
	}
	return true;
}
