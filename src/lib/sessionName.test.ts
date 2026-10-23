import { describe, expect, it } from "vitest";
import { sessionDisplayName } from "./sessionName";

describe("sessionDisplayName", () => {
	const cwd = "/Users/x/Documents/omp-workspace";

	it("strips `#<n>-<slug>` prefix", () => {
		expect(
			sessionDisplayName({
				title: "#209-omp-workspace 成品与人机差异分析",
				label: "#209",
				cwd,
			}),
		).toBe("成品与人机差异分析");
	});

	it("strips `#<n>` when label matches, no slug", () => {
		expect(
			sessionDisplayName({ title: "#115 修复 bug", label: "#115", cwd }),
		).toBe("修复 bug");
	});

	it("keeps title when embedded number is not the label", () => {
		expect(
			sessionDisplayName({ title: "#99 别的会话", label: "#5", cwd }),
		).toBe("#99 别的会话");
	});

	it("keeps custom names untouched", () => {
		expect(
			sessionDisplayName({ title: "重构侧栏", label: "#7", cwd }),
		).toBe("重构侧栏");
	});

	it("strips bare number without label", () => {
		expect(
			sessionDisplayName({ title: "#33 测试", label: "", cwd }),
		).toBe("测试");
	});

	it("does not strip a slug that is not the cwd basename", () => {
		expect(
			sessionDisplayName({
				title: "#10-other-project 内容",
				label: "#10",
				cwd,
			}),
		).toBe("other-project 内容");
	});

	it("falls back to the slug when nothing else remains", () => {
		expect(
			sessionDisplayName({ title: "#209-omp-workspace", label: "#209", cwd }),
		).toBe("omp-workspace");
	});

	it("returns 新建的草稿 for empty title", () => {
		expect(sessionDisplayName({ title: "", label: "#1" })).toBe(
			"新建的草稿",
		);
	});
});
