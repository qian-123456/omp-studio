import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
	agentsDirPath,
	buildAgentEntries,
	buildAgentFile,
	checkNewAgentName,
	extractFrontmatterSummary,
	isValidAgentName,
	orderPickedTools,
	resolveAgentLayer,
} from "./agentDefs";

function frontmatter(file: string): Record<string, unknown> {
	const m = file.match(/^---\n([\s\S]*?)\n---\n/);
	if (!m) throw new Error("no frontmatter");
	return parse(m[1] ?? "") as Record<string, unknown>;
}

describe("buildAgentFile", () => {
	it("keeps YAML-special text in the description and model intact", () => {
		const file = buildAgentFile({
			name: "docs-writer",
			description: 'Docs: update "public" API docs # after changes',
			prompt: "  Write docs.\n",
			tools: ["read", "edit"],
			model: "openai/gpt-5.5:high",
		});
		expect(frontmatter(file)).toEqual({
			name: "docs-writer",
			description: 'Docs: update "public" API docs # after changes',
			tools: ["read", "edit"],
			model: "openai/gpt-5.5:high",
		});
		expect(file.endsWith("---\n\nWrite docs.\n")).toBe(true);
	});

	it("omits tools and model to get omp's default toolset and the parent's model", () => {
		const fm = frontmatter(buildAgentFile({ name: "a", description: "d", prompt: "p", tools: null, model: null }));
		expect(fm).toEqual({ name: "a", description: "d" });
	});

	it("writes an empty tool list as no built-in tools, not as the default set", () => {
		expect(frontmatter(buildAgentFile({ name: "a", description: "d", prompt: "p", tools: [], model: "@smol" }))).toEqual({
			name: "a",
			description: "d",
			tools: [],
			model: "@smol",
		});
	});
});

describe("checkNewAgentName", () => {
	it("refuses omp's reserved names in any case and names already listed", () => {
		expect(checkNewAgentName(" Main ", new Set()).ok).toBe(false);
		expect(checkNewAgentName("sub", new Set()).ok).toBe(false);
		expect(checkNewAgentName("scout", new Set(["scout"]))).toEqual({
			ok: false,
			error: "已有子代理「scout」，请在下方列表里直接修改它",
		});
		expect(checkNewAgentName("docs.writer", new Set()).ok).toBe(false);
		expect(checkNewAgentName(" docs-writer ", new Set(["scout"]))).toEqual({ ok: true, name: "docs-writer" });
	});
});

describe("orderPickedTools", () => {
	it("writes picked tools in catalog order, not click order", () => {
		expect(orderPickedTools(new Set(["bash", "read", "edit"]))).toEqual(["read", "edit", "bash"]);
	});
});

describe("agentDefs", () => {
	describe("agentsDirPath", () => {
		it("resolves global agents directory", () => {
			expect(agentsDirPath("global", "/Users/me", null)).toBe("/Users/me/.omp/agent/agents");
		});

		it("resolves project agents directory", () => {
			expect(agentsDirPath("project", "/Users/me", "/repo/foo")).toBe("/repo/foo/.omp/agents");
		});

		it("returns null if path missing", () => {
			expect(agentsDirPath("global", null, null)).toBeNull();
			expect(agentsDirPath("project", "/Users/me", null)).toBeNull();
		});
	});

	describe("isValidAgentName", () => {
		it("validates agent filenames", () => {
			expect(isValidAgentName("scout")).toBe(true);
			expect(isValidAgentName("my-agent_v2")).toBe(true);
			expect(isValidAgentName(".hidden")).toBe(false);
			expect(isValidAgentName("../evil")).toBe(false);
			expect(isValidAgentName("agent/sub")).toBe(false);
		});
	});

	describe("buildAgentEntries", () => {
		it("lists all built-in agents and attaches any extra custom files", () => {
			const dir = "/Users/me/.omp/agent/agents";
			const diskNames = ["scout.md", "custom-helper.md", "ignored.txt", ".dotfile.md"];
			const entries = buildAgentEntries(dir, diskNames);

			const scout = entries.find((e) => e.name === "scout");
			expect(scout).toBeDefined();
			expect(scout?.isBuiltin).toBe(true);
			expect(scout?.path).toBe(`${dir}/scout.md`);

			const task = entries.find((e) => e.name === "task");
			expect(task).toBeDefined();
			expect(task?.isBuiltin).toBe(true);

			const custom = entries.find((e) => e.name === "custom-helper");
			expect(custom).toBeDefined();
			expect(custom?.isBuiltin).toBe(false);
			expect(custom?.label).toBe("custom-helper.md");

			// Non-md or dotfiles excluded
			expect(entries.find((e) => e.name === "ignored")).toBeUndefined();
			expect(entries.find((e) => e.name === ".dotfile")).toBeUndefined();
		});
	});

	describe("resolveAgentLayer", () => {
		const base = { isBuiltin: true, scope: "global" as const, inGlobal: false, inProject: false, hasProject: true };

		it("falls back to the built-in definition when no file exists", () => {
			expect(resolveAgentLayer(base)).toEqual({ active: "builtin", hereExists: false, shadowedBy: null });
		});

		it("prefers project over global over built-in", () => {
			expect(resolveAgentLayer({ ...base, inGlobal: true }).active).toBe("global");
			expect(resolveAgentLayer({ ...base, inGlobal: true, inProject: true }).active).toBe("project");
		});

		it("flags a global file shadowed by the project file", () => {
			const r = resolveAgentLayer({ ...base, inGlobal: true, inProject: true });
			expect(r.hereExists).toBe(true);
			expect(r.shadowedBy).toBe("project");
			expect(resolveAgentLayer({ ...base, scope: "project", inGlobal: true, inProject: true }).shadowedBy).toBeNull();
		});

		it("ignores project files when no project is selected", () => {
			const r = resolveAgentLayer({ ...base, inGlobal: true, inProject: true, hasProject: false });
			expect(r.active).toBe("global");
			expect(r.shadowedBy).toBeNull();
		});

		it("has no active definition for a custom agent without files", () => {
			expect(resolveAgentLayer({ ...base, isBuiltin: false }).active).toBeNull();
		});
	});

	describe("extractFrontmatterSummary", () => {
		it("extracts description, model, thinkingLevel from frontmatter", () => {
			const text = `---
name: scout
description: "Code searcher"
tools:
  - find
model:
  - "@scout"
thinkingLevel: low
---

Prompt body here.
`;
			const res = extractFrontmatterSummary(text);
			expect(res.description).toBe("Code searcher");
			expect(res.model).toBe("@scout");
			expect(res.thinkingLevel).toBe("low");
		});

		it("returns empty object when no frontmatter", () => {
			expect(extractFrontmatterSummary("Just plain prompt")).toEqual({});
		});
	});
});
