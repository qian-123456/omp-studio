/**
 * Pure session-tree logic ported from the old `createTree` (nav-left.js): wire types, status counts, search
 * filtering, capped lists, and `flattenTree`, which turns the grouped tree into a flat list of row descriptors
 * the UI can render with memoized rows (no whole-tree re-render per SSE event).
 */
import type { MobileSession, SpaceMode } from "../../core/types";

/* ---------------------------------------------------------------- wire types (`GET /left/sessions`) */

/** Full `SessionMeta` rows of the tree carry `unread`; the flat `/sessions` rows do not. */
export type TreeSession = MobileSession & { unread?: boolean };

export interface Workspace {
	id: string;
	path: string;
	name: string;
	kind?: string;
	mode?: SpaceMode;
}

export interface Subgroup {
	key: string;
	kind: "worktree" | "branch" | "default" | string;
	label: string;
	deleted: boolean;
	isMain?: boolean;
	path?: string;
	createCwd?: string;
	sessions: TreeSession[];
	totalCount: number;
}

export interface WorkspaceGroup {
	workspace: Workspace;
	isGlobal: boolean;
	subgroups: Subgroup[];
	deletedSubgroups: Subgroup[];
	totalCount: number;
	pinnedCount?: number;
}

export interface UnassignedGroup {
	key: string;
	cwd: string;
	label: string;
	sessions: TreeSession[];
}

export interface SessionTree {
	mode?: SpaceMode;
	pinned: TreeSession[];
	globalGroup: WorkspaceGroup | null;
	workspaceGroups: WorkspaceGroup[];
	unassignedGroups: UnassignedGroup[];
	deletedSessions: TreeSession[];
	archived: TreeSession[];
}

/** `GET /left/dirs` entry. */
export interface DirEntry {
	path: string;
	label: string;
	kind: "workspace" | "worktree" | "global" | string;
	workspaceId?: string | null;
	mode?: SpaceMode;
}

export const MODES: ReadonlyArray<readonly [SpaceMode, string]> = [
	["code", "代码"],
	["work", "工作"],
	["study", "学习"],
	["research", "研究"],
	["chat", "聊天"],
];
export const modeLabel = (m: SpaceMode): string => MODES.find((x) => x[0] === m)?.[1] ?? "代码";
export const isSpaceMode = (v: unknown): v is SpaceMode => MODES.some((x) => x[0] === v);

/* ---------------------------------------------------------------- limits (desktop parity) */

export const RECENT_LIMIT = 3;
export const RECENT_STEP = 5;
export const NO_WT_LIMIT = 5;
export const SEARCH_LIMIT = 8;
export const SEARCH_STEP = 10;
export const DELETED_WT_LIMIT = 5;
export const DELETED_WT_STEP = 5;
export const UNASSIGNED_DIR_LIMIT = 10;
export const UNASSIGNED_DIR_STEP = 10;

/* ---------------------------------------------------------------- status helpers */

export const needsAttn = (s: Pick<MobileSession, "status">): boolean =>
	s.status === "working" || s.status === "awaiting_approval" || s.status === "awaiting_answer";

export interface StatusCounts {
	working: number;
	awaiting: number;
	error: number;
	unread: number;
}

/** Desktop `getGroupStatusCounts`. */
export function statusCounts(sessions: readonly TreeSession[]): StatusCounts {
	const c: StatusCounts = { working: 0, awaiting: 0, error: 0, unread: 0 };
	for (const s of sessions) {
		if (s.status === "working") c.working++;
		else if (s.status === "awaiting_approval" || s.status === "awaiting_answer") c.awaiting++;
		else if (s.status === "error" || s.status === "interrupted") c.error++;
		if (s.unread || s.status === "review" || s.pending === "review") c.unread++;
	}
	return c;
}

export const hasCounts = (c: StatusCounts): boolean => c.working + c.awaiting + c.error + c.unread > 0;

/* ---------------------------------------------------------------- tree transforms */

