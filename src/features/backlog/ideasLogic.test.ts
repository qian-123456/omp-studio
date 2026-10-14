import { describe, expect, it } from "vitest";
import type { BacklogItem, BacklogStatus, SessionMeta } from "../../lib/contracts";
import {
	appendToDraft,
	filterIdeas,
	formatAddedTime,
	groupIdeasByProject,
	ideaImages,
	partitionIdeas,
	sessionOptionLabel,
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
	kind: "todo",
	refs: [],
	status,
	targetSessionId: null,
	projectDir,
	createdAt,
	updatedAt,
});

const items = [
	item("old-here", "inbox", "/p/a", "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"),
	item("new-other", "dispatched", "/p/b", "2026-01-03T00:00:00Z"),
	item("new-here", "dispatched", "/p/a", "2026-01-02T00:00:00Z"),
	item("global", "inbox", null, "2026-01-04T00:00:00Z"),
	item("done", "done", "/p/a", "2026-01-05T00:00:00Z"),
	item("closed", "closed", null, "2026-01-06T00:00:00Z"),
];

describe("partitionIdeas", () => {
	it("orders active strictly by createdAt desc, ignoring later updates and project", () => {
		const { active } = partitionIdeas(items);
		expect(active.map((i) => i.id)).toEqual(["global", "new-other", "new-here", "old-here"]);
	});

	it("falls back to updatedAt when createdAt is missing", () => {
		const legacy = { ...item("legacy", "inbox", null, ""), updatedAt: "2026-01-10T00:00:00Z" };
		expect(partitionIdeas([...items, legacy]).active[0].id).toBe("legacy");
	});

	it("moves done and closed items to finished, newest first", () => {
		expect(partitionIdeas(items).finished.map((i) => i.id)).toEqual(["closed", "done"]);
	});
});

describe("filterIdeas", () => {
	const { active } = partitionIdeas(items);
	it("current keeps only the current project's items in order; nothing without a project", () => {
		expect(filterIdeas(active, "current", "/p/a").map((i) => i.id)).toEqual(["new-here", "old-here"]);
		expect(filterIdeas(active, "current", null)).toEqual([]);
		expect(filterIdeas(active, "all", null)).toBe(active);
	});
});

describe("groupIdeasByProject", () => {
	it("puts current project first, global last, items newest first", () => {
		const groups = groupIdeasByProject(partitionIdeas(items).active, "/p/a");
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
		expect(filterIdeas(wt, "current", "/p/r").map((i) => i.id)).toEqual(["main", "wt"]);
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

describe("formatAddedTime", () => {
	const now = new Date(2026, 9, 3, 14, 30);
	it("uses relative time within a day, else MM-DD HH:mm", () => {
		expect(formatAddedTime(new Date(2026, 9, 3, 14, 29, 40).toISOString(), now)).toBe("刚刚");
		expect(formatAddedTime(new Date(2026, 9, 3, 14, 20).toISOString(), now)).toBe("10分钟前");
		expect(formatAddedTime(new Date(2026, 9, 3, 11, 0).toISOString(), now)).toBe("3小时前");
		expect(formatAddedTime(new Date(2026, 8, 1, 9, 5).toISOString(), now)).toBe("09-01 09:05");
		expect(formatAddedTime("bogus", now)).toBe("");
	});
});
