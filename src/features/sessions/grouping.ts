import type { SessionMeta, WorktreeInfo, Workspace } from "../../lib/contracts";
import { basename, isInside } from "../../lib/paths";
export interface BranchSubgroup {
	key: string;
	kind: "worktree" | "branch" | "default";
	label: string;
	/** True when the group was inferred from cwd because the worktree is gone. */
	deleted: boolean;
	/** True for the repo's main checkout (first entry of git_list_worktrees). */
	isMain: boolean;
	/** Filesystem path of the worktree/checkout this subgroup represents. */
	path?: string;
	/**
	 * Real directory sessions in this group run in — used for "new session in
	 * this worktree/branch checkout". Undefined when it cannot be determined.
	 */
	createCwd?: string;
	sessions: SessionMeta[];
	totalCount: number;
}

export interface WorkspaceGroup {
	workspace: Workspace;
	isGlobal: boolean;
	subgroups: BranchSubgroup[];
	/** Subgroups whose worktree dir was deleted — rendered in a dimmed folder
	 *  at the bottom of the project group instead of inline. */
	deletedSubgroups: BranchSubgroup[];
	hasMultipleSubgroups: boolean;
	totalCount: number;
}


export interface GroupedSessionsResult {
	/** Dedicated pinned sessions list displayed at the very top of the sidebar. */
	pinnedSessions: SessionMeta[];
	/** 🌐 Global workspace pinned on top; null when the DB has no global row. */
	globalGroup: WorkspaceGroup | null;
	/** Sessions belonging to no project workspace (newest first). */
	unassigned: SessionMeta[];
	/** Unassigned sessions whose worktree was deleted (dimmed bucket). */
	deletedSessions: SessionMeta[];
	workspaceGroups: WorkspaceGroup[];
	totalVisible: number;
}

export interface GroupingOptions {
	searchQuery?: string;
	showArchived?: boolean;
	/**
	 * Live git worktrees per workspace id (`stores/worktrees.ts`). When a
	 * workspace has a list, every entry becomes a subgroup — including empty
	 * ones — and sessions attach by deepest cwd containment.
	 */
	worktrees?: Record<string, WorktreeInfo[]>;
	/**
	 * Filter sessions to a specific workspace ("all", "__global", "__unassigned", or a workspace.id).
	 * When set to a specific workspace, only that workspace's sessions and relevant pins are returned.
	 */
	activeWorkspaceId?: string;
}

/** Label for the collapsed unassigned bucket (PLAN.md §66 未归档桶). */
export const UNASSIGNED_LABEL = "未归档会话";

/** Label for the bucket holding sessions whose worktree dir was deleted. */
export const DELETED_LABEL = "已清理的 Worktree";

/** Matches session against a search query across title, label, branch, cwd, model, etc. */
export function matchesSearch(session: SessionMeta, query: string): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;

	if (session.title?.toLowerCase().includes(q)) return true;
	if (session.label?.toLowerCase().includes(q)) return true;
	if (session.git?.branch?.toLowerCase().includes(q)) return true;
	if (session.git?.worktree?.toLowerCase().includes(q)) return true;
	if (session.cwd?.toLowerCase().includes(q)) return true;
	if (session.model?.toLowerCase().includes(q)) return true;
	if (session.lastAssistant?.toLowerCase().includes(q)) return true;

	return false;
}

/** Filters a session list by search query, archive status, and deleted worktrees. */
export function filterSessions(
	sessions: SessionMeta[],
	options: GroupingOptions = {},
): SessionMeta[] {
	const { searchQuery = "", showArchived = false } = options;

	const sessionById = new Map<string, SessionMeta>();
	for (const s of sessions) {
		sessionById.set(s.id, s);
	}

	// Cascades archive state: if any ancestor is archived, children are also treated as archived
	const isArchivedCascaded = (s: SessionMeta): boolean => {
		if (s.archived) return true;
		let curr = s;
		const visited = new Set<string>([s.id]);
		while (curr.parentId) {
			if (visited.has(curr.parentId)) break;
			visited.add(curr.parentId);
			const parent = sessionById.get(curr.parentId);
			if (!parent) break;
			if (parent.archived) return true;
			curr = parent;
		}
		return false;
	};

	return sessions.filter((session) => {
		if (!showArchived && isArchivedCascaded(session)) {
			return false;
		}
		if (searchQuery && !matchesSearch(session, searchQuery)) {
			return false;
		}
		return true;
	});
}

