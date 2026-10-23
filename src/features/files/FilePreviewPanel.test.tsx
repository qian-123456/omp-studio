// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({
	openPath: vi.fn(),
	openUrl: vi.fn(),
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
});
