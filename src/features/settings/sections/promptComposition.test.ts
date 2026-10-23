import { describe, expect, it } from "vitest";
import type { PromptComposition, Workspace } from "../../../lib/contracts";
import { buildOptimizePrompt, pickInitialCwd, projectOptions, ruleFilePaths } from "./promptComposition";

const ws = (over: Partial<Workspace>): Workspace => ({
	id: "w",
	path: "/p",
	name: "p",
	kind: "project",
	sort: 0,
	mode: "code",
	...over,
});

const WORKSPACES: Workspace[] = [
	ws({ id: "b", path: "/b", name: "Bravo", sort: 2 }),
	ws({ id: "a", path: "/a", name: "Alpha", sort: 1 }),
	ws({ id: "global", path: "/g", name: "global", kind: "global", mode: "chat" }),
	ws({ id: "a-work", path: "/a", name: "Alpha", sort: 1, mode: "work" }),
];

describe("projectOptions", () => {
	it("puts Universal first, sorts projects and collapses duplicate paths", () => {
		const opts = projectOptions(WORKSPACES);
		expect(opts.map((o) => o.path)).toEqual(["/g", "/a", "/b"]);
		expect(opts[0].universal).toBe(true);
	});

	it("adds an unregistered session cwd as an extra option", () => {
		const opts = projectOptions(WORKSPACES, "/wt/x");
		expect(opts[opts.length - 1]).toMatchObject({ path: "/wt/x", workspaceId: null });
	});
});

describe("pickInitialCwd", () => {
	const opts = projectOptions(WORKSPACES);
	it("prefers the request, then the last used, then Universal", () => {
		expect(pickInitialCwd(opts, "/b", "/a")).toBe("/b");
		expect(pickInitialCwd(opts, null, "/a")).toBe("/a");
		expect(pickInitialCwd(opts, "/gone", "/gone")).toBe("/g");
	});
});

describe("buildOptimizePrompt", () => {
	const comp: PromptComposition = {
		cwd: "/a",
		totalTokens: 1000,
		reportedTokens: 1200,
		contextWindow: 100000,
		probeMs: 10,
		estimateNote: "估算",
		categories: [
			{
				id: "rules",
				label: "规则文件",
				tokens: 600,
				items: [{ id: "rule:1", title: "/a/AGENTS.md", detail: null, text: "x", tokens: 600 }],
			},
			{ id: "mcp", label: "MCP 工具", tokens: 0, items: [] },
		],
		hints: [
			{ id: "h", kind: "rules_total", severity: "warn", title: "规则文件占了 60%", detail: "d", itemIds: ["rule:1"], quote: null },
		],
	};

	it("carries the summary, rule paths and the consent rule", () => {
		const prompt = buildOptimizePrompt(comp, "Alpha");
		expect(ruleFilePaths(comp)).toEqual(["/a/AGENTS.md"]);
		expect(prompt).toContain("- /a/AGENTS.md");
		expect(prompt).toContain("规则文件：约 600 tokens（60%）");
		expect(prompt).not.toContain("MCP 工具：");
		expect(prompt).toContain("规则文件占了 60%");
		expect(prompt).toContain("在我明确同意之前，不要修改、移动或删除任何文件");
	});
});