/** Sort helper: pinned first, then by updatedAt descending. */
function compareSessions(a: SessionMeta, b: SessionMeta): number {
	if (a.pinned !== b.pinned) {
		return a.pinned ? -1 : 1;
	}
	const timeA = new Date(a.updatedAt || a.createdAt || 0).getTime();
	const timeB = new Date(b.updatedAt || b.createdAt || 0).getTime();
	return timeB - timeA;
}


/**
 * Recover a worktree name from a cwd path when live git metadata is gone
 * (worktree deleted after merge). Matches `<repo>/.worktrees/<name>` and
 * `<repo>/.cache/wt-<name>` layouts; returns null for anything else.
 */
export function inferWorktreeName(cwd: string): string | null {
	const m =
		cwd.match(/[/\\]\.worktrees[/\\]([^/\\]+)/) ??
		cwd.match(/[/\\]\.cache[/\\](wt-[^/\\]+)/);
	return m ? m[1] : null;
}

/**
 * Creates subgroups by worktree/branch.
 * If sessions belong to more than 1 worktree/branch, hasMultipleSubgroups = true.
 *
 * When `worktrees` (a live `git_list_worktrees` result; first entry = main
 * checkout) is given, every listed worktree yields a subgroup — including
 * ones with zero sessions — keyed `wtp:<path>`, labeled by branch name
 * (falling back to the dir basename). Sessions attach by deepest cwd
 * containment; sessions matching no listed worktree fall back to the
 * badge/inferred bucketing below.
 */
export function createSubgroups(
	sessions: SessionMeta[],
	worktrees?: WorktreeInfo[],
): { subgroups: BranchSubgroup[]; hasMultipleSubgroups: boolean } {
	if (sessions.length === 0 && (!worktrees || worktrees.length === 0)) {
		return { subgroups: [], hasMultipleSubgroups: false };
	}
	const bucketMap = new Map<
		string,
		{
			kind: "worktree" | "branch" | "default";
			label: string;
			deleted: boolean;
			items: SessionMeta[];
		}
	>();

	// Deepest-worktree-path-first so a nested checkout wins over its parents.
	const liveWorktrees = worktrees
		? [...worktrees].sort((a, b) => b.path.length - a.path.length)
		: null;
	const worktreeItems = new Map<string, SessionMeta[]>();
	for (const s of sessions) {
		if (liveWorktrees) {
			// A cwd inside a `.worktrees/<name>` / `.cache/wt-<name>` dir can only
			// belong to a live worktree that is itself inside such a dir — the
			// main checkout must not swallow sessions from deleted worktrees.
			const inWtDir = inferWorktreeName(s.cwd) !== null;
			const wt = liveWorktrees.find(
				(w) =>
					isInside(s.cwd, w.path) &&
					(!inWtDir || inferWorktreeName(w.path) !== null),
			);
			if (wt) {
				const items = worktreeItems.get(wt.path) ?? [];
				items.push(s);
				worktreeItems.set(wt.path, items);
				continue;
			}
		}

		let key = "default";
		let kind: "worktree" | "branch" | "default" = "default";
		let label = "其他";
		let deleted = false;

		if (s.git?.worktree) {
			key = `wt:${s.git.worktree}`;
			kind = "worktree";
			const parts = s.git.worktree.split(/[/\\]/);
			label = parts[parts.length - 1] || s.git.worktree;
		} else if (s.git?.branch) {
			key = `br:${s.git.branch}`;
			kind = "branch";
			label = s.git.branch;
		} else {
			// Git badge unavailable (e.g. worktree merged & deleted): recover the
			// group from the cwd path — `.worktrees/<name>` or `.cache/wt-<name>`.
			const inferred = inferWorktreeName(s.cwd);
			if (inferred) {
				key = `wt:${inferred}`;
				kind = "worktree";
				label = inferred;
				deleted = true;
			}
		}

		let bucket = bucketMap.get(key);
		if (!bucket) {
			bucket = { kind, label, deleted, items: [] };
			bucketMap.set(key, bucket);
		}
		bucket.items.push(s);
	}

	const subgroups: BranchSubgroup[] = [];

	// Live worktree subgroups first: main checkout, then the rest alphabetical
	// by label (the list order itself is path-length sorted, so reorder here).
	if (worktrees) {
		const wtSubs = worktrees.map((wt, index) => ({
			wt,
			sub: {
				key: `wtp:${wt.path}`,
				kind: "worktree" as const,
				label: wt.branch ?? basename(wt.path),
				deleted: false,
				isMain: index === 0,
				path: wt.path,
				createCwd: wt.path,
				sessions: [...(worktreeItems.get(wt.path) ?? [])].sort(compareSessions),
				totalCount: worktreeItems.get(wt.path)?.length ?? 0,
			},
		}));
		wtSubs.sort((a, b) => {
			if (a.sub.isMain !== b.sub.isMain) return a.sub.isMain ? -1 : 1;
			return a.sub.label.localeCompare(b.sub.label);
		});
		for (const { sub } of wtSubs) subgroups.push(sub);
	}

	subgroups.push(
		...Array.from(bucketMap.entries()).map(([key, bucket]) => ({
			key,
			kind: bucket.kind,
			label: bucket.label,
			deleted: bucket.deleted,
			isMain: false,
			createCwd: bucket.items[0]?.cwd,
			sessions: [...bucket.items].sort(compareSessions),
			totalCount: bucket.items.length,
		})),
	);

	// Live groups first (main/default before other worktrees/branches), deleted last.
	subgroups.sort((a, b) => {
		if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
		if (a.isMain !== b.isMain) return a.isMain ? -1 : 1;
		if (a.kind === "default" && b.kind !== "default") return -1;
		if (b.kind === "default" && a.kind !== "default") return 1;
		return a.label.localeCompare(b.label);
	});

	// Multiple live buckets means real worktree/branch spread; deleted groups
	// render in a separate folder and don't count.
	const hasMultipleSubgroups = subgroups.filter((s) => !s.deleted).length > 1;

	return { subgroups, hasMultipleSubgroups };
}

