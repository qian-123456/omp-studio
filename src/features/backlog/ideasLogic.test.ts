import { describe, expect, it } from "vitest";
import type { BacklogItem, BacklogStatus, SessionMeta, SessionStatus, Workspace } from "../../lib/contracts";
import {
	appendToDraft,
	buildBatchFillText,
	CAPTURE_PROJECT_NONE,
	captureProjectOptions,
	resolveCaptureProject,
	byCreatedDesc,
	EMPTY_SEARCH,
	effectiveScope,
	filterIdeas,
	formatAddedTime,
	groupIdeasByProject,
	ideaImages,
	ideaPhase,
	needsAttentionCount,
	partitionByPhase,
	rangeSelection,
	searchIdeas,
	sessionOptionLabel,
	splitByProject,
	splitSent,
	scopeOptions,
	tabCounts,
	trashDaysLeft,
} from "./ideasLogic";

const sessionMeta = (overrides: Partial<SessionMeta> = {}): SessionMeta => ({
	id: "12345678-90ab-cdef",
	tool: "omp",
	file: "/tmp/session.jsonl",
	cwd: "/tmp",
	title: "",
	label: "",
	createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-01T00:00:00Z",
	parentId: null,
	forkDepth: 0,
	status: "idle",
	unread: false,
	pending: null,
	live: false,
	externalPid: null,
	pinned: false,
	archived: false,
	workspaceId: null,
	repoRoot: null,
	git: null,
	result: null,
	lastAssistant: null,
	model: null,
	attention: null,
	mode: "code",
	groupId: null,
	...overrides,
});

describe("sessionOptionLabel", () => {
	it("uses a meaningful session title", () => {
		expect(sessionOptionLabel(sessionMeta({ title: "修复登录流程" }))).toBe("修复登录流程");
	});

	it("prefers the last assistant snippet over a generic title and caps long snippets", () => {
		const snippet = "Implemented login validation, error handling, regression tests, and compatibility checks for edge cases";
		expect(sessionOptionLabel(sessionMeta({ title: "会话 12345678", lastAssistant: snippet }))).toBe(`${snippet.slice(0, 39)}…`);
	});

	it("falls back to a short ID when the title is the raw ID", () => {
		expect(sessionOptionLabel(sessionMeta({ title: "12345678-90ab-cdef" }))).toBe("会话 12345678");
	});

	it("keeps a useful session label prefix", () => {
		expect(sessionOptionLabel(sessionMeta({ label: "#115.2", title: "修复登录流程" }))).toBe(
			"[#115.2] 修复登录流程",
		);
	});
});

const item = (
	id: string,
	status: BacklogStatus,
	projectDir: string | null,
	createdAt: string,
	updatedAt = createdAt,
): BacklogItem => ({
	id,
	text: id,
	kind: "idea",
	refs: [],
	status,
	targetSessionId: null,
	projectDir,
	createdAt,
	updatedAt,
	deletedAt: null,
});

