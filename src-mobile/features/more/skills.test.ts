import { describe, expect, it } from "vitest";
import { filterSkills, reasonText, stripFrontmatter } from "./skills";
import type { Skill } from "./skills";

const sk = (name: string, description: string): Skill => ({
	name,
	description,
	source: "user",
	provider: "claude",
	path: `/s/${name}`,
	dir: "",
	root: "",
	copies: 1,
	issues: [],
	promptChars: 0,
	enabled: true,
	disabledReason: null,
});

describe("skills", () => {
	it("requires every term to match", () => {
		const list = [sk("deploy", "ship to cloudflare"), sk("review", "code review")];
		expect(filterSkills(list, "cloud ship").map((s) => s.name)).toEqual(["deploy"]);
		expect(filterSkills(list, "")).toHaveLength(2);
		expect(filterSkills(list, "deploy review")).toEqual([]);
	});
	it("explains disabled reasons", () => {
		expect(reasonText({ kind: "ignored", pattern: "x*" })).toBe("被忽略规则匹配（x*）");
		expect(reasonText(null)).toBe("");
	});
	it("strips frontmatter only at the start", () => {
		expect(stripFrontmatter("---\nname: a\n---\n# Body\n---\nx")).toBe("# Body\n---\nx");
		expect(stripFrontmatter("# no fm")).toBe("# no fm");
	});
});