/** Rebuild the tree with `fn` applied to every session list (pinned/groups/unassigned/deleted/archived). */
export function mapTreeSessions(d: SessionTree, fn: (list: TreeSession[]) => TreeSession[]): SessionTree {
	const sub = (sb: Subgroup): Subgroup => {
		const sessions = fn(sb.sessions);
		return { ...sb, sessions, totalCount: sessions.length };
	};
	const group = (g: WorkspaceGroup): WorkspaceGroup => ({
		...g,
		subgroups: g.subgroups.map(sub),
		deletedSubgroups: g.deletedSubgroups.map(sub),
	});
	return {
		...d,
		pinned: fn(d.pinned),
		globalGroup: d.globalGroup ? group(d.globalGroup) : null,
		workspaceGroups: d.workspaceGroups.map(group),
		unassignedGroups: d.unassignedGroups.map((u) => ({ ...u, sessions: fn(u.sessions) })),
		deletedSessions: fn(d.deletedSessions),
		archived: fn(d.archived),
	};
}

/** Keep only sessions whose id is in `ids`; drop emptied subgroups/groups (search view of the tree). */
export function filterTree(d: SessionTree, ids: ReadonlySet<string>): SessionTree {
	const keep = (l: TreeSession[]) => l.filter((s) => ids.has(s.id));
	const base = mapTreeSessions(d, keep);
	const fgroup = (g: WorkspaceGroup): WorkspaceGroup | null => {
		const subgroups = g.subgroups.filter((sb) => sb.sessions.length);
		const deletedSubgroups = g.deletedSubgroups.filter((sb) => sb.sessions.length);
		if (!subgroups.length && !deletedSubgroups.length) return null;
		return {
			...g,
			subgroups,
			deletedSubgroups,
			pinnedCount: 0,
			totalCount: subgroups.reduce((n, sb) => n + sb.sessions.length, 0),
		};
	};
	return {
		...base,
		globalGroup: base.globalGroup ? fgroup(base.globalGroup) : null,
		workspaceGroups: base.workspaceGroups.map(fgroup).filter((g): g is WorkspaceGroup => g !== null),
		unassignedGroups: base.unassignedGroups.filter((u) => u.sessions.length),
	};
}

const SESSION_FIELDS = [
	"label",
	"title",
	"status",
	"pending",
	"updatedAt",
	"cwd",
	"live",
	"lastAssistant",
	"pinned",
	"archived",
	"unread",
	"mode",
	"workspaceId",
] as const;

const sameSession = (a: TreeSession, b: TreeSession): boolean => {
	for (const k of SESSION_FIELDS) if (a[k] !== b[k]) return false;
	return true;
};

/**
 * Structural sharing across reloads: any session whose rendered fields are unchanged keeps its previous object
 * identity, so memoized rows skip rendering after a refetch.
 */
export function reuseSessions(prev: SessionTree | null, next: SessionTree): SessionTree {
	if (!prev) return next;
	const old = new Map<string, TreeSession>();
	const collect = (l: readonly TreeSession[]) => {
		for (const s of l) old.set(s.id, s);
	};
	mapTreeSessions(prev, (l) => (collect(l), l));
	return mapTreeSessions(next, (l) =>
		l.map((s) => {
			const p = old.get(s.id);
			return p && sameSession(p, s) ? p : s;
		}),
	);
}

/** Replace one session (by id) everywhere it appears; untouched lists keep their identity. */
export function patchTreeSession(d: SessionTree, id: string, patch: Partial<TreeSession>): SessionTree {
	let hit: TreeSession | null = null;
	return mapTreeSessions(d, (l) => {
		const i = l.findIndex((s) => s.id === id);
		if (i < 0) return l;
		hit = { ...l[i], ...patch };
		const copy = l.slice();
		copy[i] = hit;
		return copy;
	});
}

/* ---------------------------------------------------------------- collapse persistence */

export const TREE_STORAGE_KEY = "omp.m.tree.v1";

export interface PersistedTree {
	mode: SpaceMode;
	open: Record<string, boolean>;
}

export function loadPersistedTree(storage: Pick<Storage, "getItem"> | null): PersistedTree {
	const fallback: PersistedTree = { mode: "code", open: {} };
	if (!storage) return fallback;
	try {
		const raw = storage.getItem(TREE_STORAGE_KEY);
		if (!raw) return fallback;
		const v = JSON.parse(raw) as { mode?: unknown; open?: unknown };
		const open: Record<string, boolean> = {};
		if (v.open && typeof v.open === "object") {
			for (const [k, b] of Object.entries(v.open as Record<string, unknown>)) if (typeof b === "boolean") open[k] = b;
		}
		return { mode: isSpaceMode(v.mode) ? v.mode : "code", open };
	} catch {
		return fallback;
	}
}

