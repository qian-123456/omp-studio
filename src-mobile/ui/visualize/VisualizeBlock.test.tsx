// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "../Markdown";
import { VisualizeBlock } from "./VisualizeBlock";
import { VISUALIZE_CSP } from "./frame";

afterEach(cleanup);

describe("Markdown Visualize fence recognition", () => {
	it("renders unclosed visualize fence as code block while streaming", () => {
		const text = "```visualize\n<div>partial html";
		render(<Markdown text={text} streaming />);
		expect(screen.queryByTitle("visualize")).toBeNull();
		expect(screen.getByText(/partial html/)).toBeDefined();
	});

	it("renders closed visualize fence as VisualizeBlock", () => {
		const text = "```visualize\n<div>Hello Chart</div>\n```";
		render(<Markdown text={text} />);
		expect(screen.getAllByText("visualize").length).toBeGreaterThan(0);
		const iframe = screen.getByTitle("visualize") as HTMLIFrameElement;
		expect(iframe).toBeDefined();
		expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
		expect(iframe.srcdoc).toContain(VISUALIZE_CSP);
		expect(iframe.srcdoc).toContain("<div>Hello Chart</div>");
	});

	it("recognizes visualize wide", () => {
		const text = "```visualize wide\n<div>Wide Chart</div>\n```";
		render(<Markdown text={text} />);
		expect(screen.getByText("visualize wide")).toBeDefined();
	});
});

describe("VisualizeBlock interactive features", () => {
	const sampleHtml = "<div id='app'>Interactive Chart</div>";

	it("renders sandboxed iframe with strict CSP and srcDoc", () => {
		render(<VisualizeBlock html={sampleHtml} />);
		const iframe = screen.getByTitle("visualize") as HTMLIFrameElement;
		expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
		expect(iframe.srcdoc).toContain(VISUALIZE_CSP);
		expect(iframe.srcdoc).toContain(sampleHtml);
		expect(iframe.srcdoc).toContain("window.openai");
	});

	it("toggles between preview and source code", () => {
		render(<VisualizeBlock html={sampleHtml} />);
		expect(screen.getByTitle("visualize")).toBeDefined();

		// Click 源码
		fireEvent.click(screen.getByRole("button", { name: "源码" }));
		expect(screen.queryByTitle("visualize")).toBeNull();
		expect(screen.getByText(sampleHtml)).toBeDefined();

		// Click 预览
		fireEvent.click(screen.getByRole("button", { name: "预览" }));
		expect(screen.getByTitle("visualize")).toBeDefined();
	});

	it("opens mobile fullscreen modal and closes it", () => {
		render(<VisualizeBlock html={sampleHtml} />);
		expect(screen.queryByText("可视化全屏视图")).toBeNull();

		// Click fullscreen button
		fireEvent.click(screen.getByLabelText("全屏视图"));
		expect(screen.getByText("可视化全屏视图")).toBeDefined();

		// Close fullscreen
		fireEvent.click(screen.getByLabelText("关闭全屏"));
		expect(screen.queryByText("可视化全屏视图")).toBeNull();
	});

	it("handles postMessage bridge for auto-height", async () => {
		render(<VisualizeBlock html={sampleHtml} />);
		const iframe = screen.getByTitle("visualize") as HTMLIFrameElement;

		// Mock iframe contentWindow and postMessage handshake
		const mockPostMessage = vi.fn();
		Object.defineProperty(iframe, "contentWindow", {
			value: { postMessage: mockPostMessage },
			writable: true,
		});

		// Trigger onLoad to initialize MessageChannel
		fireEvent.load(iframe);
		expect(mockPostMessage).toHaveBeenCalledWith(
			expect.objectContaining({ type: "omp-visualize-init" }),
			"*",
			expect.any(Array),
		);
	});

	it("dispatches follow-up prompt to chat", () => {
		const followUpMock = vi.fn();
		render(<VisualizeBlock html={sampleHtml} onSendFollowUp={followUpMock} />);
		expect(screen.getByTitle("visualize")).toBeDefined();
	});
});
