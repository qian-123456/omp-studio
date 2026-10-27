import { describe, expect, it } from "vitest";
import {
	capCount,
	capSessions,
	filterTree,
	flattenTree,
	isGroupOpen,
	loadPersistedTree,
	patchTreeSession,
	reuseSessions,
	rowEqual,
	savePersistedTree,
	statusCounts,
	TREE_STORAGE_KEY,
	type HeaderRow,
	type SessionTree,
	type Subgroup,
	type TreeSession,
	type WorkspaceGroup,
} from "./tree";

let n = 0;
const sess = (over: Partial<TreeSession> = {}): TreeSession => {
	n += 1;
	return {
		id: `s${n}`,
		label: `#${n}`,
		title: `会话 ${n}`,
		status: "idle",
		updatedAt: "2026-01-01T00:00:00Z",
		cwd: "/w",
		live: false,
		...over,
	};
};
const many = (k: number, over: Partial<TreeSession> = {}) => Array.from({ length: k }, () => sess(over));

const sub = (key: string, sessions: TreeSession[], over: Partial<Subgroup> = {}): Subgroup => ({
	key,
	kind: "default",
	label: key,
	deleted: false,
	sessions,
	totalCount: sessions.length,
	...over,
});
const group = (id: string, subgroups: Subgroup[], over: Partial<WorkspaceGroup> = {}): WorkspaceGroup => ({
	workspace: { id, path: `/p/${id}`, name: id },
	isGlobal: false,
	subgroups,
	deletedSubgroups: [],
	totalCount: subgroups.reduce((c, s) => c + s.sessions.length, 0),
	pinnedCount: 0,
	...over,
});
const tree = (over: Partial<SessionTree> = {}): SessionTree => ({
	pinned: [],
	globalGroup: null,
	workspaceGroups: [],
	unassignedGroups: [],
	deletedSessions: [],
	archived: [],
	...over,
});
const flat = (d: SessionTree, o: Partial<Parameters<typeof flattenTree>[1]> = {}) =>
	flattenTree(d, { searching: false, open: {}, expanded: {}, ...o });
const headers = (rows: ReturnType<typeof flat>["rows"]) => rows.filter((r): r is HeaderRow => r.t === "h");

describe("flattenTree: workspace groups", () => {
	it("single default subgroup renders sessions flat (capped to 5) with an expand bar", () => {
		const d = tree({ workspaceGroups: [group("a", [sub("default", many(8))])] });
		const { rows } = flat(d);
		expect(headers(rows).map((h) => h.title)).toEqual(["a"]);
		expect(rows.filter((r) => r.t === "s")).toHaveLength(5);
		const more = rows.find((r) => r.t === "more");
		expect(more).toMatchObject({ t: "more", expandText: "展开 3 条", collapse: false });
	});

	it("worktree/branch subgroups get their own header with a create-here action and 3 recents", () => {
		const wt = sub("wt1", many(4), { kind: "worktree", label: "feat-x", createCwd: "/p/a/.wt/feat-x" });
		const main = sub("main", many(1), { kind: "branch", isMain: true, label: "main" });
		const d = tree({ workspaceGroups: [group("a", [main, wt])] });
		const { rows } = flat(d);
		const hs = headers(rows);
		expect(hs.map((h) => h.title)).toEqual(["a", "main", "feat-x"]);
		expect(hs[1].tags).toContain("主目录");
		expect(hs[2].icon).toBe("worktree");
		expect(hs[2].actions).toEqual([{ kind: "plus", cwd: "/p/a/.wt/feat-x", label: "feat-x" }]);
		expect(rows.filter((r) => r.t === "s" && r.key.includes("wt1"))).toHaveLength(3);
		expect(hs[0].actions).toEqual([{ kind: "plus", cwd: "/p/a", label: "a" }]);
	});

	it("empty worktrees are folded into one collapsed 「空闲工作树」 folder; deleted ones into 「已清理工作树」 with batch archive", () => {
		const live = sub("l", many(2), { kind: "worktree" });
		const empty = sub("e", [], { kind: "worktree", label: "idle-wt" });
		const gone = sub("d", many(2), { kind: "worktree", deleted: true, label: "gone" });
		const d = tree({ workspaceGroups: [group("a", [live, empty], { deletedSubgroups: [gone] })] });
		const { rows, scopes } = flat(d);
		const titles = headers(rows).map((h) => h.title);
		expect(titles).toContain("空闲工作树 (1)");
		expect(titles).toContain("已清理工作树 (1)");
		expect(titles).not.toContain("idle-wt"); // folder collapsed by default
		const del = headers(rows).find((h) => h.title.startsWith("已清理"))!;
		expect(del.open).toBe(false);
		expect(del.actions[0]).toMatchObject({ kind: "archive" });
		expect(scopes[(del.actions[0] as { scope: string }).scope]).toHaveLength(2);
		// expanding the folder shows the empty worktree dimmed with 「暂无会话」
		const opened = flat(d, { open: { "w:a|__empty": true } });
		const idle = headers(opened.rows).find((h) => h.title === "idle-wt")!;
		expect(idle.tags).toContain("暂无会话");
		expect(idle.dim).toBe(true);
		expect(idle.count).toBeNull();
	});

	it("a group with nothing at all says 暂无会话", () => {
		const d = tree({ workspaceGroups: [group("a", [])] });
		expect(flat(d).rows.filter((r) => r.t === "none")).toMatchObject([{ text: "暂无会话" }]);
	});

	it("global group is titled 无项目 and has no path hint", () => {
		const g = group("global", [sub("default", many(1))], { isGlobal: true });
		const d = tree({ globalGroup: g });
		const h = headers(flat(d).rows)[0];
		expect(h.title).toBe("无项目");
		expect(h.hint).toBe("");
	});
});

