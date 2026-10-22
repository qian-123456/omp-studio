import { describe, expect, it } from "vitest";
import {
	createSlugger,
	estimateReadingStats,
	extractHeadings,
	extractTitle,
	guideImageName,
	parseCallout,
	parseChapterPath,
	remarkCallouts,
	remarkHeadingIds,
	resolveGuideLink,
	searchGuideChapters,
	slugifyHeading,
} from "./guideContent";

describe("guideContent", () => {
	it("parses chapter paths", () => {
		expect(parseChapterPath("../../../docs/guide/zh/01-getting-started.md")).toEqual({
			lang: "zh",
			slug: "01-getting-started",
		});
		expect(parseChapterPath("../../../docs/guide/fr/01-x.md")).toBeNull();
	});

	it("extracts the H1 outside code fences", () => {
		expect(extractTitle("```\n# no\n```\n# 快速开始\n\n> lede", "x")).toBe("快速开始");
		expect(extractTitle("no heading", "fallback")).toBe("fallback");
	});

	it("slugs like GitHub and keeps CJK", () => {
		expect(slugifyHeading("Start a session")).toBe("start-a-session");
		expect(slugifyHeading("新建会话 (New)")).toBe("新建会话-new");
		const slug = createSlugger();
		expect([slug("Tips"), slug("Tips"), slug("Tips")]).toEqual(["tips", "tips-1", "tips-2"]);
	});

	it("detects callouts", () => {
		expect(parseCallout("[!WARNING]\nbody")).toEqual({ kind: "warning", rest: "body" });
		expect(parseCallout("[!tip] body")).toEqual({ kind: "tip", rest: "body" });
		expect(parseCallout("plain")).toBeNull();
	});

	it("classifies links", () => {
		expect(resolveGuideLink("./03-workspace.md#git")).toEqual({
			kind: "chapter",
			slug: "03-workspace",
			anchor: "git",
		});
		expect(resolveGuideLink("./03-workspace.md")).toEqual({
			kind: "chapter",
			slug: "03-workspace",
			anchor: null,
		});
		expect(resolveGuideLink("#%E6%96%B0")).toEqual({ kind: "anchor", anchor: "新" });
		expect(resolveGuideLink("https://example.com")).toEqual({
			kind: "external",
			url: "https://example.com",
		});
		expect(resolveGuideLink("mailto:a@b.c")).toEqual({ kind: "none" });
	});

	it("resolves guide image names", () => {
		expect(guideImageName("../images/a-b.png")).toBe("a-b.png");
		expect(guideImageName("https://x.com/a.png")).toBeNull();
	});

	it("remark plugins annotate headings and callouts", () => {
		const tree = {
			type: "root",
			children: [
				{ type: "heading", children: [{ type: "text", value: "Hello World" }] },
				{
					type: "blockquote",
					children: [
						{ type: "paragraph", children: [{ type: "text", value: "[!NOTE]\nKeep this" }] },
					],
				},
			],
		};
		remarkHeadingIds()(tree);
		remarkCallouts()(tree);
		expect(tree.children[0]).toMatchObject({ data: { hProperties: { id: "hello-world" } } });
		expect(tree.children[1]).toMatchObject({
			data: { hProperties: { dataCallout: "note" } },
			children: [{ children: [{ value: "Keep this" }] }],
		});
	});

	it("extracts H2 and H3 headings for table of contents", () => {
		const md = [
			"# H1 Ignored",
			"Intro text",
			"## First Section",
			"Text here",
			"### Nested Subsection",
			"```",
			"## In Code Fence Should Be Ignored",
			"```",
			"## First Section", // repeated heading
		].join("\n");
		const headings = extractHeadings(md);
		expect(headings).toEqual([
			{ level: 2, text: "First Section", id: "first-section" },
			{ level: 3, text: "Nested Subsection", id: "nested-subsection" },
			{ level: 2, text: "First Section", id: "first-section-1" },
		]);
	});

	it("estimates reading stats accurately", () => {
		const md = "# Title\n\n这是一个测试段落，用于计算阅读用时和字数。" + " 包含一些 English words.";
		const stats = estimateReadingStats(md);
		expect(stats.words).toBeGreaterThan(15);
		expect(stats.minutes).toBe(1);
	});

	it("searches guide chapters by keyword", () => {
		const chapters = [
			{
				slug: "01-intro",
				title: "快速开始",
				markdown: "# 快速开始\n## 登录\n使用 API 密钥或 OAuth 登录模型供应商。",
			},
			{
				slug: "02-subagent",
				title: "子代理",
				markdown: "# 子代理\n## 自定义子代理\n可在设置中创建具有独立 prompt 和工具的子代理。",
			},
		];
		const res = searchGuideChapters(chapters, "子代理");
		expect(res.length).toBeGreaterThanOrEqual(1);
		expect(res.some((r) => r.slug === "02-subagent" && r.headingId === "自定义子代理")).toBe(true);
		expect(res[0].slug).toBe("02-subagent");
	});
});
