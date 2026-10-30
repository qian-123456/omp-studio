import { describe, expect, it } from "vitest";
import type { TranscriptItem } from "../../lib/contracts";
import { buildDiagnosisPrompt, parseDiagnosis } from "./doctor";
import { distillSessionSkeleton } from "./distribution";

let n = 0;
const item = (p: Partial<TranscriptItem>): TranscriptItem => ({
	id: `i${n++}`,
	parentId: null,
	ts: "2026-10-29T00:00:00Z",
	kind: "assistant",
	text: null,
	thinking: null,
	toolCalls: [],
	toolResult: null,
	usage: null,
	model: null,
	stopReason: null,
	hidden: false,
	...p,
});
const user = (text: string) => item({ kind: "user", text });
const call = (id: string) =>
	item({ kind: "assistant", toolCalls: [{ id, name: "bash", args: { command: "x" }, intent: null }], stopReason: "toolUse" });
const result = (isError: boolean, text = "boom") =>
	item({ kind: "tool_result", toolResult: { toolCallId: "c", toolName: "bash", isError, text } as TranscriptItem["toolResult"] });
const done = (text = "全部完成") => item({ kind: "assistant", text, stopReason: "stop" });

const skel = (items: TranscriptItem[]) => distillSessionSkeleton(items);

describe("session health tail semantics", () => {
	it("flags an active loop when errors end the session", () => {
		const s = skel([user("go"), call("a"), result(true), call("b"), result(true)]);
		expect(s.tokenMetrics.wasteSignals.join()).toContain("末尾仍有 2 次连续未解决");
		expect(s.dehydratedPromptText).toContain("末尾未解决的报错（仍未恢复）");
		expect(s.dehydratedPromptText).toContain("末尾为未解决的工具报错");
	});

	it("treats a later successful tool result as recovery but keeps history", () => {
		const s = skel([user("go"), call("a"), result(true), call("b"), result(true), call("c"), result(false, "ok"), done()]);
		expect(s.tokenMetrics.wasteSignals.join()).toContain("已解决");
		expect(s.tokenMetrics.wasteSignals.join()).not.toContain("末尾仍有");
		expect(s.recentErrors).toHaveLength(2);
		expect(s.dehydratedPromptText).toContain("历史报错（共 2 条，其中 2 条已被");
		expect(s.dehydratedPromptText).toContain("已正常完成最近一轮");
	});

	it("treats a normal assistant turn after errors as recovery even without later tools", () => {
		const s = skel([user("go"), call("a"), result(true), call("b"), result(true), done("已换思路修复")]);
		expect(s.tokenMetrics.wasteSignals.join()).not.toContain("末尾仍有");
		expect(s.dehydratedPromptText).toContain("末尾未解决的报错: 无");
	});

	it("keeps a single trailing error unresolved and reports running state", () => {
		const s = skel([user("go"), call("a"), result(true), user("再试一次")]);
		expect(s.dehydratedPromptText).toContain("末尾未解决的报错（仍未恢复）");
		expect(s.dehydratedPromptText).toContain("进行中：等待助手响应");
	});
});

describe("multi-lens diagnosis", () => {
	const sk = skel([user("go"), done()]);

	it("combines several lenses and a custom question in one prompt", () => {
		const p = buildDiagnosisPrompt(sk, ["cost", "prompt", "quality"], "为什么慢？");
		expect(p).toContain("诊断视角：成本");
		expect(p).toContain("诊断视角：提示词");
		expect(p).toContain("诊断视角：质量");
		expect(p).toContain("【用户的问题】为什么慢？");
	});

	it("falls back to freeform when no lens is selected but a question exists", () => {
		const p = buildDiagnosisPrompt(sk, [], "只问这个");
		expect(p).toContain("诊断视角：自由提问");
		expect(p).toContain("只问这个");
	});

	it("stays backward compatible with a single lens", () => {
		expect(buildDiagnosisPrompt(sk, "cost")).toContain("诊断视角：成本");
	});

	it("retains every selected lens on the parsed result", () => {
		const r = parseDiagnosis('{"conclusion":"ok"}', ["prompt", "quality"]);
		expect(r.lenses).toEqual(["prompt", "quality"]);
		expect(r.lens).toBe("prompt");
		expect(parseDiagnosis('{"conclusion":"ok"}', "cost").lenses).toEqual(["cost"]);
	});
});
