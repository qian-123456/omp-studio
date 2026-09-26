import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { formatSessionMarkdown } from "./exportMarkdown";

describe("formatSessionMarkdown", () => {
	it("formats empty items with title", () => {
		const result = formatSessionMarkdown([], "测试会话");
		expect(result).toBe("# 测试会话");
	});

	it("formats user and assistant conversation", () => {
		const items: TranscriptItem[] = [
			{
				id: "1",
				parentId: null,
				ts: "2026-09-26T10:00:00Z",
				kind: "user",
				text: "你好，请帮我写一段代码",
				thinking: null,
				toolCalls: [],
				toolResult: null,
				usage: null,
				model: null,
				stopReason: null,
				hidden: false,
			},
			{
				id: "2",
				parentId: "1",
				ts: "2026-09-26T10:00:05Z",
				kind: "assistant",
				text: "没问题，这是给你的代码：\n```ts\nconst x = 1;\n```",
				thinking: "用户想要写一段代码，我们提供一段简单的 TypeScript 代码。",
				toolCalls: [],
				toolResult: null,
				usage: null,
				model: "gpt-4o",
				stopReason: "stop",
				hidden: false,
			},
		];

		const result = formatSessionMarkdown(items, "测试会话");
		expect(result).toContain("# 测试会话");
		expect(result).toContain("### User\n\n你好，请帮我写一段代码");
		expect(result).toContain("### Assistant");
		expect(result).toContain("> **思考过程**");
		expect(result).toContain("const x = 1;");
	});

	it("skips hidden items and handles tool calls", () => {
		const items: TranscriptItem[] = [
			{
				id: "1",
				parentId: null,
				ts: "2026-09-26T10:00:00Z",
				kind: "user",
				text: "隐秘消息",
				thinking: null,
				toolCalls: [],
				toolResult: null,
				usage: null,
				model: null,
				stopReason: null,
				hidden: true,
			},
			{
				id: "2",
				parentId: null,
				ts: "2026-09-26T10:00:05Z",
				kind: "assistant",
				text: "调用工具中",
				thinking: null,
				toolCalls: [
					{
						id: "c1",
						name: "read_file",
						args: { path: "package.json" },
						intent: "读取 package.json",
					},
				],
				toolResult: null,
				usage: null,
				model: null,
				stopReason: null,
				hidden: false,
			},
			{
				id: "3",
				parentId: "2",
				ts: "2026-09-26T10:00:06Z",
				kind: "tool_result",
				text: null,
				thinking: null,
				toolCalls: [],
				toolResult: {
					toolCallId: "c1",
					toolName: "read_file",
					text: '{\n  "name": "my-app"\n}',
					isError: false,
					details: null,
				},
				usage: null,
				model: null,
				stopReason: null,
				hidden: false,
			},
		];

		const result = formatSessionMarkdown(items);
		expect(result).not.toContain("隐秘消息");
		expect(result).toContain("### Assistant");
		expect(result).toContain("调用工具 `read_file`");
		expect(result).toContain("### Tool: read_file");
		expect(result).toContain('"name": "my-app"');
	});
});
