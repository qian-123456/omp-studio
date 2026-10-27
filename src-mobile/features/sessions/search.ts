import type { SpaceMode } from "../../core/types";
import type { TreeSession } from "./tree";

export interface BranchHit {
	branch: string;
	workspaceId?: string;
	count: number;
	sessionIds: string[];
}

export interface SearchResult {
	sessions: TreeSession[];
	branches: BranchHit[];
}

/** `GET /left/search` path for a (trimmed, non-empty) query. */
export const searchPath = (q: string, mode: SpaceMode, includeArchived: boolean): string =>
	`/left/search?q=${encodeURIComponent(q)}&mode=${mode}&archived=${includeArchived ? 1 : 0}`;

/**
 * Branch disambiguation: one hit opens directly; several hits need a chooser. The server lists at most 5 ids
 * per branch, so the title says how many exist in total.
 */
export function branchChoice(b: BranchHit): { kind: "open"; id: string } | { kind: "choose"; title: string; ids: string[] } {
	if (b.sessionIds.length === 1) return { kind: "open", id: b.sessionIds[0] };
	const more = b.count > b.sessionIds.length ? `（共 ${b.count} 个，列出 ${b.sessionIds.length} 个）` : "";
	return { kind: "choose", title: `${b.branch}${more}`, ids: b.sessionIds };
}