describe("flattenTree: pinned / unassigned / archived", () => {
	it("pinned section is open by default and uncapped", () => {
		const d = tree({ pinned: many(9) });
		const { rows } = flat(d);
		expect(headers(rows)[0]).toMatchObject({ title: "置顶", count: 9, icon: "pin" });
		expect(rows.filter((r) => r.t === "s")).toHaveLength(9);
	});

	it("unassigned bucket is collapsed; opening lists dirs (collapsed) with archive + add-workspace actions and the bulk bar", () => {
		const u = { key: "k1", cwd: "/x/proj", label: "proj", sessions: many(2) };
		const d = tree({ unassignedGroups: [u] });
		const closed = flat(d);
		expect(headers(closed.rows)).toHaveLength(1);
		expect(closed.rows.some((r) => r.t === "ubar")).toBe(false);
		const opened = flat(d, { open: { __unassigned: true } });
		const dir = headers(opened.rows).find((h) => h.title === "proj")!;
		expect(dir.open).toBe(false);
		expect(dir.actions.map((a) => a.kind)).toEqual(["archive", "addws"]);
		expect(opened.rows.find((r) => r.t === "ubar")).toMatchObject({ total: 2 });
	});

	it("unassigned directories beyond 10 are capped with 「展开 N 个目录」", () => {
		const dirs = Array.from({ length: 13 }, (_, i) => ({ key: `k${i}`, cwd: `/d${i}`, label: `d${i}`, sessions: many(1) }));
		const { rows } = flat(tree({ unassignedGroups: dirs }), { open: { __unassigned: true } });
		expect(headers(rows).filter((h) => h.level === "sub")).toHaveLength(10);
		expect(rows.find((r) => r.t === "more")).toMatchObject({ expandText: "展开 3 个目录" });
		// while searching the cap is lifted
		const s = flat(tree({ unassignedGroups: dirs }), { searching: true });
		expect(headers(s.rows).filter((h) => h.level === "sub")).toHaveLength(13);
	});

	it("archived and cleaned-up sections are collapsed by default", () => {
		const d = tree({ archived: many(3, { archived: true }), deletedSessions: many(2) });
		const hs = headers(flat(d).rows);
		expect(hs.map((h) => [h.title, h.open])).toEqual([
			["已清理工作树", false],
			["已归档", false],
		]);
	});
});

describe("collapse + bubbles", () => {
	it("user override beats default, and searching forces everything open", () => {
		expect(isGroupOpen({}, "k", true, false)).toBe(true);
		expect(isGroupOpen({ k: false }, "k", true, false)).toBe(false);
		expect(isGroupOpen({ k: false }, "k", true, true)).toBe(true);
		expect(isGroupOpen({ k: true }, "k", false, false)).toBe(true);
	});

	it("status bubbles appear only on collapsed headers", () => {
		const list = [sess({ status: "working" }), sess({ status: "awaiting_approval" }), sess({ unread: true }), sess({ status: "error" })];
		const d = tree({ workspaceGroups: [group("a", [sub("default", list)])] });
		const open = headers(flat(d).rows)[0];
		expect(open.bubbles).toBeNull();
		const closed = headers(flat(d, { open: { "w:a": false } }).rows)[0];
		expect(closed.bubbles).toEqual({ working: 1, awaiting: 1, error: 1, unread: 1 });
	});

	it("statusCounts treats review / pending review as unread", () => {
		expect(statusCounts([sess({ status: "review" }), sess({ pending: "review" })]).unread).toBe(2);
	});

	it("persists mode + open map, and ignores corrupt storage", () => {
		const mem = new Map<string, string>();
		const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
		savePersistedTree(st, { mode: "study", open: { a: false, b: true } });
		expect(loadPersistedTree(st)).toEqual({ mode: "study", open: { a: false, b: true } });
		mem.set(TREE_STORAGE_KEY, "{not json");
		expect(loadPersistedTree(st)).toEqual({ mode: "code", open: {} });
		mem.set(TREE_STORAGE_KEY, JSON.stringify({ mode: "nope", open: { x: 1, y: true } }));
		expect(loadPersistedTree(st)).toEqual({ mode: "code", open: { y: true } });
		expect(loadPersistedTree(null)).toEqual({ mode: "code", open: {} });
	});
});

