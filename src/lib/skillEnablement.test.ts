import { describe, expect, it } from "vitest";
import {
	DEFAULT_SKILL_CONFIG,
	EMPTY_PROJECT_LAYER,
	mergeSkillConfig,
	parseProjectSkillLayer,
	type SkillEnableConfig,
} from "./skillEnablement";

const global: SkillEnableConfig = {
	...DEFAULT_SKILL_CONFIG,
	ignored: ["g-*"],
	include: ["only-*"],
	disabledExtensions: ["skill:a", "ext-a"],
	sourceToggles: { "skills.enableClaudeUser": false, "skills.enablePiUser": true },
};

describe("parseProjectSkillLayer", () => {
	it("blank text and non-object roots give an empty layer", () => {
		expect(parseProjectSkillLayer("  \n")).toEqual(EMPTY_PROJECT_LAYER);
		expect(parseProjectSkillLayer("- a\n- b\n")).toEqual(EMPTY_PROJECT_LAYER);
	});

	it("reads nested skills.* keys and disabledExtensions", () => {
		const layer = parseProjectSkillLayer(
			[
				"disabledExtensions: [skill:x]",
				"skills:",
				"  enabled: false",
				"  ignoredSkills: [a, 3]",
				"  includeSkills: []",
				"  enableClaudeUser: true",
			].join("\n"),
		);
		expect(layer).toEqual({
			skillsEnabled: false,
			ignored: ["a"],
			include: [],
			disabledExtensions: ["skill:x"],
			sourceToggles: { "skills.enableClaudeUser": true },
		});
	});

	it("throws on invalid YAML", () => {
		expect(() => parseProjectSkillLayer("a: [unclosed")).toThrow();
	});
});

describe("mergeSkillConfig", () => {
	it("absent project keys inherit global and report no overrides", () => {
		const { config, overrides } = mergeSkillConfig(global, EMPTY_PROJECT_LAYER);
		expect(config).toEqual(global);
		expect(overrides).toEqual([]);
	});

	it("project arrays replace global arrays (even when empty)", () => {
		const { config, overrides } = mergeSkillConfig(global, {
			sourceToggles: {},
			disabledExtensions: [],
			ignored: ["p"],
			include: [],
		});
		expect(config.disabledExtensions).toEqual([]);
		expect(config.ignored).toEqual(["p"]);
		expect(config.include).toEqual([]);
		expect(overrides).toEqual([
			"skills.ignoredSkills",
			"skills.includeSkills",
			"disabledExtensions",
		]);
	});

	it("project scalars win and source toggles merge key-wise", () => {
		const { config, overrides } = mergeSkillConfig(global, {
			skillsEnabled: false,
			sourceToggles: { "skills.enableClaudeUser": true },
		});
		expect(config.skillsEnabled).toBe(false);
		expect(config.sourceToggles).toEqual({
			"skills.enableClaudeUser": true,
			"skills.enablePiUser": true,
		});
		expect(overrides).toEqual(["skills.enabled", "skills.enableClaudeUser"]);
		expect(global.sourceToggles["skills.enableClaudeUser"]).toBe(false);
	});
});

