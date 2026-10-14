import type { SessionMeta, SpaceMode, WorktreeInfo, Workspace } from "../../lib/contracts";
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
	pinnedCount: number;
}

export interface GroupedSessionsResult {
	/** Dedicated pinned sessions list displayed at the very top of the sidebar. */
	pinnedSessions: SessionMeta[];
	/** 🌐 Global workspace pinned on top; null when the DB has no global row. */
	globalGroup: WorkspaceGroup | null;
	/** Sessions belonging to no project workspace (newest first). */
	unassigned: SessionMeta[];
	/** Unassigned sessions grouped by repoRoot ?? cwd, newest group first. */
	unassignedGroups: {
		key: string;
		cwd: string;
		label: string;
		sessions: SessionMeta[];
	}[];
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
	 * Space mode filter: only sessions recorded in this space are grouped;
	 * other modes' sessions are invisible to every bucket.
	 */
	mode?: SpaceMode;
	/**
	 * When set, inside every list keep pinned-first, then ids present in the map
	 * by rank asc, ids absent (new) first by updatedAt desc.
	 */
	frozenOrder?: ReadonlyMap<string, number>;
	workspaces?: Workspace[];
	/**
	 * Default true. When false, every workspace collapses to ONE flat
	 * `default`/`isMain` subgroup (no worktree/branch split, no deleted-worktree
	 * folder) and deleted-worktree unassigned sessions join the normal list.
	 */
	groupByWorktree?: boolean;
}

/** Label for the collapsed unassigned bucket (PLAN.md §66 未归档桶). */
export const UNASSIGNED_LABEL = "未归入工作区";

/** Label for the bucket holding sessions whose worktree dir was deleted. */
export const DELETED_LABEL = "已清理的工作树";

/** True when the session needs the user *now*: a turn in flight or a pending
 * question. Terminal marks (review/error/interrupted/unread) stay folded by
 * paging — unread is signalled by the blue dot + collapsed-group unread
 * bubble, and making it sticky flooded real libraries where nearly every
 * past session is interrupted-with-unread. */
export function needsAttention(s: SessionMeta): boolean {
	return (
		s.status === "working" ||
		s.status === "awaiting_approval" ||
		s.status === "awaiting_answer"
	);
}

/** Rank of every session id in the current grouped output, all lists, in render order. */
export function snapshotOrder(g: GroupedSessionsResult): Map<string, number> {
	const order = new Map<string, number>();
	let rank = 0;

	const add = (id: string) => {
		if (!order.has(id)) {
			order.set(id, rank++);
		}
	};

	for (const s of g.pinnedSessions) {
		add(s.id);
	}

	if (g.globalGroup) {
		for (const sub of g.globalGroup.subgroups) {
			for (const s of sub.sessions) add(s.id);
		}
		for (const sub of g.globalGroup.deletedSubgroups) {
			for (const s of sub.sessions) add(s.id);
		}
	}

	for (const wg of g.workspaceGroups) {
		for (const sub of wg.subgroups) {
			for (const s of sub.sessions) add(s.id);
		}
		for (const sub of wg.deletedSubgroups) {
			for (const s of sub.sessions) add(s.id);
		}
	}

	for (const s of g.unassigned) {
		add(s.id);
	}

	for (const s of g.deletedSessions) {
		add(s.id);
	}

	return order;
}

function normalizePath(p: string): string {
	const clean = p.replace(/\/+$/, "");
	if (clean.startsWith("/private/")) {
		return clean.slice("/private".length);
	}
	return clean;
}

function isInsideCanon(child: string, parent: string): boolean {
	if (isInside(child, parent)) return true;
	return isInside(normalizePath(child), normalizePath(parent));
}

/** Matches session against a search query across title, label, branch, worktree, model, lastAssistant, and cwd relative to workspace/basename. */
export function matchesSearch(
	session: SessionMeta,
	query: string,
	workspacePath?: string,
): boolean {
	const q = query.trim().toLowerCase();
	if (!q) return true;

	const tokens = q.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return true;

	// CWD: match relative to workspace path or basename — never the shared absolute prefix (G10).
	let cwdTerm = "";
	if (session.cwd) {
		if (workspacePath && isInsideCanon(session.cwd, workspacePath)) {
			const normCwd = normalizePath(session.cwd);
			const normWs = normalizePath(workspacePath);
			const rel = normCwd.startsWith(normWs)
				? normCwd.slice(normWs.length).replace(/^\/+/, "")
				: "";
			cwdTerm = rel ? `${rel} ${basename(session.cwd)}` : basename(session.cwd);
		} else {
			cwdTerm = basename(session.cwd);
		}
	}

	const title = session.title?.toLowerCase() ?? "";
	const label = session.label?.toLowerCase() ?? "";
	const branch = session.git?.branch?.toLowerCase() ?? "";
	const worktree = session.git?.worktree?.toLowerCase() ?? "";
	const model = session.model?.toLowerCase() ?? "";
	const lastAssistant = session.lastAssistant?.toLowerCase() ?? "";
	const searchableCwd = cwdTerm.toLowerCase();

	// AND matching for whitespace-separated tokens
	for (const token of tokens) {
		const matchesToken =
			title.includes(token) ||
			label.includes(token) ||
			branch.includes(token) ||
			worktree.includes(token) ||
			model.includes(token) ||
			lastAssistant.includes(token) ||
			searchableCwd.includes(token);
		if (!matchesToken) {
			return false;
		}
	}

	return true;
}

