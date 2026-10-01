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
});
