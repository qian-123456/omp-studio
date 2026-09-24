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

export interface UnassignedCwdGroup {
	cwd: string;
	nodes: SessionTreeNode[];
	totalCount: number;
}

export interface UnassignedGroup {
	cwdGroups: UnassignedCwdGroup[];
	totalCount: number;
}

export interface GroupedSessionsResult {
	globalGroup: WorkspaceGroup | null;
	workspaceGroups: WorkspaceGroup[];
	unassignedGroup: UnassignedGroup;
	totalVisible: number;
}

export interface GroupingOptions {
	searchQuery?: string;
	showArchived?: boolean;
}

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

/** Filters a session list by search query and archive status. */
export function filterSessions(
	sessions: SessionMeta[],
	options: GroupingOptions = {},
): SessionMeta[] {
	const { searchQuery = "", showArchived = false } = options;

	return sessions.filter((session) => {
		if (!showArchived && session.archived) {
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

	const bucketMap = new Map<string, { kind: "worktree" | "branch" | "default"; label: string; items: SessionMeta[] }>();

	for (const s of sessions) {
		let key = "default";
		let kind: "worktree" | "branch" | "default" = "default";
		let label = "默认";

		if (s.git?.worktree) {
			key = `wt:${s.git.worktree}`;
			kind = "worktree";
			const parts = s.git.worktree.split(/[/\\]/);
			label = parts[parts.length - 1] || s.git.worktree;
		} else if (s.git?.branch) {
			key = `br:${s.git.branch}`;
			kind = "branch";
			label = s.git.branch;
		}

		let bucket = bucketMap.get(key);
		if (!bucket) {
			bucket = { kind, label, items: [] };
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
				nodes: flattened,
				totalCount: bucket.items.length,
			};
		},
	);

	// Sort subgroups: default/main branch first, then alphabetical
	subgroups.sort((a, b) => {
		if (a.kind === "default" && b.kind !== "default") return -1;
		if (b.kind === "default" && a.kind !== "default") return 1;
		return a.label.localeCompare(b.label);
	});

	return { subgroups, hasMultipleSubgroups };
}

/**
 * Main grouping function:
 * 1. Filters sessions by query and archive status.
 * 2. 🌐 Global workspace group is fixed on top.
 * 3. Registered project workspaces follow in sort order.
 * 4. Inside each workspace, subgroups by worktree/branch when > 1.
 * 5. Unassigned ("未归档") grouped by cwd.
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

	// Identify or synthesize global workspace
	let globalWs = workspaces.find((w) => w.kind === "global" || w.id === "global");
	if (!globalWs) {
		globalWs = {
			id: "global",
			name: "全局",
			path: "",
			kind: "global",
			sort: 0,
		};
	}

	const projectWorkspaces = workspaces
		.filter((w) => w.id !== globalWs?.id && w.kind !== "global")
		.sort((a, b) => (a.sort - b.sort) || a.name.localeCompare(b.name));

	const knownWsIds = new Set(workspaces.map((w) => w.id));
	if (globalWs) knownWsIds.add(globalWs.id);

	// Bucket sessions
	const globalSessions: SessionMeta[] = [];
	const projectSessionMap = new Map<string, SessionMeta[]>();
	for (const pw of projectWorkspaces) {
		projectSessionMap.set(pw.id, []);
	}
	const unassignedSessions: SessionMeta[] = [];

	for (const s of visibleSessions) {
		if (s.workspaceId === globalWs.id) {
			globalSessions.push(s);
		} else if (s.workspaceId && projectSessionMap.has(s.workspaceId)) {
			projectSessionMap.get(s.workspaceId)!.push(s);
		} else {
			unassignedSessions.push(s);
		}
	}

	// 1. Global group
	const { subgroups: globalSubgroups, hasMultipleSubgroups: globalHasMultiple } =
		createSubgroups(globalSessions);

	const globalGroup: WorkspaceGroup = {
		workspace: globalWs,
		isGlobal: true,
		subgroups: globalSubgroups,
		hasMultipleSubgroups: globalHasMultiple,
		totalCount: globalSessions.length,
	};

	// 2. Project workspace groups
	const workspaceGroups: WorkspaceGroup[] = projectWorkspaces.map((ws) => {
		const items = projectSessionMap.get(ws.id) ?? [];
		const { subgroups, hasMultipleSubgroups } = createSubgroups(items);
		return {
			workspace: ws,
			isGlobal: false,
			subgroups,
			hasMultipleSubgroups,
			totalCount: items.length,
		};
	});

	// 3. Unassigned bucket grouped by cwd
	const cwdMap = new Map<string, SessionMeta[]>();
	for (const s of unassignedSessions) {
		const cwdKey = s.cwd || "未指定目录";
		let list = cwdMap.get(cwdKey);
		if (!list) {
			list = [];
			cwdMap.set(cwdKey, list);
		}
		list.push(s);
	}

	const unassignedCwdGroups: UnassignedCwdGroup[] = Array.from(
		cwdMap.entries(),
	).map(([cwd, items]) => {
		const tree = buildSessionTree(items);
		const flattened = flattenSessionTree(tree);
		return {
			cwd,
			nodes: flattened,
			totalCount: items.length,
		};
	});

	unassignedCwdGroups.sort((a, b) => b.totalCount - a.totalCount || a.cwd.localeCompare(b.cwd));

	const unassignedGroup: UnassignedGroup = {
		cwdGroups: unassignedCwdGroups,
		totalCount: unassignedSessions.length,
	};

	return {
		globalGroup,
		workspaceGroups,
		unassignedGroup,
		totalVisible: visibleSessions.length,
	};
}
