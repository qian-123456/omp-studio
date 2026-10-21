import { describe, expect, it } from "vitest";
import {
	cwdToMemorySlug,
	defaultMemorySlug,
	describeMemoryFile,
	formatTextSize,
	memoryProjectLabel,
	parseSkillDescription,
	previewText,
	skillNameOf,
	splitMemoryFiles,
} from "./memoryFiles";

describe("cwdToMemorySlug", () => {
	it("matches omp's directory naming", () => {
		expect(cwdToMemorySlug("/Users/qianhairui/Documents/omp-workspace")).toBe(
			"--Users-qianhairui-Documents-omp-workspace--",
		);
		expect(cwdToMemorySlug("/Users/qianhairui/Documents/omp-workspace/.worktrees/bug-fix/")).toBe(
			"--Users-qianhairui-Documents-omp-workspace-.worktrees-bug-fix--",
		);
		expect(cwdToMemorySlug("/Users/q/Documents/Coding Wiki")).toBe("--Users-q-Documents-Coding Wiki--");
	});
});

describe("defaultMemorySlug", () => {
	const projects = ["--a--", "--Users-q-p--"];
	it("prefers the session project", () => {
		expect(defaultMemorySlug(projects, "/Users/q/p")).toBe("--Users-q-p--");
	});
	it("falls back to the first project, or null", () => {
		expect(defaultMemorySlug(projects, "/other")).toBe("--a--");
		expect(defaultMemorySlug(projects, null)).toBe("--a--");
		expect(defaultMemorySlug([], "/x")).toBeNull();
	});
});

describe("splitMemoryFiles", () => {
	it("orders notes, collects skills and counts read-only files", () => {
		const s = splitMemoryFiles([
			{ rel: "MEMORY.md", editable: true },
			{ rel: "raw_memories.md", editable: false },
			{ rel: "memory_summary.md", editable: true },
			{ rel: "skills/s1/SKILL.md", editable: true },
			{ rel: "rollout_summaries/a.md", editable: false },
		]);
		expect(s.notes.map((f) => f.rel)).toEqual(["memory_summary.md", "MEMORY.md"]);
		expect(s.skills.map((f) => f.rel)).toEqual(["skills/s1/SKILL.md"]);
		expect(s.generatedCount).toBe(2);
	});
});

describe("describeMemoryFile / skillNameOf", () => {
	it("gives role notes and skill names", () => {
		expect(describeMemoryFile("memory_summary.md").role).toBe("每次新会话都会注入");
		expect(describeMemoryFile("MEMORY.md").role).toBe("完整记忆，agent 按需查阅");
		expect(describeMemoryFile("skills/foo/SKILL.md").title).toBe("foo");
		expect(skillNameOf("skills/foo/SKILL.md")).toBe("foo");
		expect(skillNameOf("MEMORY.md")).toBeNull();
	});
});

describe("memoryProjectLabel", () => {
	const home = "/Users/q";
	it("detects the global project", () => {
		expect(memoryProjectLabel("--Users-q-.omp-workspace-global--", home)).toEqual({ label: "全局（无项目）", exact: true });
	});
	it("matches known paths exactly, including ancestors", () => {
		const cwd = "/Users/q/Documents/omp-workspace/.worktrees/bug-fix";
		expect(memoryProjectLabel(cwdToMemorySlug(cwd), home, [cwd])).toEqual({
			label: "~/Documents/omp-workspace/.worktrees/bug-fix",
			exact: true,
		});
		expect(memoryProjectLabel("--Users-q-Documents-omp-workspace--", home, [cwd]).label).toBe(
			"~/Documents/omp-workspace",
		);
	});
	it("falls back to the part below home, flagged inexact", () => {
		expect(memoryProjectLabel("--Users-q-Documents-x-y--", home)).toEqual({ label: "~/Documents-x-y", exact: false });
		expect(memoryProjectLabel("--opt-foo--", home)).toEqual({ label: "opt-foo", exact: false });
		expect(memoryProjectLabel("--Users-q--", home)).toEqual({ label: "~", exact: true });
	});
});

describe("parseSkillDescription", () => {
	it("reads plain, quoted and block descriptions", () => {
		expect(parseSkillDescription("---\nname: a\ndescription: Does a thing\n---\nbody")).toBe("Does a thing");
		expect(parseSkillDescription('---\ndescription: "Quoted: yes"\n---')).toBe("Quoted: yes");
		expect(parseSkillDescription("---\ndescription: >\n  line one\n  line two\nname: a\n---")).toBe("line one line two");
	});
	it("returns null without frontmatter or description", () => {
		expect(parseSkillDescription("# no frontmatter")).toBeNull();
		expect(parseSkillDescription("---\nname: a\n---")).toBeNull();
	});
});

describe("previewText / formatTextSize", () => {
	it("cuts to the first lines and reports the rest", () => {
		expect(previewText("a\nb\nc\n", 5)).toEqual({ text: "a\nb\nc", hiddenLines: 0 });
		expect(previewText("1\n2\n3\n4", 2)).toEqual({ text: "1\n2", hiddenLines: 2 });
	});
	it("formats sizes", () => {
		expect(formatTextSize("abc")).toBe("3 B");
		expect(formatTextSize("x".repeat(2048))).toBe("2.0 KB");
	});
});
