import { describe, expect, it } from "vitest";
import type { SlashCommand } from "../../../stores/live";
import { buildSlashSections, flattenSections } from "./menu";

const dynamic = (
	name: string,
	source: string,
	extra: Partial<SlashCommand> = {},
): SlashCommand => ({ name, source, ...extra });

describe("slash menu — buildSlashSections", () => {
	it("registry commands come grouped in their fixed order", () => {
		const sections = buildSlashSections("", [], false);
		expect(sections.map((s) => s.label)).toEqual([
			"会话",
			"模型",
			"状态",
			"集成",
			"设置",
			"技能",
			"更多 OMP 命令",
		]);
		expect(flattenSections(sections).map((i) => i.name)).toContain("fork");
	});

	it("dynamic omp commands fill 技能/自定义命令/扩展/更多 groups", () => {
		const sections = buildSlashSections(
			"",
			[
				dynamic("translator", "file"),
				dynamic("skill-x", "skill"),
				dynamic("ext-cmd", "extension"),
				dynamic("security", "builtin"),
			],
			false,
		);
		const byLabel = Object.fromEntries(
			sections.map((s) => [s.label, s.items.map((i) => i.name)]),
		);
		expect(byLabel["自定义命令"]).toContain("translator");
		expect(byLabel["技能"]).toContain("skill-x");
		expect(byLabel["扩展"]).toContain("ext-cmd");
		expect(byLabel["更多 OMP 命令"]).toContain("security");
	});

	it("registry wins over a dynamic command of the same name or alias", () => {
		const sections = buildSlashSections(
			"",
			[
				dynamic("model", "builtin"),
				dynamic("models", "builtin"),
				dynamic("fork", "builtin"),
			],
			false,
		);
		const flat = flattenSections(sections);
		expect(flat.filter((i) => i.name === "model")).toHaveLength(1);
		expect(flat.find((i) => i.name === "model")?.registry).toBe(true);
		expect(flat.filter((i) => i.name === "models")).toHaveLength(0);
		expect(flat.filter((i) => i.name === "fork")).toHaveLength(1);
	});

	it("fuzzy matching hits name prefix, alias, title and description", () => {
		const flat = (q: string) =>
			flattenSections(buildSlashSections(q, [], false)).map((i) => i.name);
		expect(flat("comp")).toContain("compact");
		expect(flat("模型")).toContain("model"); // description contains 模型
		expect(flat("新会话")).toContain("new"); // title match
		expect(flat("zzzz")).toHaveLength(0);
	});

	it("requiresEmptyComposer commands hide when other text exists", () => {
		const withText = flattenSections(
			buildSlashSections("new", [], true),
		).map((i) => i.name);
		const empty = flattenSections(
			buildSlashSections("new", [], false),
		).map((i) => i.name);
		expect(empty).toContain("new");
		expect(withText).not.toContain("new");
	});

	it("dynamic input.hint surfaces as argHint", () => {
		const sections = buildSlashSections(
			"trans",
			[dynamic("translator", "file", { input: { hint: "<文本>" } })],
			false,
		);
		const item = flattenSections(sections).find((i) => i.name === "translator");
		expect(item?.argHint).toBe("<文本>");
		expect(item?.registry).toBe(false);
	});

	it("registers a Visualize entry that shadows omp's skill:visualize command", () => {
		const sections = buildSlashSections(
			"",
			[dynamic("skill:visualize", "skill")],
			false,
		);
		const flat = flattenSections(sections);
		const items = flat.filter((i) => i.name === "skill:visualize");
		expect(items).toHaveLength(1);
		expect(items[0].registry).toBe(true);
		expect(items[0].group).toBe("技能");
		expect(items[0].title).toBe("Visualize");
		expect(items[0].description).toBe("创建可视化和交互工具");
		expect(items[0].argHint).toBeTruthy();
		// `/visualize` alias resolves to the same registry entry.
		const alias = flattenSections(buildSlashSections("visualize", [], false));
		expect(alias[0]?.name).toBe("skill:visualize");
	});

	it("matches the newly registered GUI commands", () => {
		const names = (q: string) =>
			flattenSections(buildSlashSections(q, [], false)).map((i) => i.name);
		expect(names("plan")).toContain("plan");
		expect(names("goal")).toContain("goal");
		expect(names("btw")).toContain("btw");
		expect(names("resume")).toContain("resume");
		expect(names("slow")).toContain("slow");
		// /fork-style arg commands carry their hint through to the menu item
		const fork = flattenSections(buildSlashSections("fork", [], false)).find(
			(i) => i.name === "fork",
		);
		expect(fork?.argHint).toBeTruthy();
	});

	it("hides Visualize when the visualizeEnabled setting is off", () => {
		const names = (enabled?: boolean) =>
			flattenSections(
				buildSlashSections("", [], false, { visualizeEnabled: enabled }),
			).map((i) => i.name);
		expect(names()).toContain("skill:visualize");
		expect(names(true)).toContain("skill:visualize");
		expect(names(false)).not.toContain("skill:visualize");
		// alias doesn't resurrect a gated command
		const aliased = flattenSections(
			buildSlashSections("visualize", [], false, { visualizeEnabled: false }),
		);
		expect(aliased.find((i) => i.name === "skill:visualize")).toBeUndefined();
	});
});
