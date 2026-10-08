import { describe, expect, it } from "vitest";
import type { SubagentSummary, TranscriptItem } from "../../lib/contracts";
import {
	analyzeMainDistribution,
	analyzeSubagentDistribution,
	distillSessionSkeleton,
	resolveModelLimit,
} from "./distribution";

function makeItem(partial: Partial<TranscriptItem>): TranscriptItem {
	return {
		id: "test-item",
		parentId: null,
		ts: "2026-10-08T10:00:00Z",
		kind: "assistant",
		text: null,
		thinking: null,
		toolCalls: [],
		toolResult: null,
		usage: null,
		model: null,
		stopReason: null,
		hidden: false,
		images: [],
		...partial,
	};
}

describe("heatmap distribution analyzer", () => {
	it("resolves model limits correctly", () => {
		expect(resolveModelLimit("claude-3-7-sonnet").limit).toBe(200_000);
		expect(resolveModelLimit("gpt-4o").limit).toBe(128_000);
		expect(resolveModelLimit("gemini-1.5-pro").limit).toBe(1_000_000);
		expect(resolveModelLimit("smol").limit).toBe(32_000);
	});

	it("detects repeated skill injections as waste", () => {
		const items: TranscriptItem[] = [
			makeItem({
				id: "item-1",
				toolCalls: [
					{
						id: "c1",
						name: "read",
						args: { path: "skill://ego-browser/SKILL.md" },
						intent: null,
					},
				],
			}),
			makeItem({
				id: "item-2",
				toolCalls: [
					{
						id: "c2",
						name: "read",
						args: { path: "skill://ego-browser/SKILL.md" },
						intent: null,
					},
				],
			}),
		];

		const res = analyzeMainDistribution(items, "claude-3-7-sonnet");
		expect(res.drilldown.skills.length).toBe(1);
		const skill = res.drilldown.skills[0];
		expect(skill.name).toBe("skill://ego-browser/SKILL.md");
		expect(skill.calls).toBe(2);
		expect(skill.status).toBe("waste");
		expect(skill.note).toContain("重复读取 2 次");

		const skillCategory = res.distribution.find((d) => d.key === "skills");
		expect(skillCategory?.hasWaste).toBe(true);
	});

	it("detects giant tool outputs as warning", () => {
		const items: TranscriptItem[] = [
			makeItem({
				id: "item-giant",
				toolCalls: [
					{
						id: "c-cargo",
						name: "bash",
						args: { command: "cargo test --workspace" },
						intent: null,
					},
				],
				toolResult: {
					toolCallId: "c-cargo",
					toolName: "bash",
					text: "x".repeat(40_000), // ~11k tokens
					isError: false,
					details: null,
				},
			}),
		];

		const res = analyzeMainDistribution(items, "claude-3-7-sonnet");
		const tool = res.drilldown.tools.find((t) => t.name.includes("cargo test"));
		expect(tool).toBeDefined();
		expect(tool?.status).toBe("warn");
		expect(tool?.note).toContain("单次输出过大");
	});

	it("flags consecutive tool errors as waste", () => {
		const items: TranscriptItem[] = [
			makeItem({
				id: "item-err-1",
				toolCalls: [
					{
						id: "c-build",
						name: "bash",
						args: { command: "pnpm build" },
						intent: null,
					},
				],
				toolResult: {
					toolCallId: "c-build",
					toolName: "bash",
					text: "Error: build failed",
					isError: true,
					details: null,
				},
			}),
		];

		const res = analyzeMainDistribution(items, "claude-3-7-sonnet");
		const tool = res.drilldown.tools.find((t) => t.name.includes("pnpm build"));
		expect(tool).toBeDefined();
		expect(tool?.status).toBe("waste");
		expect(tool?.note).toContain("工具报错重试");
	});

	it("analyzes subagent distribution properly", () => {
		const summary: SubagentSummary = {
			id: "scout-1",
			status: "completed",
			model: "claude-3-7-sonnet",
			prompt: "调研 Token 监控方案",
			thinkingLevel: null,
			messageCount: 8,
			toolCallCount: 6,
			requestCount: 4,
			tokens: 28400,
			cost: 0.11,
			startedAt: null,
			endedAt: null,
			outputPath: null,
			filePath: "/path/to/scout-1.jsonl",
		};

		const res = analyzeSubagentDistribution(summary);
		expect(res.name).toBe("scout-1");
		expect(res.totalTokens).toBe(28400);
		expect(res.distribution.some((d) => d.key === "tools")).toBe(true);
		expect(res.drilldown.tools[0].calls).toBe(6);
	});

	it("distills session skeleton accurately without dumping raw tokens", () => {
		const items: TranscriptItem[] = [
			makeItem({
				id: "user-1",
				kind: "user",
				text: "帮我修改右侧栏样式",
			}),
			makeItem({
				id: "a-1",
				kind: "assistant",
				toolCalls: [
					{
						id: "c-grep",
						name: "grep",
						args: { pattern: "heatmap" },
						intent: null,
					},
					{
						id: "c-edit",
						name: "edit",
						args: { path: "src/features/heatmap/HeatmapPanel.tsx" },
						intent: null,
					},
				],
			}),
		];

		const skeleton = distillSessionSkeleton(items, {
			id: "sess-1",
			title: "优化侧边栏",
			model: "claude-3-7-sonnet",
		});

		expect(skeleton.userGoals[0]).toContain("帮我修改右侧栏样式");
		expect(skeleton.filesTouched).toContain("HeatmapPanel.tsx");
		expect(skeleton.dehydratedPromptText).toContain("会话脱水诊断骨架");
		expect(skeleton.dehydratedPromptText).toContain("HeatmapPanel.tsx");
	});
});