export function savePersistedTree(storage: Pick<Storage, "setItem"> | null, v: PersistedTree): void {
	if (!storage) return;
	try {
		storage.setItem(TREE_STORAGE_KEY, JSON.stringify(v));
	} catch {
		/* quota / private mode: collapse state is a convenience only */
	}
}

/** Desktop `isGroupOpen`: forced open while searching, else the user override, else the per-group default. */
export function isGroupOpen(open: Readonly<Record<string, boolean>>, key: string, def: boolean, searching: boolean): boolean {
	if (searching) return true;
	return key in open ? open[key] : def;
}

/* ---------------------------------------------------------------- capped lists */

export interface CapResult {
	/** Indices of `sessions` to render. */
	shown: number[];
	hidden: number;
	expandable: number;
	/** New `visible` target when 展开 is pressed. */
	expandTo: number;
	showExpand: boolean;
	showCollapse: boolean;
}

/**
 * Desktop SessionList cap: show the first `limit` (or the user-expanded count) plus every session that needs
 * attention or is the current one. Hidden runs are reported as gaps by the caller.
 */
export function capSessions(
	sessions: readonly TreeSession[],
	baseLimit: number,
	expandedTo: number | undefined,
	opts: { searching: boolean; curId?: string | null },
): CapResult {
	const limit = opts.searching ? SEARCH_LIMIT : baseLimit;
	const step = opts.searching ? SEARCH_STEP : RECENT_STEP;
	const visible = Math.min(Math.max(expandedTo ?? limit, limit), sessions.length);
	const keep = (s: TreeSession, i: number) => i < visible || needsAttn(s) || s.id === opts.curId;
	const shown: number[] = [];
	sessions.forEach((s, i) => {
		if (keep(s, i)) shown.push(i);
	});
	const hidden = sessions.length - shown.length;
	const next = Math.min(visible + step, sessions.length);
	const fresh = sessions.slice(visible, next).filter((s) => !needsAttn(s) && s.id !== opts.curId).length;
	return {
		shown,
		hidden,
		expandable: fresh > 0 ? fresh : Math.min(step, hidden),
		expandTo: visible + step,
		showExpand: hidden > 0,
		showCollapse: visible > limit,
	};
}

/** `展开 N <unit>` / `收起` for capped lists of subgroups (dirs / deleted worktrees). */
export function capCount(
	total: number,
	limit: number,
	step: number,
	expandedTo: number | undefined,
	searching: boolean,
	exemptWhenSearching: boolean,
): { visible: number; hidden: number; expandTo: number; showExpand: boolean; showCollapse: boolean; bar: boolean } {
	const visible = Math.min(Math.max(expandedTo ?? limit, limit), total);
	if (total <= limit) return { visible, hidden: 0, expandTo: visible, showExpand: false, showCollapse: false, bar: false };
	if (searching && exemptWhenSearching)
		return { visible: total, hidden: 0, expandTo: total, showExpand: false, showCollapse: false, bar: false };
	const hidden = total - visible;
	return {
		visible,
		hidden,
		expandTo: visible + step,
		showExpand: hidden > 0,
		showCollapse: visible > limit,
		bar: true,
	};
}

/* ---------------------------------------------------------------- flat rows */

export type HeaderIcon = "pin" | "folder" | "branch" | "worktree" | "archive" | "unassigned" | "deleted";

export type HeaderAction =
	| { kind: "plus"; cwd: string; label: string }
	| { kind: "archive"; label: string; scope: string; title: string }
	| { kind: "addws"; cwd: string; label: string };

