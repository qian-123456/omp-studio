// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { openPath, openUrl } = vi.hoisted(() => ({
	openPath: vi.fn(async (_path: string): Promise<void> => undefined),
	openUrl: vi.fn(async (_url: string): Promise<void> => undefined),
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
}));

import { FilePreviewPanel } from "./FilePreviewPanel";
import { useFilePreview } from "../../stores/filePreview";

describe("FilePreviewPanel", () => {
	beforeEach(() => {
		readTextFile.mockReset();
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