/**
 * Side chats (forks with `parentId`) are real sessions only once their first
 * user message lands: `createSideChat` spawns + prompts atomically, so a fork
 * row that is still blank in every content signal (untitled, unlabeled,
 * nothing replied, no turn in flight, no pending mark, nothing unread) is an
 * unsent stub / a fork file that never received a prompt — it must not
 * surface in the sidebar. Non-fork sessions are exempt: blank main drafts are
 * governed by the caller's `isBlankDraft` + composer-activity check, which
 * keeps a draft row while the user is typing into it (forks have no such
 * main-composer draft, so no override is needed here).
 */
export function isEmptySideChat(s: SessionMeta): boolean {
	return (
		s.parentId !== null &&
		s.status === "idle" &&
		!s.pending &&
		!s.unread &&
		!s.title.trim() &&
		!s.label.trim() &&
		!s.lastAssistant
	);
}

/** Filters a session list by search query, archive status, and deleted worktrees. */
export function filterSessions(
	sessions: SessionMeta[],
	options: GroupingOptions = {},
): SessionMeta[] {
	const { searchQuery = "", showArchived = false, workspaces = [] } = options;

	const sessionById = new Map<string, SessionMeta>();
	for (const s of sessions) {
		sessionById.set(s.id, s);
	}

	const wsPathMap = new Map<string, string>();
	for (const ws of workspaces) {
		wsPathMap.set(ws.id, ws.path);
	}

	// Cascades archive state: if any ancestor is archived, children are also treated as archived.
	// Archive cascade never hides a child that is live, pinned, pending, working or awaiting (G13).
	const isArchivedCascaded = (s: SessionMeta): boolean => {
		if (s.archived) return true;
		if (
			s.live ||
			s.pinned ||
			Boolean(s.pending) ||
			s.status === "working" ||
			s.status === "awaiting_approval" ||
			s.status === "awaiting_answer"
		) {
			return false;
		}
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
		// Zero-message side chats are never listed (see isEmptySideChat).
		if (isEmptySideChat(session)) {
			return false;
		}
		if (!showArchived && isArchivedCascaded(session)) {
			return false;
		}
		if (searchQuery) {
			const wsPath = session.workspaceId ? wsPathMap.get(session.workspaceId) : undefined;
			if (!matchesSearch(session, searchQuery, wsPath)) {
				return false;
			}
		}
		return true;
	});
}

function parseTimestamp(ts: string | null | undefined): number {
	if (!ts) return 0;
	const n = Date.parse(ts);
	return Number.isNaN(n) ? 0 : n;
}

function buildSessionTimeMap(sessions: readonly SessionMeta[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const s of sessions) {
		map.set(s.id, parseTimestamp(s.updatedAt || s.createdAt));
	}
	return map;
}