const items = [
	item("old-here", "inbox", "/p/a", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
	item("new-other", "dispatched", "/p/b", "2026-01-03T00:00:00Z"),
	item("new-here", "dispatched", "/p/a", "2026-01-02T00:00:00Z"),
	item("global", "inbox", null, "2026-01-04T00:00:00Z"),
	item("done", "done", "/p/a", "2026-01-05T00:00:00Z"),
	item("closed", "closed", null, "2026-01-06T00:00:00Z"),
];

const nonFinished = items
	.filter((i) => i.status !== "done" && i.status !== "closed")
	.sort(byCreatedDesc);

describe("ideaPhase", () => {
	it("maps inbox to pending", () => {
		expect(ideaPhase(item("1", "inbox", null, "2026-01-01T00:00:00Z"), undefined)).toBe("pending");
	});

	it("maps done and closed to finished", () => {
		expect(ideaPhase(item("1", "done", null, "2026-01-01T00:00:00Z"), undefined)).toBe("finished");
		expect(ideaPhase(item("2", "closed", null, "2026-01-01T00:00:00Z"), undefined)).toBe("finished");
	});

	it("maps dispatched with missing session to review", () => {
		expect(ideaPhase(item("1", "dispatched", null, "2026-01-01T00:00:00Z"), undefined)).toBe("review");
	});

	it("maps dispatched with archived session to review even if working", () => {
		const session = sessionMeta({ status: "working", archived: true });
		expect(ideaPhase(item("1", "dispatched", null, "2026-01-01T00:00:00Z"), session)).toBe("review");
	});

	it("maps dispatched with active working states to running and all other statuses to review", () => {
		const runningStatuses: SessionStatus[] = ["working", "awaiting_approval", "awaiting_answer"];
		for (const status of runningStatuses) {
			const session = sessionMeta({ status, archived: false });
			expect(ideaPhase(item("1", "dispatched", null, "2026-01-01T00:00:00Z"), session)).toBe("running");
		}

		const reviewStatuses: SessionStatus[] = [
			"idle",
			"review",
			"error",
			"interrupted",
			"suspended",
			"external",
		];
		for (const status of reviewStatuses) {
			const session = sessionMeta({ status, archived: false });
			expect(ideaPhase(item("1", "dispatched", null, "2026-01-01T00:00:00Z"), session)).toBe("review");
		}
	});
});

describe("partitionByPhase", () => {
	it("partitions items into phases with newest-created first and updatedAt fallback", () => {
		const sessionMap: Record<string, SessionMeta> = {
			s_work: sessionMeta({ id: "s_work", status: "working" }),
			s_idle: sessionMeta({ id: "s_idle", status: "idle" }),
		};

		const testItems: BacklogItem[] = [
			item("p_old", "inbox", null, "2026-01-01T00:00:00Z"),
			item("p_new", "inbox", null, "2026-01-03T00:00:00Z"),
			{ ...item("p_legacy", "inbox", null, ""), updatedAt: "2026-01-05T00:00:00Z" },
			{ ...item("r_run1", "dispatched", null, "2026-01-02T00:00:00Z"), targetSessionId: "s_work" },
			{ ...item("r_run2", "dispatched", null, "2026-01-04T00:00:00Z"), targetSessionId: "s_work" },
			{ ...item("v_rev1", "dispatched", null, "2026-01-02T00:00:00Z"), targetSessionId: "s_idle" },
			{ ...item("v_rev2", "dispatched", null, "2026-01-06T00:00:00Z"), targetSessionId: "s_idle" },
			item("f_done", "done", null, "2026-01-01T00:00:00Z"),
			item("f_closed", "closed", null, "2026-01-07T00:00:00Z"),
		];

		const buckets = partitionByPhase(testItems, sessionMap);
		expect(buckets.pending.map((i) => i.id)).toEqual(["p_legacy", "p_new", "p_old"]);
		expect(buckets.running.map((i) => i.id)).toEqual(["r_run2", "r_run1"]);
		expect(buckets.review.map((i) => i.id)).toEqual(["v_rev2", "v_rev1"]);
		expect(buckets.finished.map((i) => i.id)).toEqual(["f_closed", "f_done"]);
	});
});

describe("needsAttentionCount", () => {
	it("counts pending and review items, ignoring running and finished", () => {
		const sessionMap: Record<string, SessionMeta> = {
			s_work: sessionMeta({ id: "s_work", status: "working" }),
			s_idle: sessionMeta({ id: "s_idle", status: "idle" }),
		};
		const testItems: BacklogItem[] = [
			item("p1", "inbox", null, "2026-01-01T00:00:00Z"),
			item("p2", "inbox", null, "2026-01-02T00:00:00Z"),
			{ ...item("run", "dispatched", null, "2026-01-03T00:00:00Z"), targetSessionId: "s_work" },
			{ ...item("rev1", "dispatched", null, "2026-01-04T00:00:00Z"), targetSessionId: "s_idle" },
			{ ...item("rev2", "dispatched", null, "2026-01-05T00:00:00Z"), targetSessionId: null },
			item("fin1", "done", null, "2026-01-06T00:00:00Z"),
			item("fin2", "closed", null, "2026-01-07T00:00:00Z"),
		];
		expect(needsAttentionCount(testItems, sessionMap)).toBe(4);
	});
});

describe("rangeSelection", () => {
	const ids = ["a", "b", "c", "d", "e"];

	it("selects forward range inclusively following list order", () => {
		expect(rangeSelection(ids, "b", "d")).toEqual(["b", "c", "d"]);
	});

	it("selects backward range inclusively following list order", () => {
		expect(rangeSelection(ids, "d", "b")).toEqual(["b", "c", "d"]);
	});

	it("returns only target when anchor is null", () => {
		expect(rangeSelection(ids, null, "c")).toEqual(["c"]);
	});

	it("returns only target when anchor is unknown or not in list", () => {
		expect(rangeSelection(ids, "nonexistent", "c")).toEqual(["c"]);
	});

	it("returns empty array when target is unknown or not in list", () => {
		expect(rangeSelection(ids, "b", "nonexistent")).toEqual([]);
		expect(rangeSelection(ids, null, "nonexistent")).toEqual([]);
	});
});

describe("splitByProject", () => {
	it("groups by projectRoot preserving group order of first appearance and item order inside", () => {
		const testItems: BacklogItem[] = [
			item("g1", "inbox", null, "2026-01-01T00:00:00Z"),
			item("p1_a", "inbox", "/repo-a", "2026-01-02T00:00:00Z"),
			item("p2_a", "inbox", "/repo-b", "2026-01-03T00:00:00Z"),
			item("p1_b", "inbox", "/repo-a/.worktrees/wt1", "2026-01-04T00:00:00Z"),
			item("g2", "inbox", null, "2026-01-05T00:00:00Z"),
			item("p2_b", "inbox", "/repo-b", "2026-01-06T00:00:00Z"),
		];

		const split = splitByProject(testItems);
		expect(split.map((grp) => grp.map((i) => i.id))).toEqual([
			["g1", "g2"],
			["p1_a", "p1_b"],
			["p2_a", "p2_b"],
		]);
	});

	it("handles null-project group correctly", () => {
		const nullItems = [
			item("g1", "inbox", null, "2026-01-01T00:00:00Z"),
			item("g2", "inbox", null, "2026-01-02T00:00:00Z"),
		];
		expect(splitByProject(nullItems).map((grp) => grp.map((i) => i.id))).toEqual([
			["g1", "g2"],
		]);
	});

	it("returns empty array for empty items", () => {
		expect(splitByProject([])).toEqual([]);
	});
});

describe("splitSent", () => {
	const rows = [
		item("a", "inbox", "/p/a", "2026-01-01T00:00:00Z"),
		item("b", "inbox", "/p/b", "2026-01-02T00:00:00Z"),
		item("c", "inbox", "/p/a", "2026-01-03T00:00:00Z"),
	];
	it("keeps sent items out of later sends, whatever the grouping", () => {
		const { remaining, sent } = splitSent(rows, new Set(["a", "c"]));
		expect(remaining.map((i) => i.id)).toEqual(["b"]);
		expect(sent.map((i) => i.id)).toEqual(["a", "c"]);
		expect(splitByProject(remaining).map((g) => g.map((i) => i.id))).toEqual([["b"]]);
		expect(splitSent(rows, new Set()).remaining).toEqual(rows);
		expect(splitSent(rows, new Set(["a", "b", "c"])).remaining).toEqual([]);
	});
});

describe("filterIdeas", () => {
	it("a project root keeps only that project's items in order; null keeps all", () => {
		expect(filterIdeas(nonFinished, "/p/a").map((i) => i.id)).toEqual(["new-here", "old-here"]);
		expect(filterIdeas(nonFinished, "/p/b").map((i) => i.id)).toEqual(["new-other"]);
		expect(filterIdeas(nonFinished, "/p/none")).toEqual([]);
		expect(filterIdeas(nonFinished, null)).toBe(nonFinished);
	});
});

describe("scopeOptions / effectiveScope", () => {
	it("lists projects with non-trashed ideas, current first, without the global group", () => {
		const opts = scopeOptions(nonFinished, "/p/b");
		expect(opts.map((o) => [o.root, o.label, o.isCurrent])).toEqual([
			["/p/b", "b", true],
			["/p/a", "a", false],
		]);
	});
	it("ignores trashed items and falls back to all when the project has no items left", () => {
		const rows = [
			item("x", "inbox", "/p/x", "2026-01-01T00:00:00Z"),
			{ ...item("y", "inbox", "/p/y", "2026-01-02T00:00:00Z"), deletedAt: "2026-01-03T00:00:00Z" },
		];
		const opts = scopeOptions(rows, null);
		expect(opts.map((o) => o.root)).toEqual(["/p/x"]);
		expect(effectiveScope("/p/x", opts)).toBe("/p/x");
		expect(effectiveScope("/p/y", opts)).toBeNull();
		expect(effectiveScope(null, opts)).toBeNull();
	});
});

describe("groupIdeasByProject", () => {
	it("puts current project first, global last, items newest first", () => {
		const groups = groupIdeasByProject(nonFinished, "/p/a");
		expect(groups.map((g) => [g.project, g.label, g.isCurrent, g.items.map((i) => i.id)])).toEqual([
			["/p/a", "a", true, ["new-here", "old-here"]],
			["/p/b", "b", false, ["new-other"]],
			[null, "未关联项目", false, ["global"]],
		]);
	});
	it("orders non-current projects by their newest item", () => {
		const groups = groupIdeasByProject(
			[item("x", "inbox", "/p/x", "2026-01-01T00:00:00Z"), item("y", "inbox", "/p/y", "2026-01-09T00:00:00Z")],
			null,
		);
		expect(groups.map((g) => g.project)).toEqual(["/p/y", "/p/x"]);
	});

	it("merges worktrees of one repo into the repo group, and current filter spans them", () => {
		const wt = [
			item("main", "inbox", "/p/r", "2026-01-01T00:00:00Z"),
			item("wt", "inbox", "/p/r/.worktrees/feat", "2026-01-02T00:00:00Z"),
		];
		const groups = groupIdeasByProject(wt, "/p/r/.worktrees/other");
		expect(groups.map((g) => [g.project, g.label, g.isCurrent, g.items.map((i) => i.id)])).toEqual([
			["/p/r", "r", true, ["wt", "main"]],
		]);
		expect(filterIdeas(wt, "/p/r").map((i) => i.id)).toEqual(["main", "wt"]);
	});
});

describe("ideaImages", () => {
	it("collects image refs and inline [图片: path] tags, deduped", () => {
		const it0 = {
			...item("i", "inbox", null, "2026-01-01T00:00:00Z"),
			text: "看这个 [图片: /tmp/a.png] 和 [图片: /tmp/b.png]",
			refs: [
				{ kind: "image", path: "/tmp/a.png", text: null, lines: null, sessionId: null },
				{ kind: "file", path: "/tmp/c.ts", text: null, lines: null, sessionId: null },
			],
		};
		expect(ideaImages(it0)).toEqual(["/tmp/a.png", "/tmp/b.png"]);
	});
});

describe("appendToDraft", () => {
	it("appends on a new line and never overwrites existing input", () => {
		expect(appendToDraft("", "idea")).toBe("idea");
		expect(appendToDraft("   \n", "idea")).toBe("idea");
		expect(appendToDraft("draft  \n", "idea")).toBe("draft\nidea");
	});
});

describe("buildBatchFillText", () => {
	it("adds the header, numbers items and tags each with its type", () => {
		const text = buildBatchFillText([
			{ kind: "bug", body: "崩溃 🖼️#1" },
			{ kind: "idea", body: "加测试\n第二行" },
			{ kind: "idea", body: "做个 🖼️#2 并参考 🖼️#1" },
		]);
		expect(text).toBe(
			"以下是 3 个待处理问题（缺陷/想法），请逐条处理：\n\n" +
				"1. 【缺陷】崩溃 🖼️#1\n2. 【想法】加测试\n   第二行\n3. 【想法】做个 🖼️#2 并参考 🖼️#1",
		);
	});
});

describe("formatAddedTime", () => {
	const now = new Date(2026, 9, 3, 14, 30);
	it("minute precision: today HH:mm, this year MM-DD HH:mm, older YYYY-MM-DD HH:mm", () => {
		expect(formatAddedTime(new Date(2026, 9, 3, 14, 29, 40).toISOString(), now)).toBe("14:29");
		expect(formatAddedTime(new Date(2026, 9, 3, 1, 5).toISOString(), now)).toBe("01:05");
		expect(formatAddedTime(new Date(2026, 9, 2, 23, 59).toISOString(), now)).toBe("10-02 23:59");
		expect(formatAddedTime(new Date(2026, 8, 1, 9, 5).toISOString(), now)).toBe("09-01 09:05");
		expect(formatAddedTime(new Date(2025, 11, 31, 8, 0).toISOString(), now)).toBe("2025-12-31 08:00");
		expect(formatAddedTime("bogus", now)).toBe("");
	});
});

describe("trashDaysLeft", () => {
	const now = new Date("2026-01-10T00:00:00Z");
	const trashed = (deletedAt: string) => ({ ...item("t", "inbox", null, "2026-01-01T00:00:00Z"), deletedAt });
	it("counts down from 7 days and never drops below 1", () => {
		expect(trashDaysLeft(trashed("2026-01-10T00:00:00Z"), now)).toBe(7);
		expect(trashDaysLeft(trashed("2026-01-07T12:00:00Z"), now)).toBe(5);
		expect(trashDaysLeft(trashed("2026-01-03T00:00:00Z"), now)).toBe(1);
		expect(trashDaysLeft(trashed("2025-12-01T00:00:00Z"), now)).toBe(1);
	});
});

describe("tab membership", () => {
	const sessionMap: Record<string, SessionMeta> = { s_work: sessionMeta({ id: "s_work", status: "working" }) };
	const all: BacklogItem[] = [
		item("inbox", "inbox", "/p/a", "2026-01-01T00:00:00Z"),
		{ ...item("run", "dispatched", "/p/a", "2026-01-02T00:00:00Z"), targetSessionId: "s_work" },
		item("rev", "dispatched", "/p/b", "2026-01-03T00:00:00Z"),
		item("done", "done", "/p/a", "2026-01-04T00:00:00Z"),
		item("closed", "closed", "/p/b", "2026-01-05T00:00:00Z"),
		{ ...item("t-inbox", "inbox", "/p/a", "2026-01-06T00:00:00Z"), deletedAt: "2026-01-08T00:00:00Z" },
		{ ...item("t-done", "done", "/p/a", "2026-01-07T00:00:00Z"), deletedAt: "2026-01-09T00:00:00Z" },
	];

	it("trashed items live only in the trash tab; 已结束 = done + closed", () => {
		const b = partitionByPhase(all, sessionMap);
		expect(b.pending.map((i) => i.id)).toEqual(["inbox"]);
		expect(b.running.map((i) => i.id)).toEqual(["run"]);
		expect(b.review.map((i) => i.id)).toEqual(["rev"]);
		expect(b.finished.map((i) => i.id)).toEqual(["closed", "done"]);
		expect(b.trash.map((i) => i.id)).toEqual(["t-done", "t-inbox"]);
	});

	it("badge count excludes trashed items", () => {
		expect(needsAttentionCount(all, sessionMap)).toBe(2);
	});
});

describe("searchIdeas", () => {
	const base = [
		{ ...item("a", "inbox", null, "2026-01-01T00:00:00Z"), text: "Fix Login crash", kind: "bug" as const },
		{ ...item("b", "inbox", null, "2026-01-02T00:00:00Z"), text: "login page idea", kind: "idea" as const },
		{ ...item("c", "inbox", null, "2026-01-03T00:00:00Z"), text: "other", kind: "idea" as const },
	];
	it("matches text case-insensitively and filters by kind", () => {
		expect(searchIdeas(base, EMPTY_SEARCH)).toBe(base);
		expect(searchIdeas(base, { query: "LOGIN", kinds: [] }).map((i) => i.id)).toEqual(["a", "b"]);
		expect(searchIdeas(base, { query: "login", kinds: ["idea"] }).map((i) => i.id)).toEqual(["b"]);
		expect(searchIdeas(base, { query: "", kinds: ["bug"] }).map((i) => i.id)).toEqual(["a"]);
	});
});

describe("tabCounts", () => {
	const sessionMap: Record<string, SessionMeta> = {};
	const rows: BacklogItem[] = [
		{ ...item("a1", "inbox", "/p/a", "2026-01-01T00:00:00Z"), text: "alpha" },
		{ ...item("a2", "done", "/p/a", "2026-01-02T00:00:00Z"), text: "alpha done" },
		{ ...item("b1", "inbox", "/p/b", "2026-01-03T00:00:00Z"), text: "alpha other" },
		{ ...item("b2", "closed", "/p/b", "2026-01-04T00:00:00Z"), text: "beta" },
		{ ...item("t1", "inbox", "/p/a", "2026-01-05T00:00:00Z"), text: "alpha gone", deletedAt: "2026-01-06T00:00:00Z" },
	];
	it("counts per tab within scope and search", () => {
		expect(tabCounts(rows, sessionMap, null, EMPTY_SEARCH)).toEqual({
			pending: 2,
			running: 0,
			review: 0,
			finished: 2,
			trash: 1,
		});
		expect(tabCounts(rows, sessionMap, "/p/a", EMPTY_SEARCH)).toMatchObject({
			pending: 1,
			finished: 1,
			trash: 1,
		});
		expect(tabCounts(rows, sessionMap, null, { query: "alpha", kinds: [] })).toMatchObject({
			pending: 2,
			finished: 1,
			trash: 1,
		});
		expect(tabCounts(rows, sessionMap, "/p/a", { query: "other", kinds: [] })).toMatchObject({
			pending: 0,
			finished: 0,
			trash: 0,
		});
	});
});

describe("capture project choice", () => {
	it("follows the current project by default, honours explicit pick and 'none'", () => {
		expect(resolveCaptureProject(null, "/p/a")).toBe("/p/a");
		expect(resolveCaptureProject(null, null)).toBeNull();
		expect(resolveCaptureProject("/p/b", "/p/a")).toBe("/p/b");
		expect(resolveCaptureProject(CAPTURE_PROJECT_NONE, "/p/a")).toBeNull();
	});

	it("lists real projects deduped by path, skipping the global workspace", () => {
		const ws = (id: string, path: string, name: string, kind: "project" | "global", mode: "code" | "chat") =>
			({ id, path, name, kind, sort: 0, mode }) as Workspace;
		const opts = captureProjectOptions([
			ws("1", "/p/b", "beta", "project", "code"),
			ws("2", "/p/a", "alpha", "project", "code"),
			ws("3", "/p/a", "alpha", "project", "chat"),
			ws("4", "/g", "global", "global", "chat"),
		]);
		expect(opts).toEqual([
			{ path: "/p/a", name: "alpha" },
			{ path: "/p/b", name: "beta" },
		]);
	});
});
