// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";
import { MermaidBlock } from "./MermaidBlock";
import * as mermaidRender from "./mermaidRender";
import * as ImageViewer from "./ImageViewer";

afterEach(cleanup);

describe("Markdown Mermaid fence recognition", () => {
	it("renders unclosed mermaid fence as plain code while streaming", () => {
		const text = "```mermaid\ngraph TD\n  A-->B";
		render(<Markdown text={text} streaming />);
		expect(screen.queryByText("正在渲染图表...")).toBeNull();
		expect(screen.getByText(/graph TD/)).toBeDefined();
	});

	it("renders closed mermaid fence as MermaidBlock", async () => {
		vi.spyOn(mermaidRender, "renderMermaidSvg").mockResolvedValue(
			'<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
		);
		const text = "```mermaid\ngraph TD\n  A-->B\n```";
		render(<Markdown text={text} />);
		expect(screen.getAllByText("mermaid").length).toBeGreaterThan(0);
		await waitFor(() => {
			expect(screen.getByAltText("Mermaid diagram")).toBeDefined();
		});
	});
});

describe("MermaidBlock interactions", () => {
	it("toggles between diagram and source code", async () => {
		vi.spyOn(mermaidRender, "renderMermaidSvg").mockResolvedValue(
			'<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
		);
		render(<MermaidBlock source="graph TD; A-->B;" />);

		await waitFor(() => {
			expect(screen.getByAltText("Mermaid diagram")).toBeDefined();
		});

		// Switch to source
		fireEvent.click(screen.getByRole("button", { name: "源码" }));
		expect(screen.getByText("graph TD; A-->B;")).toBeDefined();

		// Switch back to diagram
		fireEvent.click(screen.getByRole("button", { name: "图表" }));
		expect(screen.getByAltText("Mermaid diagram")).toBeDefined();
	});

	it("opens fullscreen zoom when tapping diagram image or fullscreen button", async () => {
		vi.spyOn(mermaidRender, "renderMermaidSvg").mockResolvedValue(
			'<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40"/></svg>',
		);
		const openSpy = vi.spyOn(ImageViewer, "openImage").mockImplementation(() => {});

		render(<MermaidBlock source="graph TD; A-->B;" />);

		await waitFor(() => {
			expect(screen.getByAltText("Mermaid diagram")).toBeDefined();
		});

		// Tap on diagram
		fireEvent.click(screen.getByAltText("Mermaid diagram"));
		expect(openSpy).toHaveBeenCalledWith(
			expect.objectContaining({ alt: "Mermaid diagram" }),
		);

		// Click fullscreen button
		fireEvent.click(screen.getByLabelText("全屏缩放"));
		expect(openSpy).toHaveBeenCalledTimes(2);
	});

	it("displays error banner and retry button on render error", async () => {
		const renderMock = vi
			.spyOn(mermaidRender, "renderMermaidSvg")
			.mockRejectedValueOnce(new Error("Syntax error in diagram"))
			.mockResolvedValueOnce('<svg><path/></svg>');

		render(<MermaidBlock source="invalid diagram syntax" />);

		await waitFor(() => {
			expect(screen.getByText(/图表渲染失败：Syntax error in diagram/)).toBeDefined();
		});
		expect(screen.getByText("重试")).toBeDefined();

		// Click retry
		fireEvent.click(screen.getByText("重试"));
		await waitFor(() => {
			expect(renderMock).toHaveBeenCalledTimes(2);
		});
	});
});
