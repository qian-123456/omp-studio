import { describe, expect, it } from "vitest";
import { buildRuleEntries, buildRuleFileEntries, ruleBaseDir, ruleStatus, rulesDirPath } from "./rulesFiles";

describe("buildRuleEntries", () => {
	it("global scope lists AGENTS/RULES/APPEND_SYSTEM under ~/.omp/agent", () => {
		const e = buildRuleEntries("global", "/Users/q/", null);
		expect(e.map((x) => x.path)).toEqual([
			"/Users/q/.omp/agent/AGENTS.md",
			"/Users/q/.omp/agent/RULES.md",
			"/Users/q/.omp/agent/APPEND_SYSTEM.md",
		]);
	});

	it("project scope: AGENTS root + native, RULES only under .omp", () => {
		const e = buildRuleEntries("project", "/Users/q", "/r/p/");
		expect(e.map((x) => x.path)).toEqual([
			"/r/p/AGENTS.md",
			"/r/p/.omp/AGENTS.md",
			"/r/p/.omp/RULES.md",
			"/r/p/.omp/APPEND_SYSTEM.md",
		]);
		expect(e.some((x) => x.path === "/r/p/RULES.md")).toBe(false);
	});

	it("never offers SYSTEM.md, prompts or commands", () => {
		for (const scope of ["global", "project"] as const) {
			const paths = buildRuleEntries(scope, "/h", "/p").map((x) => x.path);
			expect(paths.some((p) => /SYSTEM\.md$|SYSTEM_TEMPLATE|prompts|commands/.test(p.replace("APPEND_SYSTEM.md", "")))).toBe(false);
		}
	});

	it("returns nothing without a base directory", () => {
		expect(buildRuleEntries("project", "/h", null)).toEqual([]);
		expect(buildRuleEntries("global", null, "/p")).toEqual([]);
		expect(ruleBaseDir("project", "/h", null)).toBeNull();
		expect(rulesDirPath("project", "/h", "/p")).toBe("/p/.omp/rules");
	});
});

describe("buildRuleFileEntries", () => {
	it("keeps only .md/.mdc, sorted, skipping dotfiles", () => {
		const e = buildRuleFileEntries("/p/.omp/rules/", ["b.md", ".x.md", "a.mdc", "c.txt"]);
		expect(e.map((x) => x.path)).toEqual(["/p/.omp/rules/a.mdc", "/p/.omp/rules/b.md"]);
		expect(e[0].label).toBe("rules/a.mdc");
	});
});

describe("ruleStatus", () => {
	const [root, native] = buildRuleEntries("project", "/h", "/p");
	it("distinguishes missing, loading and existing", () => {
		expect(ruleStatus(root, {}).label).toBe("读取中");
		expect(ruleStatus(root, { [root.path]: null }).label).toBe("未创建");
		expect(ruleStatus(root, { [root.path]: "x" })).toMatchObject({ exists: true, label: "已存在", note: null });
	});
	it("flags a root AGENTS.md shadowed by a non-empty .omp/AGENTS.md", () => {
		const s = ruleStatus(root, { [root.path]: "x", [native.path]: "y" });
		expect(s.note).toContain("覆盖");
		expect(ruleStatus(root, { [root.path]: "x", [native.path]: "  " }).note).toBeNull();
	});
	it("warns on empty content", () => {
		expect(ruleStatus(root, { [root.path]: "" }).note).toContain("为空");
	});
});
