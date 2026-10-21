import { describe, expect, it } from "vitest";
import {
	cwdToMemorySlug,
	defaultMemorySlug,
	describeMemoryFile,
	groupMemoryFiles,
	skillNameOf,
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

describe("groupMemoryFiles", () => {
	it("splits editable, skills and generated files and drops empty groups", () => {
		const groups = groupMemoryFiles([
			{ rel: "MEMORY.md", editable: true },
			{ rel: "raw_memories.md", editable: false },
			{ rel: "skills/s1/SKILL.md", editable: true },
			{ rel: "rollout_summaries/a.md", editable: false },
		]);
		expect(groups.map((g) => [g.id, g.files.length])).toEqual([
			["summary", 1],
			["skills", 1],
			["generated", 2],
		]);
		expect(groupMemoryFiles([{ rel: "MEMORY.md", editable: true }]).map((g) => g.id)).toEqual(["summary"]);
	});
});

describe("describeMemoryFile / skillNameOf", () => {
	it("names skills and rollout files", () => {
		expect(describeMemoryFile("skills/foo/SKILL.md").title).toBe("foo");
		expect(describeMemoryFile("rollout_summaries/x.md").title).toBe("x.md");
		expect(skillNameOf("skills/foo/SKILL.md")).toBe("foo");
		expect(skillNameOf("MEMORY.md")).toBeNull();
	});
});