describe("capSessions", () => {
	it("keeps attention and current sessions beyond the limit and reports gaps", () => {
		const list = many(10);
		list[7] = { ...list[7], status: "working" };
		const cap = capSessions(list, 3, undefined, { searching: false, curId: list[9].id });
		expect(cap.shown).toEqual([0, 1, 2, 7, 9]);
		expect(cap.hidden).toBe(5);
		expect(cap.showExpand).toBe(true);
		expect(cap.showCollapse).toBe(false);
	});

	it("expanded count raises the visible window and offers 收起", () => {
		const cap = capSessions(many(10), 3, 8, { searching: false });
		expect(cap.shown).toHaveLength(8);
		expect(cap.showCollapse).toBe(true);
		expect(cap.expandable).toBe(2);
	});

	it("uses the search limit (8) while searching", () => {
		expect(capSessions(many(20), 3, undefined, { searching: true }).shown).toHaveLength(8);
	});

	it("capCount: no bar under the limit, exempt when searching", () => {
		expect(capCount(4, 5, 5, undefined, false, false).bar).toBe(false);
		expect(capCount(12, 5, 5, undefined, true, true)).toMatchObject({ visible: 12, bar: false });
		expect(capCount(12, 5, 5, 10, false, false)).toMatchObject({ visible: 10, hidden: 2, showCollapse: true });
	});

	it("flatten emits 「N 条未显示」 gaps before shown attention rows", () => {
		const list = many(8);
		list[6] = { ...list[6], status: "awaiting_answer" };
		const d = tree({ archived: list });
		const { rows } = flat(d, { open: { archived: true } });
		const gap = rows.find((r) => r.t === "gap");
		expect(gap).toMatchObject({ skipped: 1 });
	});
});

describe("search filter", () => {
	it("keeps only matching sessions and drops emptied subgroups and groups", () => {
		const a = sess();
		const b = sess();
		const c = sess();
		const d = tree({
			pinned: [a, c],
			workspaceGroups: [
				group("w1", [sub("s1", [a, b]), sub("s2", [c])]),
				group("w2", [sub("s3", [c])]),
			],
			unassignedGroups: [{ key: "u", cwd: "/u", label: "u", sessions: [b] }],
			archived: [b],
		});
		const f = filterTree(d, new Set([a.id]));
		expect(f.pinned).toEqual([a]);
		expect(f.workspaceGroups).toHaveLength(1);
		expect(f.workspaceGroups[0].subgroups.map((s) => s.key)).toEqual(["s1"]);
		expect(f.workspaceGroups[0].totalCount).toBe(1);
		expect(f.unassignedGroups).toEqual([]);
		expect(f.archived).toEqual([]);
	});

	it("is case: empty id set yields an empty tree", () => {
		const d = tree({ workspaceGroups: [group("w", [sub("s", many(2))])], pinned: many(1) });
		const f = filterTree(d, new Set());
		expect(flat(f, { searching: true }).rows).toEqual([]);
	});
});

describe("incremental updates", () => {
	it("reuseSessions keeps identity of unchanged sessions and replaces changed ones", () => {
		const a = sess();
		const b = sess({ status: "working" });
		const prev = tree({ pinned: [a], archived: [b] });
		const next = tree({ pinned: [{ ...a }], archived: [{ ...b, status: "idle" }] });
		const merged = reuseSessions(prev, next);
		expect(merged.pinned[0]).toBe(a);
		expect(merged.archived[0]).not.toBe(b);
		expect(merged.archived[0].status).toBe("idle");
	});

	it("patchTreeSession touches only the affected session; other rows stay memo-equal", () => {
		const a = sess();
		const b = sess();
		const d = tree({ workspaceGroups: [group("w", [sub("default", [a, b])])] });
		const before = flat(d).rows;
		const after = flat(patchTreeSession(d, a.id, { status: "working" })).rows;
		const changed = after.filter((r, i) => !rowEqual(r, before[i]));
		expect(changed.map((r) => r.key)).toEqual([after.find((r) => r.t === "s" && r.s.id === a.id)!.key]);
	});

	it("rowEqual: header rows compare by value, so toggling one group leaves others equal", () => {
		const d = tree({ workspaceGroups: [group("a", [sub("default", many(1))]), group("b", [sub("default", many(1))])] });
		const x = flat(d).rows;
		const y = flat(d, { open: { "w:a": false } }).rows;
		const diff = headers(y).filter((h, i) => !rowEqual(h, headers(x)[i]));
		expect(diff.map((h) => h.key)).toEqual(["w:a"]);
	});
});