export interface HeaderRow {
	t: "h";
	key: string;
	def: boolean;
	open: boolean;
	level: "sec" | "sub";
	depth: number;
	icon: HeaderIcon;
	title: string;
	hint: string;
	tags: string[];
	count: number | null;
	bubbles: StatusCounts | null;
	actions: HeaderAction[];
	dim: boolean;
}
export interface SessionRowDesc {
	t: "s";
	key: string;
	s: TreeSession;
	depth: number;
	current: boolean;
}
export interface MoreRow {
	t: "more";
	key: string;
	moreKey: string;
	depth: number;
	expandText: string | null;
	expandTo: number;
	collapse: boolean;
}
export interface GapRow {
	t: "gap";
	key: string;
	depth: number;
	skipped: number;
}
export interface NoneRow {
	t: "none";
	key: string;
	depth: number;
	text: string;
}
export interface UnassignedBarRow {
	t: "ubar";
	key: string;
	depth: number;
	scope: string;
	total: number;
}
export type FlatRow = HeaderRow | SessionRowDesc | MoreRow | GapRow | NoneRow | UnassignedBarRow;

export interface FlattenOptions {
	searching: boolean;
	open: Readonly<Record<string, boolean>>;
	expanded: Readonly<Record<string, number>>;
	curId?: string | null;
}

export interface FlattenResult {
	rows: FlatRow[];
	/** Session lists behind batch actions (`archive`, 归入工作区), keyed by `HeaderAction.scope`. */
	scopes: Record<string, TreeSession[]>;
}

