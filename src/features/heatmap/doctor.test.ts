import { describe, expect, it } from "vitest";
import { aggregateSystemicIssues, type DoctorHistoryEntry, parseDiagnosis } from "./doctor";

const entry = (sessionId: string, cwd: string, model: string, tags: string[]): DoctorHistoryEntry => ({
	sessionId,
	cwd,
	model,
	tags,
	at: 1,
});

describe("parseDiagnosis", () => {
	it("parses fenced JSON surrounded by prose and coerces fields", () => {
		const raw = `好的，诊断如下：\n\`\`\`json\n${JSON.stringify({
			conclusion: "目标反复变化",
			evidence: "第3轮改了需求",
			rootCause: "缺少验收标准",
			prescriptions: [
				{ label: "收敛范围", promptDraft: "只做登录页，完成后运行测试", explanation: "减少返工" },
				{ label: "空", promptDraft: "" },
				{ promptDraft: "a" },
				{ promptDraft: "b" },
			],
			systemicTags: ["目标模糊", "目标模糊", "范围蔓延"],
		})}\n\`\`\`\n以上。`;
		const r = parseDiagnosis(raw, "prompt");
		expect(r.lens).toBe("prompt");
		expect(r.conclusion).toBe("目标反复变化");
		expect(r.evidence).toEqual(["第3轮改了需求"]);
		expect(r.prescriptions.map((p) => p.promptDraft)).toEqual(["只做登录页，完成后运行测试", "a", "b"]);
		expect(r.prescriptions[1].label).toBe("处方");
		expect(r.systemicTags).toEqual(["目标模糊", "范围蔓延"]);
	});

	it("throws a Chinese error when no valid JSON is present", () => {
		expect(() => parseDiagnosis("模型超时了 {not json", "cost")).toThrow(/JSON/);
	});

	it("throws when the conclusion is missing", () => {
		expect(() => parseDiagnosis('{"evidence":[]}', "cost")).toThrow(/结论/);
	});
});

describe("aggregateSystemicIssues", () => {
	it("returns [] when no tag repeats", () => {
		expect(
			aggregateSystemicIssues([entry("a", "/p1", "m1", ["目标模糊"]), entry("b", "/p2", "m2", ["重复读取"])]),
		).toEqual([]);
	});

	it("classifies scopes and ranks the top 3 by count", () => {
		const issues = aggregateSystemicIssues([
			// cross-project: 3 projects, 2 models
			entry("a", "/p1", "m1", ["目标模糊", "报错死循环"]),
			entry("b", "/p2", "m2", ["目标模糊", "重复读取"]),
			entry("c", "/p3", "m1", ["目标模糊", "重复读取"]),
			// same-project: only /p1
			entry("d", "/p1", "m2", ["报错死循环"]),
			// same-model: across projects, only m3
			entry("e", "/p4", "m3", ["上下文浪费"]),
			entry("f", "/p5", "m3", ["上下文浪费"]),
			// lower-ranked cross-project tag, pushed out of top 3
			entry("g", "/p6", "m4", ["缺少验收标准"]),
			entry("h", "/p7", "m5", ["缺少验收标准"]),
		]);
		expect(issues).toHaveLength(3);
		expect(issues[0]).toMatchObject({
			tag: "目标模糊",
			scope: "cross-project",
			scopeLabel: "跨项目习惯",
			count: 3,
			sessionIds: ["a", "b", "c"],
		});
		const byTag = Object.fromEntries(
			aggregateSystemicIssues([
				entry("a", "/p1", "m1", ["报错死循环"]),
				entry("d", "/p1", "m2", ["报错死循环"]),
				entry("e", "/p4", "m3", ["上下文浪费"]),
				entry("f", "/p5", "m3", ["上下文浪费"]),
			]).map((i) => [i.tag, i]),
		);
		expect(byTag["报错死循环"]).toMatchObject({ scope: "same-project", scopeLabel: "同项目架构" });
		expect(byTag["上下文浪费"]).toMatchObject({ scope: "same-model", scopeLabel: "同模型短板" });
	});
});
