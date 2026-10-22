import { describe, expect, it } from "vitest";
import type { SkillItem } from "../../../lib/contracts";
import { DEFAULT_SKILL_CONFIG } from "../../../lib/skillEnablement";
import { skillCommandsFromCatalog } from "./skillCatalog";

const skill = (name: string): SkillItem => ({
	name,
	description: "",
	source: "user",
	path: `/s/${name}/SKILL.md`,
	dir: `/s/${name}`,
	root: "~/.omp/agent/skills",
	provider: "native",
	copies: 1,
	issues: [],
	promptChars: 1,
});

describe("skillCommandsFromCatalog", () => {
	it("dedupes by name", () => {
		const out = skillCommandsFromCatalog([skill("a"), skill("a")]);
		expect(out.map((c) => c.name)).toEqual(["skill:a"]);
	});

	it("drops skills disabled by config", () => {
		const cfg = { ...DEFAULT_SKILL_CONFIG, disabledExtensions: ["skill:off"], ignored: ["x-*"] };
		const out = skillCommandsFromCatalog([skill("on"), skill("off"), skill("x-1")], cfg);
		expect(out.map((c) => c.name)).toEqual(["skill:on"]);
	});
});
