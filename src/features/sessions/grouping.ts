import type { SessionMeta, Workspace } from "../../lib/contracts";

export interface SessionTreeNode {
	session: SessionMeta;
	depth: number;
	children: SessionTreeNode[];
}

export interface BranchSubgroup {
	key: string;
	kind: "worktree" | "branch" | "default";
	label: string;
	/** True when the group was inferred from cwd because the worktree is gone. */
	deleted: boolean;
	/**
	 * Real directory sessions in this group run in — used for "new session in
	 * this worktree/branch checkout". Undefined when it cannot be determined.
	 */
	createCwd?: string;
	nodes: SessionTreeNode[];
	totalCount: number;
}

export interface WorkspaceGroup {
	workspace: Workspace;
	isGlobal: boolean;
	subgroups: BranchSubgroup[];
	hasMultipleSubgroups: boolean;
	totalCount: number;
}


export interface GroupedSessionsResult {
	/** Dedicated pinned sessions list displayed at the very top of the sidebar. */
	pinnedNodes: SessionTreeNode[];
	/** 🌐 Global workspace pinned on top; null when the DB has no global row. */
	globalGroup: WorkspaceGroup | null;
	/** Sessions belonging to no project workspace (newest first). */
	unassigned: SessionTreeNode[];
	/** Unassigned sessions whose worktree was deleted (dimmed bucket). */
	deletedNodes: SessionTreeNode[];
	workspaceGroups: WorkspaceGroup[];
	totalVisible: number;
}

