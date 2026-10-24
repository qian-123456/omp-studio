import { describe, expect, it } from "vitest";
import { sessionDisplayName, sessionDisplayNameOr } from "./sessionName";

describe("sessionDisplayName", () => {
	it("keeps the numbered terminal title with its project slug", () => {
		expect(sessionDisplayName({ title: "#209-omp-workspace 成品与人机差异分析" })).toBe(
			"#209-omp-workspace 成品与人机差异分析",
		);
	});

	it("keeps the session number when there is no slug", () => {
		expect(sessionDisplayName({ title: "#115 修复 bug" })).toBe("#115 修复 bug");
	});

	it("keeps a title that is only number and project slug", () => {
		expect(sessionDisplayName({ title: "#209-omp-workspace" })).toBe("#209-omp-workspace");
	});

	it("keeps a foreign project slug", () => {
		expect(sessionDisplayName({ title: "#10-other-project 内容" })).toBe("#10-other-project 内容");
	});

	it("keeps custom titles untouched", () => {
		expect(sessionDisplayName({ title: "重构侧栏" })).toBe("重构侧栏");
	});

	it("trims surrounding whitespace", () => {
		expect(sessionDisplayName({ title: "  #7-app 标题  " })).toBe("#7-app 标题");
	});

	it("still drops the legacy fork prefix but keeps the canonical title", () => {
		expect(sessionDisplayName({ title: "分支：#209-omp-workspace 标题" })).toBe(
			"#209-omp-workspace 标题",
		);
		expect(sessionDisplayName({ title: "分支 重构侧栏" })).toBe("重构侧栏");
	});

	it("keeps a title that is only the fork prefix", () => {
		expect(sessionDisplayName({ title: "分支：" })).toBe("分支：");
	});

	it("returns 新建的草稿 for empty title", () => {
		expect(sessionDisplayName({ title: "" })).toBe("新建的草稿");
	});
});

describe("sessionDisplayNameOr", () => {
	it("uses the fallback for missing sessions and empty titles", () => {
		expect(sessionDisplayNameOr(null, "回退")).toBe("回退");
		expect(sessionDisplayNameOr({ title: "" }, "回退")).toBe("回退");
	});

	it("returns the full canonical title otherwise", () => {
		expect(sessionDisplayNameOr({ title: "#3-app 标题" }, "回退")).toBe("#3-app 标题");
	});
});