export const UNASSIGNED_SCOPE = "__unassigned";
export const baseNameOf = (p: string | null | undefined): string =>
	String(p || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p || "";

/** Port of `createTree.paint()`: grouped tree → flat row descriptors. */
export function flattenTree(d: SessionTree, o: FlattenOptions): FlattenResult {
	const rows: FlatRow[] = [];
	const scopes: Record<string, TreeSession[]> = {};
	const isOpen = (key: string, def: boolean) => isGroupOpen(o.open, key, def, o.searching);

	const header = (
		key: string,
		def: boolean,
		h: Pick<HeaderRow, "level" | "depth" | "icon" | "title"> &
			Partial<Pick<HeaderRow, "hint" | "tags" | "count" | "actions" | "dim">> & { status?: readonly TreeSession[] },
	): boolean => {
		const open = isOpen(key, def);
		const counts = !open && h.status ? statusCounts(h.status) : null;
		rows.push({
			t: "h",
			key,
			def,
			open,
			level: h.level,
			depth: h.depth,
			icon: h.icon,
			title: h.title,
			hint: h.hint ?? "",
			tags: h.tags ?? [],
			count: h.count ?? null,
			bubbles: counts && hasCounts(counts) ? counts : null,
			actions: h.actions ?? [],
			dim: h.dim ?? false,
		});
		return open;
	};

	const moreBar = (key: string, moreKey: string, depth: number, expandText: string | null, expandTo: number, collapse: boolean) => {
		if (expandText || collapse) rows.push({ t: "more", key, moreKey, depth, expandText, expandTo, collapse });
	};

	const cappedList = (scopeKey: string, sessions: TreeSession[], baseLimit: number, depth: number) => {
		const moreKey = `${scopeKey}|more`;
		const cap = capSessions(sessions, baseLimit, o.expanded[moreKey], { searching: o.searching, curId: o.curId });
		let prev = -1;
		for (const i of cap.shown) {
			if (i - prev > 1) rows.push({ t: "gap", key: `${scopeKey}|gap|${i}`, depth, skipped: i - prev - 1 });
			const s = sessions[i];
			rows.push({ t: "s", key: `${scopeKey}|${s.id}`, s, depth, current: s.id === o.curId });
			prev = i;
		}
		moreBar(
			`${moreKey}|bar`,
			moreKey,
			depth,
			cap.showExpand ? `展开 ${cap.expandable} 条` : null,
			cap.expandTo,
			cap.showCollapse,
		);
	};

	const flatList = (scopeKey: string, sessions: TreeSession[], depth: number) => {
		for (const s of sessions) rows.push({ t: "s", key: `${scopeKey}|${s.id}`, s, depth, current: s.id === o.curId });
	};

	const capBarRows = (moreKey: string, total: number, limit: number, step: number, unit: string, exempt: boolean, depth: number) => {
		const c = capCount(total, limit, step, o.expanded[moreKey], o.searching, exempt);
		return { visible: c.visible, emit: () => c.bar && moreBar(`${moreKey}|bar`, moreKey, depth, c.showExpand ? `展开 ${Math.min(step, c.hidden)} 个${unit}` : null, c.expandTo, c.showCollapse) };
	};

	const subgroup = (sub: Subgroup, scopeKey: string, depth: number, archiveScope: boolean) => {
		const empty = sub.sessions.length === 0;
		const actions: HeaderAction[] = [];
		if (!sub.deleted && sub.createCwd) actions.push({ kind: "plus", cwd: sub.createCwd, label: sub.label });
		if (sub.deleted && archiveScope) {
			const scope = `sub|${scopeKey}`;
			scopes[scope] = sub.sessions;
			actions.push({ kind: "archive", label: "归档该分支全部会话", scope, title: sub.label });
		}
		const tags: string[] = [];
		if (sub.isMain) tags.push("主目录");
		if (sub.deleted) tags.push("已清理");
		if (!sub.deleted && empty) tags.push("暂无会话");
		const open = header(`${scopeKey}|sub`, !(sub.deleted || empty), {
			level: "sub",
			depth,
			icon: sub.kind === "worktree" ? "worktree" : "branch",
			title: sub.label,
			tags,
			count: empty ? null : sub.sessions.length,
			status: sub.sessions,
			actions,
			dim: empty && !sub.deleted,
		});
		if (open) cappedList(scopeKey, sub.sessions, RECENT_LIMIT, depth + 1);
	};

	const emptyFolder = (gkey: string, subs: Subgroup[], depth: number) => {
		if (!subs.length) return;
		const fk = `${gkey}|__empty`;
		const open = header(fk, false, {
			level: "sub",
			depth,
			icon: "branch",
			title: `空闲工作树 (${subs.length})`,
			dim: true,
		});
		if (open) for (const sb of subs) subgroup(sb, `${fk}|${sb.key}`, depth + 1, false);
	};

	const deletedFolder = (gkey: string, subs: Subgroup[], depth: number) => {
		if (!subs.length) return;
		const fk = `${gkey}|__deleted`;
		const all = subs.flatMap((sb) => sb.sessions);
		const scope = `del|${fk}`;
		scopes[scope] = all;
		const open = header(fk, false, {
			level: "sub",
			depth,
			icon: "worktree",
			title: `已清理工作树 (${subs.length})`,
			status: all,
			actions: [{ kind: "archive", label: "一键归档全部已清理工作树的会话", scope, title: "已清理工作树" }],
			dim: true,
		});
		if (!open) return;
		const cb = capBarRows(`${fk}|wt_more`, subs.length, DELETED_WT_LIMIT, DELETED_WT_STEP, "工作树", false, depth + 1);
		for (const sb of subs.slice(0, cb.visible)) subgroup(sb, `${fk}|${sb.key}`, depth + 1, true);
		cb.emit();
	};

	const groupRows = (g: WorkspaceGroup, prefix: string) => {
		const ws = g.workspace;
		const title = g.isGlobal ? "无项目" : ws.name || baseNameOf(ws.path);
		const gkey = `${prefix}:${ws.id}`;
		const live = g.subgroups.filter((x) => !x.deleted && x.sessions.length > 0);
		const empty = g.subgroups.filter((x) => !x.deleted && x.sessions.length === 0);
		const open = header(gkey, true, {
			level: "sec",
			depth: 0,
			icon: "folder",
			title,
			hint: g.isGlobal ? "" : ws.path,
			count: g.totalCount,
			status: g.subgroups.filter((x) => !x.deleted).flatMap((x) => x.sessions),
			actions: ws.path ? [{ kind: "plus", cwd: ws.path, label: title }] : [],
		});
		if (!open) return;
		const trulyEmpty =
			g.totalCount === 0 && (g.pinnedCount ?? 0) === 0 && !live.length && !empty.length && !g.deletedSubgroups.length;
		if (trulyEmpty) {
			rows.push({ t: "none", key: `${gkey}|none`, depth: 1, text: "暂无会话" });
			return;
		}
		const multi = live.length > 1 || (live[0] !== undefined && live[0].kind !== "default" && !live[0].isMain);
		if (multi) for (const sb of live) subgroup(sb, `${gkey}|${sb.key}`, 1, false);
		else cappedList(`${gkey}|default`, live[0] ? live[0].sessions : [], NO_WT_LIMIT, 1);
		emptyFolder(gkey, empty, 1);
		deletedFolder(gkey, g.deletedSubgroups, 1);
	};

	const unassignedDir = (u: UnassignedGroup) => {
		const key = `__unassigned|${u.key}`;
		const scope = `dir|${u.key}`;
		scopes[scope] = u.sessions;
		const label = u.label || baseNameOf(u.cwd);
		const open = header(key, false, {
			level: "sub",
			depth: 1,
			icon: "folder",
			title: label,
			hint: u.cwd,
			count: u.sessions.length,
			status: u.sessions,
			actions: [
				{ kind: "archive", label: "归档该目录下全部会话", scope, title: label },
				{ kind: "addws", cwd: u.cwd, label },
			],
		});
		if (open) cappedList(key, u.sessions, RECENT_LIMIT, 2);
	};

	const unassignedBucket = () => {
		const dirs = d.unassignedGroups;
		const all = dirs.flatMap((u) => u.sessions);
		scopes[UNASSIGNED_SCOPE] = all;
		const open = header("__unassigned", false, {
			level: "sec",
			depth: 0,
			icon: "unassigned",
			title: "未归入工作区",
			count: all.length,
			status: all,
		});
		if (!open) return;
		const cb = capBarRows("__unassigned|dir_more", dirs.length, UNASSIGNED_DIR_LIMIT, UNASSIGNED_DIR_STEP, "目录", true, 1);
		for (const u of dirs.slice(0, cb.visible)) unassignedDir(u);
		cb.emit();
		rows.push({ t: "ubar", key: "__unassigned|bar", depth: 1, scope: UNASSIGNED_SCOPE, total: all.length });
	};

	const pinned = d.pinned ?? [];
	const workspaceGroups = d.workspaceGroups ?? [];
	const unassignedGroups = d.unassignedGroups ?? [];
	const deletedSessions = d.deletedSessions ?? [];
	const archived = d.archived ?? [];

	if (pinned.length) {
		if (header("__pinned", true, { level: "sec", depth: 0, icon: "pin", title: "置顶", count: pinned.length, status: pinned }))
			flatList("__pinned", pinned, 1);
	}
	if (d.globalGroup) groupRows(d.globalGroup, "g");
	for (const g of workspaceGroups) groupRows(g, "w");
	if (unassignedGroups.length) unassignedBucket();
	if (deletedSessions.length) {
		scopes.__deleted = deletedSessions;
		const open = header("__deleted", false, {
			level: "sec",
			depth: 0,
			icon: "deleted",
			title: "已清理工作树",
			count: deletedSessions.length,
			status: deletedSessions,
			actions: [{ kind: "archive", label: "一键归档全部已清理工作树的会话", scope: "__deleted", title: "已清理工作树" }],
			dim: true,
		});
		if (open) cappedList("__deleted", deletedSessions, RECENT_LIMIT, 1);
	}
	if (archived.length) {
		const open = header("archived", false, {
			level: "sec",
			depth: 0,
			icon: "archive",
			title: "已归档",
			count: archived.length,
		});
		if (open) cappedList("archived", archived, NO_WT_LIMIT, 1);
	}
	return { rows, scopes };
}

/* ---------------------------------------------------------------- row equality (memo) */

const shallowEq = (a: object, b: object): boolean => {
	const ka = Object.keys(a) as (keyof typeof a)[];
	if (ka.length !== Object.keys(b).length) return false;
	for (const k of ka) {
		const x = a[k] as unknown;
		const y = b[k] as unknown;
		if (x === y) continue;
		if (Array.isArray(x) && Array.isArray(y) && JSON.stringify(x) === JSON.stringify(y)) continue;
		if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x) && shallowEq(x, y)) continue;
		return false;
	}
	return true;
};

/** Memo comparator: session rows compare by object identity, descriptor rows by value. */
export const rowEqual = (a: FlatRow, b: FlatRow): boolean => {
	if (a === b) return true;
	if (a.t !== b.t) return false;
	if (a.t === "s") {
		const o = b as SessionRowDesc;
		return a.s === o.s && a.depth === o.depth && a.current === o.current && a.key === o.key;
	}
	return shallowEq(a, b);
};

/** Search page: sessions matched by `GET /left/search`; empty/absent query → no filter. */
export function searchIds(sessions: ReadonlyArray<{ id: string }> | undefined): Set<string> {
	return new Set((sessions ?? []).map((s) => s.id));
}