function createSessionComparator(
	timeMap: ReadonlyMap<string, number>,
	frozenOrder?: ReadonlyMap<string, number>,
): (a: SessionMeta, b: SessionMeta) => number {
	return (a: SessionMeta, b: SessionMeta): number => {
		if (a.pinned !== b.pinned) {
			return a.pinned ? -1 : 1;
		}

		if (frozenOrder) {
			const rankA = frozenOrder.get(a.id);
			const rankB = frozenOrder.get(b.id);

			if (rankA !== undefined && rankB !== undefined) {
				if (rankA !== rankB) return rankA - rankB;
				return a.id.localeCompare(b.id);
			}

			if (rankA === undefined && rankB !== undefined) {
				return -1; // absent (new) first
			}
			if (rankA !== undefined && rankB === undefined) {
				return 1;
			}
		}

		const timeA = timeMap.get(a.id) ?? 0;
		const timeB = timeMap.get(b.id) ?? 0;
		return timeB - timeA;
	};
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
 * (falling back to the dir basename). Sessions attach by sessionIds first,
 * then deepest cwd containment; sessions matching no listed worktree fall back to the
 * badge/inferred bucketing below.
 */
export function createSubgroups(
	sessions: SessionMeta[],
	worktrees?: WorktreeInfo[],
	customCompare?: (a: SessionMeta, b: SessionMeta) => number,
): { subgroups: BranchSubgroup[]; hasMultipleSubgroups: boolean } {
	if (sessions.length === 0 && (!worktrees || worktrees.length === 0)) {
		return { subgroups: [], hasMultipleSubgroups: false };
	}

	const timeMap = customCompare ? null : buildSessionTimeMap(sessions);
	const compare = customCompare ?? createSessionComparator(timeMap!);

	const bucketMap = new Map<
		string,
		{
			kind: "worktree" | "branch" | "default";
			label: string;
			deleted: boolean;
			isMain: boolean;
			items: SessionMeta[];
		}
	>();

	// G8: Precompute WorktreeInfo.sessionIds lookup
	const wtBySessionId = new Map<string, WorktreeInfo>();
	if (worktrees) {
		for (const w of worktrees) {
			if (w.sessionIds) {
				for (const sid of w.sessionIds) {
					wtBySessionId.set(sid, w);
				}
			}
		}
	}

	// G20: Precompute path length sort, normalized path, and isWtDir once
	const liveWorktrees = worktrees
		? worktrees
				.map((w) => ({
					wt: w,
					normPath: normalizePath(w.path),
					isWtDir: inferWorktreeName(w.path) !== null,
				}))
				.sort((a, b) => b.wt.path.length - a.wt.path.length)
		: null;

	const worktreeItems = new Map<string, SessionMeta[]>();
	const hasLiveList = Boolean(liveWorktrees && liveWorktrees.length > 0);

	for (const s of sessions) {
		// 1. Direct sessionIds attachment (G8)
		const directWt = wtBySessionId.get(s.id);
		if (directWt) {
			const items = worktreeItems.get(directWt.path) ?? [];
			items.push(s);
			worktreeItems.set(directWt.path, items);
			continue;
		}

		// 2. Canonical-aware deepest cwd containment (G8)
		if (liveWorktrees && liveWorktrees.length > 0) {
			const inWtDir = inferWorktreeName(s.cwd) !== null;
			const normCwd = normalizePath(s.cwd);
			const matched = liveWorktrees.find(
				(w) =>
					(isInside(s.cwd, w.wt.path) || isInside(normCwd, w.normPath)) &&
					(!inWtDir || w.isWtDir),
			);
			if (matched) {
				const items = worktreeItems.get(matched.wt.path) ?? [];
				items.push(s);
				worktreeItems.set(matched.wt.path, items);
				continue;
			}
		}

		let key = "default";
		let kind: "worktree" | "branch" | "default" = "default";
		let label = "其他";
		let deleted = false;
		let isMain = false;

		// G9: A cwd inside a `.worktrees/<n>` / `.cache/wt-<n>` dir that matches no
		// entry of a non-empty live list is deleted, even with a stale git badge.
		const inferred = inferWorktreeName(s.cwd);
		if (hasLiveList && inferred !== null) {
			key = `wt:${inferred}`;
			kind = "worktree";
			label = inferred;
			deleted = true;
		} else if (s.git?.worktree) {
			key = `wt:${s.git.worktree}`;
			kind = "worktree";
			const parts = s.git.worktree.split(/[/\\]/);
			label = parts[parts.length - 1] || s.git.worktree;
		} else if (s.git?.branch) {
			key = `br:${s.git.branch}`;
			kind = "branch";
			label = s.git.branch;
			// G18: before the worktree list loads (worktrees === undefined),
			// main-checkout badge buckets are treated as main so there's no layout jump.
			if (worktrees === undefined) {
				isMain = true;
			}
		} else {
			if (inferred) {
				key = `wt:${inferred}`;
				kind = "worktree";
				label = inferred;
				deleted = true;
			}
		}

		let bucket = bucketMap.get(key);
		if (!bucket) {
			bucket = { kind, label, deleted, isMain, items: [] };
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
				sessions: [...(worktreeItems.get(wt.path) ?? [])].sort(compare),
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
			isMain: bucket.isMain,
			createCwd: bucket.items[0]?.cwd,
			sessions: [...bucket.items].sort(compare),
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
 * 4. Unassigned ("未归入工作区") bucket + "已清理的工作树" bucket for unassigned
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

	// Space filter first: sessions of other modes never enter any bucket,
	// and workspaces of other modes never claim a session.
	const mode = options.mode ?? "code";
	const modeSessions = sessionList.filter((s) => s.mode === mode);
	const modeWorkspaces = workspaces.filter((w) => w.mode === mode);

	const timeMap = buildSessionTimeMap(modeSessions);
	const compare = createSessionComparator(timeMap, options.frozenOrder);

	const visibleSessions = filterSessions(modeSessions, {
		...options,
		workspaces: modeWorkspaces,
	});

	const globalWs = modeWorkspaces.find((w) => w.kind === "global") ?? null;
	const projectWorkspaces = modeWorkspaces
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

	// Split unassigned: sessions on deleted worktrees go to a dedicated dimmed
	// bucket instead of vanishing (or polluting the live list).
	const groupByWorktree = options.groupByWorktree ?? true;
	const isDeletedWt = (s: SessionMeta) =>
		groupByWorktree && !s.git?.worktree && !s.git?.branch && inferWorktreeName(s.cwd) !== null;
	const unassignedLive = unassignedSessions.filter((s) => !s.pinned && !isDeletedWt(s));
	const unassignedDeleted = unassignedSessions.filter((s) => !s.pinned && isDeletedWt(s));

	const pinnedSessions = visibleSessions
		.filter((s) => s.pinned)
		.sort(compare);
	const unassigned = [...unassignedLive].sort(compare);
	const deletedSessions = [...unassignedDeleted].sort(compare);

	// Group unassigned live sessions by repoRoot ?? cwd (Contract 5 / G15)
	const unassignedGroupMap = new Map<string, SessionMeta[]>();
	for (const s of unassignedLive) {
		const root = s.repoRoot ?? s.cwd;
		let arr = unassignedGroupMap.get(root);
		if (!arr) {
			arr = [];
			unassignedGroupMap.set(root, arr);
		}
		arr.push(s);
	}

	const rawUnassignedGroups: {
		key: string;
		cwd: string;
		label: string;
		sessions: SessionMeta[];
		newestTime: number;
	}[] = [];

	for (const [cwd, items] of unassignedGroupMap.entries()) {
		const sorted = [...items].sort(compare);
		let newest = 0;
		for (const item of items) {
			const t = timeMap.get(item.id) ?? 0;
			if (t > newest) newest = t;
		}
		rawUnassignedGroups.push({
			key: cwd,
			cwd,
			label: basename(cwd) || cwd,
			sessions: sorted,
			newestTime: newest,
		});
	}

	// Newest group first
	rawUnassignedGroups.sort((a, b) => b.newestTime - a.newestTime);
	const unassignedGroups = rawUnassignedGroups.map(({ key, cwd, label, sessions }) => ({
		key,
		cwd,
		label,
		sessions,
	}));

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

	const buildSubgroups = (
		items: SessionMeta[],
		wts: WorktreeInfo[] | undefined,
		ws: Workspace,
	): { live: BranchSubgroup[]; deleted: BranchSubgroup[] } => {
		if (!groupByWorktree) {
			if (items.length === 0) return { live: [], deleted: [] };
			return {
				live: [
					{
						key: "default",
						kind: "default",
						label: "其他",
						deleted: false,
						isMain: true,
						createCwd: ws.path,
						sessions: [...items].sort(compare),
						totalCount: items.length,
					},
				],
				deleted: [],
			};
		}
		return splitSubgroups(createSubgroups(items, wts, compare).subgroups);
	};

	const workspaceGroups: WorkspaceGroup[] = projectWorkspaces.map((ws) => {
		const allWsSessions = sessionMap.get(ws.id) ?? [];
		const pinnedCount = allWsSessions.filter((s) => s.pinned).length;
		const items = allWsSessions.filter((s) => !s.pinned);
		const { live, deleted } = buildSubgroups(items, options.worktrees?.[ws.id], ws);
		return {
			workspace: ws,
			isGlobal: false,
			subgroups: live,
			deletedSubgroups: deleted,
			hasMultipleSubgroups: live.length > 1,
			totalCount: items.length,
			pinnedCount,
		};
	});

	const globalGroup: WorkspaceGroup | null = globalWs
		? (() => {
				const pinnedCount = globalSessions.filter((s) => s.pinned).length;
				const items = globalSessions.filter((s) => !s.pinned);
				const { live, deleted } = buildSubgroups(items, undefined, globalWs);
				return {
					workspace: globalWs,
					isGlobal: true,
					subgroups: live,
					deletedSubgroups: deleted,
					hasMultipleSubgroups: live.length > 1,
					totalCount: items.length,
					pinnedCount,
				};
			})()
		: null;

	const totalVisible =
		pinnedSessions.length +
		(globalGroup?.totalCount ?? 0) +
		workspaceGroups.reduce((acc, g) => acc + g.totalCount, 0) +
		unassigned.length +
		deletedSessions.length;

	return {
		pinnedSessions,
		globalGroup,
		unassigned,
		unassignedGroups,
		deletedSessions,
		workspaceGroups,
		totalVisible,
	};
}
