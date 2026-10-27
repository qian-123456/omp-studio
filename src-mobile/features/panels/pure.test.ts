import { describe, expect, it } from "vitest";
import { breadcrumbs, fenced, fmtSize, groupGitStatus, langFromPath, splitPath } from "./pure";
import type { GitFile } from "./pure";

describe("breadcrumbs", () => {
	it("keeps only segments inside the deepest containing root", () => {
		const c = breadcrumbs("/Users/a/proj/src/lib", ["/Users/a", "/Users/a/proj"]);
		expect(c.map((s) => s.name)).toEqual(["proj", "src", "lib"]);
		expect(c[2].path).toBe("/Users/a/proj/src/lib");
	});
	it("does not treat a sibling with a shared prefix as a root", () => {
		const c = breadcrumbs("/work/proj-evil/x", ["/work/proj"]);
		expect(c.map((s) => s.name)).toEqual(["work", "proj-evil", "x"]);
	});
	it("shows the root itself and handles the filesystem root", () => {
		expect(breadcrumbs("/a/b", ["/a/b"]).map((s) => s.name)).toEqual(["b"]);
		expect(breadcrumbs("/")).toEqual([]);
	});
});

describe("path helpers", () => {
	it("splits name and dir", () => {
		expect(splitPath("a/b/c.ts")).toEqual({ name: "c.ts", dir: "a/b" });
		expect(splitPath("c.ts")).toEqual({ name: "c.ts", dir: "" });
	});
	it("maps extensions to highlight languages", () => {
		expect(langFromPath("/x/App.tsx")).toBe("typescript");
		expect(langFromPath("/x/Cargo.toml")).toBe("ini");
		expect(langFromPath("/x/Makefile")).toBeUndefined();
		expect(langFromPath("/x/README.MD")).toBe("markdown");
	});
	it("formats sizes", () => {
		expect(fmtSize(900)).toBe("900 B");
		expect(fmtSize(2048)).toBe("2.0 KB");
		expect(fmtSize(3 * 1048576)).toBe("3.0 MB");
	});
});

describe("fenced", () => {
	it("uses a fence longer than any backtick run in the text", () => {
		const out = fenced("a ``` b\n````x", "md");
		expect(out.startsWith("`````md\n")).toBe(true);
		expect(out.endsWith("\n`````")).toBe(true);
	});
	it("defaults to three backticks", () => {
		expect(fenced("x")).toBe("```\nx\n```");
	});
});

describe("groupGitStatus", () => {
	const f = (path: string, status: string, staged: boolean, unstaged: boolean): GitFile => ({ path, status, staged, unstaged });
	it("puts a file edited after staging into both groups and untracked only in untracked", () => {
		const g = groupGitStatus([
			f("a", "M", true, true),
			f("b", "A", true, false),
			f("c", "M", false, true),
			f("d", "??", false, true),
		]);
		expect(g.staged.map((x) => x.path)).toEqual(["a", "b"]);
		expect(g.unstaged.map((x) => x.path)).toEqual(["a", "c"]);
		expect(g.untracked.map((x) => x.path)).toEqual(["d"]);
	});
	it("returns empty groups for a clean tree", () => {
		expect(groupGitStatus([])).toEqual({ staged: [], unstaged: [], untracked: [] });
	});
});
