// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openPath, openUrl, importImageFile } = vi.hoisted(() => ({
	openPath: vi.fn(async (_path: string): Promise<void> => undefined),
	openUrl: vi.fn(async (_url: string): Promise<void> => undefined),
	importImageFile: vi.fn(async (path: string) => path),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
	openPath,
	openUrl,
	revealItemInDir: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (s: string) => s }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/Users/me" }));

const readTextFile = vi.fn<(path: string) => Promise<string>>();
vi.mock("../../lib/ipc", () => ({
	readTextFile: (path: string) => readTextFile(path),
	writeTextFile: vi.fn(async () => undefined),
	importImageFile,
}));
vi.mock("../chat/mermaidRender", () => ({
	currentMermaidMode: () => "dark",
	renderMermaidSvg: vi.fn(async () => '<svg viewBox="0 0 100 40"></svg>'),
	svgViewBoxSize: () => ({ width: 100, height: 40 }),
}));

import { FilePreviewPanel } from "./FilePreviewPanel";
import { useFilePreview } from "../../stores/filePreview";

describe("FilePreviewPanel", () => {
	beforeEach(() => {
		readTextFile.mockReset();
		importImageFile.mockReset();
		importImageFile.mockImplementation(async (path: string) => path);
		useFilePreview.setState({ tabs: [], activePath: null });
	});

	afterEach(cleanup);

	it("previews markdown in the right panel", async () => {
		readTextFile.mockResolvedValue("# 规则\n\n正文");
		useFilePreview.getState().openFile("/Users/me/AGENTS.md");
		render(<FilePreviewPanel />);
		expect(await screen.findByRole("heading", { name: "规则" })).toBeTruthy();
		expect(screen.getByText("预览")).toBeTruthy();
		expect(screen.getByText("编辑")).toBeTruthy();
		expect(readTextFile).toHaveBeenCalledWith("/Users/me/AGENTS.md");
	});
	it("renders .mmd as a Mermaid diagram instead of blocking the file", async () => {
		readTextFile.mockResolvedValue("graph TD\n  A-->B");
		useFilePreview.getState().openFile("/Users/me/chart.mmd");
		const { container } = render(<FilePreviewPanel />);
		await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
		expect(screen.getByText("图表")).toBeTruthy();
	});
	it("imports a project image before rendering it", async () => {
		useFilePreview.getState().openFile("/Users/me/project/chart.png");
		const { container } = render(<FilePreviewPanel />);
		await waitFor(() => expect(container.querySelector("img")).toBeTruthy());
		expect(importImageFile).toHaveBeenCalledWith("/Users/me/project/chart.png");
		expect(container.querySelector("img")?.getAttribute("src")).toBe("/Users/me/project/chart.png");
	});
	it("shows an honest error when importing a project image fails", async () => {
		importImageFile.mockRejectedValueOnce(new Error("outside asset scope"));
		useFilePreview.getState().openFile("/Users/me/project/missing.png");
		render(<FilePreviewPanel />);
		expect(await screen.findByText("无法加载这张图片")).toBeTruthy();
		expect(screen.getByText("/Users/me/project/missing.png")).toBeTruthy();
	});

	it("shows the read error in full instead of a blank pane", async () => {
		readTextFile.mockRejectedValue("无法读取 /Users/me/missing.md：No such file");
		useFilePreview.getState().openFile("/Users/me/missing.md");
		render(<FilePreviewPanel />);
		expect(await screen.findByText(/No such file/)).toBeTruthy();
	});

	it("explains the empty state before any file is opened", async () => {
		render(<FilePreviewPanel />);
		await waitFor(() => expect(screen.getByText("还没有打开的文件")).toBeTruthy());
	});

	it("renders .html in a sandboxed iframe by default and toggles to editable source", async () => {
		readTextFile.mockResolvedValue("<html><head></head><body><h1>Hi</h1></body></html>");
		useFilePreview.getState().openFile("/Users/me/page.html");
		const { container } = render(<FilePreviewPanel />);
		await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
		const frame = container.querySelector("iframe") as HTMLIFrameElement;
		expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
		expect(frame.getAttribute("srcdoc")).toContain("<h1>Hi</h1>");
		expect(screen.getByText("浏览器打开")).toBeTruthy();
		fireEvent.click(screen.getByText("编辑"));
		await waitFor(() => expect(container.querySelector("iframe")).toBeNull());
	});

	it("opens the html file through openPath from the 浏览器打开 button", async () => {
		readTextFile.mockResolvedValue("<p>x</p>");
		useFilePreview.getState().openFile("/Users/me/page.html");
		render(<FilePreviewPanel />);
		fireEvent.click(await screen.findByText("浏览器打开"));
		expect(openPath).toHaveBeenCalledWith("/Users/me/page.html");
	});

	it("renders .svg through the same preview", async () => {
		readTextFile.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
		useFilePreview.getState().openFile("/Users/me/a.svg");
		const { container } = render(<FilePreviewPanel />);
		await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
	});

	it("relays http(s) clicks from the preview to openUrl only", async () => {
		readTextFile.mockResolvedValue("<a href='https://example.com'>x</a>");
		useFilePreview.getState().openFile("/Users/me/page.html");
		const { container } = render(<FilePreviewPanel />);
		await waitFor(() => expect(container.querySelector("iframe")).toBeTruthy());
		const frame = container.querySelector("iframe") as HTMLIFrameElement;
		const fire = (data: unknown, source: unknown) =>
			window.dispatchEvent(new MessageEvent("message", { data, source: source as MessageEventSource }));
		fire({ type: "omp-html-preview-open", href: "https://example.com/" }, frame.contentWindow);
		fire({ type: "omp-html-preview-open", href: "file:///etc/passwd" }, frame.contentWindow);
		fire({ type: "omp-html-preview-open", href: "https://evil.test/" }, window);
		expect(openUrl).toHaveBeenCalledTimes(1);
		expect(openUrl).toHaveBeenCalledWith("https://example.com/");
	});
});