export interface GroupingOptions {
	searchQuery?: string;
	showArchived?: boolean;
	/** Include sessions whose worktree was deleted (inferred from cwd). */
	showDeletedWorktrees?: boolean;
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
	const {
		searchQuery = "",
		showArchived = false,
		showDeletedWorktrees = false,
	} = options;

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
		if (
			!showDeletedWorktrees &&
			!session.git?.worktree &&
			!session.git?.branch &&
			inferWorktreeName(session.cwd) !== null
		) {
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
 * Builds a hierarchical tree from a flat list of sessions,
 * nesting side chats (parentId) up to max depth 3. Pinned first at each level.
 */
export function buildSessionTree(
	sessions: SessionMeta[],
	maxDepth = 3,
): SessionTreeNode[] {
	const sessionMap = new Map<string, SessionMeta>();
	const childrenMap = new Map<string, SessionMeta[]>();

	for (const s of sessions) {
		sessionMap.set(s.id, s);
	}

	const rootSessions: SessionMeta[] = [];

	for (const s of sessions) {
		if (s.parentId && sessionMap.has(s.parentId)) {
			const list = childrenMap.get(s.parentId) ?? [];
			list.push(s);
			childrenMap.set(s.parentId, list);
		} else {
			rootSessions.push(s);
		}
	}

	rootSessions.sort(compareSessions);

	function buildNode(session: SessionMeta, currentDepth: number): SessionTreeNode {
		const rawChildren = childrenMap.get(session.id) ?? [];
		rawChildren.sort(compareSessions);

		const clampedNextDepth = Math.min(currentDepth + 1, maxDepth);
		const children = rawChildren.map((child) =>
			buildNode(child, clampedNextDepth),
		);

		return {
			session,
			depth: currentDepth,
			children,
		};
	}

	return rootSessions.map((root) => buildNode(root, 0));
}

/** Flatten a tree of SessionTreeNodes into a sequential list preserving hierarchy. */
export function flattenSessionTree(nodes: SessionTreeNode[]): SessionTreeNode[] {
	const result: SessionTreeNode[] = [];
	function walk(list: SessionTreeNode[]) {
		for (const node of list) {
			result.push(node);
			if (node.children.length > 0) {
				walk(node.children);
			}
		}
	}
	walk(nodes);
	return result;
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
 */
export function createSubgroups(
	sessions: SessionMeta[],
	maxDepth = 3,
): { subgroups: BranchSubgroup[]; hasMultipleSubgroups: boolean } {
	if (sessions.length === 0) {
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

	for (const s of sessions) {
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

	const hasMultipleSubgroups = bucketMap.size > 1;

	const subgroups: BranchSubgroup[] = Array.from(bucketMap.entries()).map(
		([key, bucket]) => {
			const tree = buildSessionTree(bucket.items, maxDepth);
			const flattened = flattenSessionTree(tree);
			return {
				key,
				kind: bucket.kind,
				label: bucket.label,
				deleted: bucket.deleted,
				createCwd: bucket.items[0]?.cwd,
				nodes: flattened,
				totalCount: bucket.items.length,
			};
		},
	);

	// Sort: 主仓库 first, live worktrees/branches alphabetical, deleted last.
	subgroups.sort((a, b) => {
		if (a.deleted !== b.deleted) return a.deleted ? 1 : -1;
		if (a.kind === "default" && b.kind !== "default") return -1;
		if (b.kind === "default" && a.kind !== "default") return 1;
		return a.label.localeCompare(b.label);
	});

	return { subgroups, hasMultipleSubgroups };
}

/**
 * Collects all session IDs that belong to a subtree containing at least one pinned session.
 * Ensures the entire subtree moves together into pinnedNodes instead of breaking hierarchy.
 */
function getPinnedTreeSessionIds(sessions: SessionMeta[]): Set<string> {
	const parentMap = new Map<string, string>();
	const childrenMap = new Map<string, string[]>();
	const pinnedIds = new Set<string>();

	for (const s of sessions) {
		if (s.pinned) pinnedIds.add(s.id);
		if (s.parentId) {
			parentMap.set(s.id, s.parentId);
			const list = childrenMap.get(s.parentId) ?? [];
			list.push(s.id);
			childrenMap.set(s.parentId, list);
		}
	}

	if (pinnedIds.size === 0) return new Set();

	// Find all root IDs for every pinned session
	const pinnedRoots = new Set<string>();
	for (const id of pinnedIds) {
		let curr = id;
		const visited = new Set<string>([curr]);
		while (parentMap.has(curr)) {
			const p = parentMap.get(curr)!;
			if (visited.has(p)) break;
			visited.add(p);
			curr = p;
		}
		pinnedRoots.add(curr);
	}

	// Collect all descendants of every pinned root
	const allPinnedTreeIds = new Set<string>();
	function collectDescendants(id: string) {
		allPinnedTreeIds.add(id);
		for (const childId of childrenMap.get(id) ?? []) {
			collectDescendants(childId);
		}
	}

	for (const rootId of pinnedRoots) {
		collectDescendants(rootId);
	}

	return allPinnedTreeIds;
}

/**
 * Main grouping function (PLAN.md §66-67):
 * 1. Filters sessions by query, archive status, deleted-worktree visibility.
 * 2. 🌐 Global workspace pinned on top (sessions under globalDir, not the
 *    unassigned bucket).
 * 3. Project workspaces follow in sort order, subgroups by worktree/branch.
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

	const pinnedTreeIds = getPinnedTreeSessionIds(visibleSessions);
	const isPinned = (s: SessionMeta) => pinnedTreeIds.has(s.id);

	// Split unassigned: sessions on deleted worktrees go to a dedicated dimmed
	// bucket instead of vanishing (or polluting the live list).
	const isDeletedWt = (s: SessionMeta) =>
		!s.git?.worktree && !s.git?.branch && inferWorktreeName(s.cwd) !== null;
	const unassignedLive = unassignedSessions.filter((s) => !isPinned(s) && !isDeletedWt(s));
	const unassignedDeleted = unassignedSessions.filter((s) => !isPinned(s) && isDeletedWt(s));

	const pinnedSessions = visibleSessions.filter((s) => isPinned(s));
	const pinnedNodes = flattenSessionTree(
		buildSessionTree([...pinnedSessions].sort(compareSessions)),
	);

	const unassigned = flattenSessionTree(
		buildSessionTree([...unassignedLive].sort(compareSessions)),
	);
	const deletedNodes = flattenSessionTree(
		buildSessionTree([...unassignedDeleted].sort(compareSessions)),
	);
	const workspaceGroups: WorkspaceGroup[] = projectWorkspaces.map((ws) => {
		const items = (sessionMap.get(ws.id) ?? []).filter((s) => !isPinned(s));
		const { subgroups, hasMultipleSubgroups } = createSubgroups(items);
		return {
			workspace: ws,
			isGlobal: false,
			subgroups,
			hasMultipleSubgroups,
			totalCount: items.length,
		};
	});

	const globalGroup: WorkspaceGroup | null = globalWs
		? (() => {
				const items = globalSessions.filter((s) => !isPinned(s));
				const { subgroups, hasMultipleSubgroups } = createSubgroups(items);
				return {
					workspace: globalWs,
					isGlobal: true,
					subgroups,
					hasMultipleSubgroups,
					totalCount: items.length,
				};
			})()
		: null;
	let finalPinnedNodes = pinnedNodes;
	let finalGlobalGroup = globalGroup;
	let finalWorkspaceGroups = workspaceGroups;
	let finalUnassigned = unassigned;
	let finalDeletedNodes = deletedNodes;

	const { activeWorkspaceId } = options;
	if (activeWorkspaceId && activeWorkspaceId !== "all") {
		if (activeWorkspaceId === "__global") {
			finalPinnedNodes = pinnedNodes.filter((n) => n.session.workspaceId === globalWs?.id);
			finalWorkspaceGroups = [];
			finalUnassigned = [];
			finalDeletedNodes = [];
		} else if (activeWorkspaceId === "__unassigned") {
			finalPinnedNodes = pinnedNodes.filter((n) => !n.session.workspaceId);
			finalWorkspaceGroups = [];
			finalGlobalGroup = null;
			finalDeletedNodes = [];
		} else {
			const targetGroup = workspaceGroups.find((g) => g.workspace.id === activeWorkspaceId);
			finalWorkspaceGroups = targetGroup ? [targetGroup] : [];
			finalGlobalGroup = null;
			finalPinnedNodes = pinnedNodes.filter((n) => n.session.workspaceId === activeWorkspaceId);
			finalUnassigned = [];
			finalDeletedNodes = [];
		}
	}

	const totalVisible =
		finalPinnedNodes.length +
		(finalGlobalGroup?.totalCount ?? 0) +
		finalWorkspaceGroups.reduce((acc, g) => acc + g.totalCount, 0) +
		finalUnassigned.length +
		finalDeletedNodes.length;

	return {
		pinnedNodes: finalPinnedNodes,
		globalGroup: finalGlobalGroup,
		unassigned: finalUnassigned,
		deletedNodes: finalDeletedNodes,
		workspaceGroups: finalWorkspaceGroups,
		totalVisible,
	};
}