/**
 * Main grouping function (PLAN.md §66-67):
 * 1. Filters sessions by query and archive status.
 * 2. 🌐 Global workspace pinned on top (sessions under globalDir, not the
 *    unassigned bucket).
 * 3. Project workspaces follow in sort order, subgroups by live worktree
 *    (`GroupingOptions.worktrees`) or worktree/branch badge; sessions whose
 *    worktree dir is gone land in `deletedSubgroups` per workspace.
 * 4. Unassigned ("未归档") bucket + "已清理的 Worktree" bucket for unassigned
 *    sessions whose worktree directory is gone — kept visible (dimmed)
 *    instead of silently evaporating.
 */
export function groupSessions(
	allSessions: SessionMeta[] | Record<string, SessionMeta>,
	workspaces: Workspace[],
	options: GroupingOptions = {},
): GroupedSessionsResult {
	const sessionList = Array.isArray(allSessions)
		? allSessions
		: Object.values(allSessions);

	const visibleSessions = filterSessions(sessionList, options);

	const globalWs = workspaces.find((w) => w.kind === "global") ?? null;
	const projectWorkspaces = workspaces
		.filter((w) => w.kind !== "global")
		.sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));

	// Bucket sessions by resolved workspace membership.
	const sessionMap = new Map<string, SessionMeta[]>();
	for (const ws of projectWorkspaces) {
		sessionMap.set(ws.id, []);
	}
	const globalSessions: SessionMeta[] = [];
	const unassignedSessions: SessionMeta[] = [];

	for (const s of visibleSessions) {
		if (s.workspaceId && sessionMap.has(s.workspaceId)) {
			sessionMap.get(s.workspaceId)!.push(s);
		} else if (globalWs && s.workspaceId === globalWs.id) {
			globalSessions.push(s);
		} else {
			unassignedSessions.push(s);
		}
	}

	const isPinned = (s: SessionMeta) => s.pinned;

	// Split unassigned: sessions on deleted worktrees go to a dedicated dimmed
	// bucket instead of vanishing (or polluting the live list).
	const isDeletedWt = (s: SessionMeta) =>
		!s.git?.worktree && !s.git?.branch && inferWorktreeName(s.cwd) !== null;
	const unassignedLive = unassignedSessions.filter((s) => !isPinned(s) && !isDeletedWt(s));
	const unassignedDeleted = unassignedSessions.filter((s) => !isPinned(s) && isDeletedWt(s));

	const pinnedSessions = visibleSessions
		.filter((s) => isPinned(s))
		.sort(compareSessions);
	const unassigned = [...unassignedLive].sort(compareSessions);
	const deletedSessions = [...unassignedDeleted].sort(compareSessions);
	// While searching, drop empty subgroups so only real matches show.
	const searching = (options.searchQuery ?? "").trim().length > 0;
	const splitSubgroups = (
		all: BranchSubgroup[],
	): { live: BranchSubgroup[]; deleted: BranchSubgroup[] } => {
		const live: BranchSubgroup[] = [];
		const deleted: BranchSubgroup[] = [];
		for (const sg of all) {
			if (sg.deleted) {
				deleted.push(sg);
			} else if (!searching || sg.sessions.length > 0) {
				live.push(sg);
			}
		}
		return { live, deleted };
	};
	const workspaceGroups: WorkspaceGroup[] = projectWorkspaces.map((ws) => {
		const items = (sessionMap.get(ws.id) ?? []).filter((s) => !isPinned(s));
		const { subgroups } = createSubgroups(items, options.worktrees?.[ws.id]);
		const { live, deleted } = splitSubgroups(subgroups);
		return {
			workspace: ws,
			isGlobal: false,
			subgroups: live,
			deletedSubgroups: deleted,
			hasMultipleSubgroups: live.length > 1,
			totalCount: items.length,
		};
	});

	const globalGroup: WorkspaceGroup | null = globalWs
		? (() => {
				const items = globalSessions.filter((s) => !isPinned(s));
				const { subgroups } = createSubgroups(items);
				const { live, deleted } = splitSubgroups(subgroups);
				return {
					workspace: globalWs,
					isGlobal: true,
					subgroups: live,
					deletedSubgroups: deleted,
					hasMultipleSubgroups: live.length > 1,
					totalCount: items.length,
				};
			})()
		: null;
	let finalPinnedSessions = pinnedSessions;
	let finalGlobalGroup = globalGroup;
	let finalWorkspaceGroups = workspaceGroups;
	let finalUnassigned = unassigned;
	let finalDeletedSessions = deletedSessions;

	const { activeWorkspaceId } = options;
	if (activeWorkspaceId && activeWorkspaceId !== "all") {
		if (activeWorkspaceId === "__global") {
			finalPinnedSessions = pinnedSessions.filter((s) => s.workspaceId === globalWs?.id);
			finalWorkspaceGroups = [];
			finalUnassigned = [];
			finalDeletedSessions = [];
		} else if (activeWorkspaceId === "__unassigned") {
			finalPinnedSessions = pinnedSessions.filter((s) => !s.workspaceId);
			finalWorkspaceGroups = [];
			finalGlobalGroup = null;
			finalDeletedSessions = [];
		} else {
			const targetGroup = workspaceGroups.find((g) => g.workspace.id === activeWorkspaceId);
			finalWorkspaceGroups = targetGroup ? [targetGroup] : [];
			finalGlobalGroup = null;
			finalPinnedSessions = pinnedSessions.filter((s) => s.workspaceId === activeWorkspaceId);
			finalUnassigned = [];
			finalDeletedSessions = [];
		}
	}

	const totalVisible =
		finalPinnedSessions.length +
		(finalGlobalGroup?.totalCount ?? 0) +
		finalWorkspaceGroups.reduce((acc, g) => acc + g.totalCount, 0) +
		finalUnassigned.length +
		finalDeletedSessions.length;

	return {
		pinnedSessions: finalPinnedSessions,
		globalGroup: finalGlobalGroup,
		unassigned: finalUnassigned,
		deletedSessions: finalDeletedSessions,
		workspaceGroups: finalWorkspaceGroups,
		totalVisible,
	};
}
