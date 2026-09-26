import { describe, expect, it } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { basename, isInside, isMarkdown, joinPath, shortPath } from "../../lib/paths";
import { appendLog, defaultSlug, repoRootFromWorktree, runningInRepo, stripAnsi, toplevelFor } from "./helpers";

describe("isInside", () => {
	it("matches the dir itself and descendants only", () => {
		expect(isInside("/a/b", "/a/b")).toBe(true);
		expect(isInside("/a/b/c", "/a/b")).toBe(true);
		expect(isInside("/a/bc", "/a/b")).toBe(false);
		expect(isInside("/a", "/a/b")).toBe(false);
		expect(isInside("/a/b", "/a/b/")).toBe(true);
	});
});

describe("toplevelFor", () => {
	it("returns the deepest containing worktree, else cwd", () => {
		const wts = ["/r", "/r/.worktrees/x"];
		expect(toplevelFor("/r/src", wts)).toBe("/r");
		expect(toplevelFor("/r/.worktrees/x/pkg", wts)).toBe("/r/.worktrees/x");
		expect(toplevelFor("/other", wts)).toBe("/other");
	});
});

describe("joinPath / basename / isMarkdown / shortPath", () => {
	it("joins without duplicate slashes", () => {
		expect(joinPath("/r/", "/a.md")).toBe("/r/a.md");
		expect(joinPath("/r", "a.md")).toBe("/r/a.md");
	});
	it("basename strips trailing slashes", () => {
		expect(basename("/r/.worktrees/x/")).toBe("x");
	});
	it("detects markdown extensions", () => {
		expect(isMarkdown("a/b.md")).toBe(true);
		expect(isMarkdown("x.MDX")).toBe(true);
		expect(isMarkdown("x.ts")).toBe(false);
	});
	it("shortens home paths", () => {
		expect(shortPath("/home/u/p/f.md", "/home/u")).toBe("~/p/f.md");
		expect(shortPath("/etc/f", "/home/u")).toBe("/etc/f");
	});
});

describe("defaultSlug", () => {
	it("slugifies free text and falls back to a timestamp", () => {
		expect(defaultSlug("Fix the Login Bug!!")).toBe("fix-the-login-bug");
		expect(defaultSlug("中文 标题", new Date(2026, 0, 5, 9, 7))).toBe("s-0105-0907");
	});
});

describe("runningInRepo", () => {
	const meta = (partial: Partial<SessionMeta>): SessionMeta =>
		({
			id: "s",
			tool: "omp",
			file: "/f.jsonl",
			cwd: "/r",
			title: "",
			label: "#1",
			createdAt: "",
			updatedAt: "",
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
			...partial,
		}) as SessionMeta;

	it("counts live/working sessions whose repo contains cwd", () => {
		const list = [
			meta({ id: "a", cwd: "/r", live: true }),
			meta({ id: "b", cwd: "/r/.worktrees/x", status: "working", repoRoot: "/r" }),
			meta({ id: "c", cwd: "/r", status: "idle" }),
			meta({ id: "d", cwd: "/other", live: true }),
		];
		const ids = runningInRepo(list, "/r").map((s) => s.id);
		expect(ids).toEqual(["a", "b"]);
	});
});

describe("appendLog", () => {
	it("caps the buffer at max lines", () => {
		let lines: string[] = [];
		for (let i = 0; i < 305; i++) lines = appendLog(lines, `l${i}`, 300);
		expect(lines.length).toBe(300);
		expect(lines[0]).toBe("l5");
		expect(lines[299]).toBe("l304");
	});
});

describe("stripAnsi", () => {
	it("removes terminal color and control sequences", () => {
		const raw = "\x1b[32mready\x1b[0m in \x1b[1;33m512ms\x1b[0m";
		expect(stripAnsi(raw)).toBe("ready in 512ms");
	});
});

describe("repoRootFromWorktree", () => {
	it("extracts root directory before .worktrees", () => {
		expect(repoRootFromWorktree("/Users/dev/repo/.worktrees/feature-1")).toBe("/Users/dev/repo");
		expect(repoRootFromWorktree("C:\\dev\\repo\\.worktrees\\feature-1")).toBe("C:\\dev\\repo");
		expect(repoRootFromWorktree("/Users/dev/repo")).toBe("/Users/dev/repo");
	});
});
