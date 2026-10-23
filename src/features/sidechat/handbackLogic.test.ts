import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { formatWithAnnotations } from "../../stores/composer";
import {
	appendToDraft,
	buildHandbackText,
	extractHandbackDraft,
	HANDBACK_ACTION_KEY,
	HANDBACK_MARKER,
	HANDBACK_PROMPT,
	handbackAnnotation,
	showHandbackButton,
	showSendToMainBubbleAction,
	transcriptText,
	visibleSideChatActions,
} from "./handbackLogic";

let n = 0;
const item = (kind: TranscriptItem["kind"], text: string | null, extra: Partial<TranscriptItem> = {}): TranscriptItem => ({
	id: `i${n++}`,
	parentId: null,
	ts: "",
	kind,
	text,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
	...extra,
});

describe("prompt", () => {
	it("starts with the marker so the instruction is recognisable in the transcript", () => {
		expect(HANDBACK_PROMPT.startsWith(HANDBACK_MARKER)).toBe(true);
		expect(HANDBACK_PROMPT).toContain("结论");
		expect(HANDBACK_PROMPT).toContain("待办");
	});
});

describe("extractHandbackDraft", () => {
	const discussion = [item("user", "怎么设计？"), item("assistant", "用方案 A")];

	it("is pending until the instruction and an answer exist", () => {
		expect(extractHandbackDraft(discussion)).toEqual({ ok: false, pending: true });
		const withPrompt = [...discussion, item("user", HANDBACK_PROMPT)];
		expect(extractHandbackDraft(withPrompt)).toEqual({ ok: false, pending: true });
	});

	it("takes the last assistant text after the instruction, not earlier replies", () => {
		const items = [...discussion, item("user", HANDBACK_PROMPT), item("assistant", "  结论：方案 A  ")];
		expect(extractHandbackDraft(items)).toEqual({ ok: true, text: "结论：方案 A" });
	});

	it("uses the latest instruction when run twice", () => {
		const items = [
			...discussion,
			item("user", HANDBACK_PROMPT),
			item("assistant", "旧"),
			item("user", HANDBACK_PROMPT),
			item("assistant", "新"),
		];
		expect(extractHandbackDraft(items)).toEqual({ ok: true, text: "新" });
	});

	it("skips tool-only assistant turns and takes the last one with text", () => {
		const items = [
			item("user", HANDBACK_PROMPT),
			item("assistant", "结论正文"),
			item("tool_result", "x"),
			item("assistant", null),
		];
		expect(extractHandbackDraft(items)).toEqual({ ok: true, text: "结论正文" });
	});

	it("reports errors and aborts as non-pending failures", () => {
		const err = [item("user", HANDBACK_PROMPT), item("assistant", null, { stopReason: "error" })];
		expect(extractHandbackDraft(err)).toMatchObject({ ok: false, pending: false });
		const aborted = [item("user", HANDBACK_PROMPT), item("assistant", "半截", { stopReason: "aborted" })];
		expect(extractHandbackDraft(aborted)).toEqual({ ok: false, pending: false, error: "整理已被中止" });
		const empty = [item("user", HANDBACK_PROMPT), item("assistant", "  ")];
		expect(extractHandbackDraft(empty)).toEqual({ ok: false, pending: false, error: "模型没有返回文字内容" });
	});
});

describe("transcript and text assembly", () => {
	it("renders the conversation before the instruction, skipping hidden and empty items", () => {
		const items = [
			item("user", "问题"),
			item("assistant", "回答"),
			item("assistant", "内部", { hidden: true }),
			item("tool_result", "t"),
			item("user", HANDBACK_PROMPT),
			item("assistant", "结论"),
		];
		expect(transcriptText(items)).toBe("用户：问题\n\n助手：回答");
	});

	it("returns just the note without a transcript, otherwise a collapsed quote block", () => {
		expect(buildHandbackText("  结论  ", null)).toBe("结论");
		expect(buildHandbackText("结论", "  ")).toBe("结论");
		const out = buildHandbackText("结论", "用户：a\n助手：b");
		expect(out).toContain("<details>");
		expect(out).toContain("<summary>完整对话</summary>");
		expect(out).toContain("> 用户：a\n> 助手：b");
		expect(out.startsWith("结论\n\n")).toBe(true);
		expect(out.endsWith("</details>")).toBe(true);
	});
});

describe("annotation", () => {
	it("builds a labelled quote with no comment and formats it into the outgoing message", () => {
		const a = handbackAnnotation("  定下来：用 A  ", "方案讨论");
		expect(a).toEqual({ source: "message", text: "定下来：用 A", label: "来自辅助对话：方案讨论" });
		const out = formatWithAnnotations("请继续", [{ id: "1", ...a }]);
		expect(out).toBe("[1] (来自辅助对话：方案讨论)\n> 定下来：用 A\n\n请继续");
	});

	it("falls back when the title is empty", () => {
		expect(handbackAnnotation("x", " ").label).toBe("来自辅助对话：未命名");
	});
});

describe("appendToDraft", () => {
	it("uses the note alone when the composer is empty", () => {
		expect(appendToDraft(undefined, "  结论 A  ")).toBe("结论 A");
		expect(appendToDraft("", "结论 A")).toBe("结论 A");
	});

	it("appends after what the user already typed, separated by a blank line", () => {
		expect(appendToDraft("先看这个  \n", "结论 A")).toBe("先看这个\n\n结论 A");
	});

	it("leaves the draft untouched for an empty note", () => {
		expect(appendToDraft("草稿", "  ")).toBe("草稿");
	});
});

describe("mode gating", () => {
	it("summary shows the button and hides the bubble action", () => {
		expect(showHandbackButton("summary")).toBe(true);
		expect(showSendToMainBubbleAction("summary", true)).toBe(false);
	});

	it("select hides the button and shows the bubble action only inside a side chat", () => {
		expect(showHandbackButton("select")).toBe(false);
		expect(showSendToMainBubbleAction("select", true)).toBe(true);
		expect(showSendToMainBubbleAction("select", false)).toBe(false);
	});

	it("filters only the handback action out of the menu in select mode", () => {
		const actions = [{ key: "main" }, { key: HANDBACK_ACTION_KEY }];
		expect(visibleSideChatActions(actions, "summary")).toHaveLength(2);
		expect(visibleSideChatActions(actions, "select")).toEqual([{ key: "main" }]);
	});
});
