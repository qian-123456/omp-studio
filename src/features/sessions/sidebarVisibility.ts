/**
 * Visibility helpers for workspace groups in all-workspaces mode.
 * Single source of truth shared between SessionSidebar and sidebarNav.test.ts.
 */

import type { WorkspaceGroup } from "./grouping";

/**
 * Determines whether a project workspace group should be rendered in "all" mode.
 * Visible if it has active sessions, pinned sessions pulled to top, live worktree subgroups,
 * or deleted worktree subgroups.
 */
export function isWorkspaceGroupVisibleInAll(wg: WorkspaceGroup): boolean {
	const hasPinned = (wg.pinnedCount ?? 0) > 0;
	const hasActive = wg.totalCount > 0;
	const hasSubgroupSessions = wg.subgroups.some((s) => s.sessions.length > 0);
	const hasDeleted = wg.deletedSubgroups.length > 0;
	return hasPinned || hasActive || hasSubgroupSessions || hasDeleted;
}

/**
 * Determines whether the global workspace group should be rendered in "all" mode.
 * Visible only when it contains sessions or pinned sessions.
 */
export function isGlobalGroupVisibleInAll(
	globalGroup: WorkspaceGroup | null,
): boolean {
	if (!globalGroup) return false;
	const hasPinned = (globalGroup.pinnedCount ?? 0) > 0;
	const hasActive = globalGroup.totalCount > 0;
	const hasSubgroupSessions = globalGroup.subgroups.some((s) => s.sessions.length > 0);
	return hasPinned || hasActive || hasSubgroupSessions;
}
