// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";

const h = vi.hoisted(() => ({
	fsReadDir: vi.fn(async () => [
		{ name: "chart.png", path: "/project/chart.png", isDir: false },
		{ name: "chart.mmd", path: "/project/chart.mmd", isDir: false },
		{ name: "notes.md", path: "/project/notes.md", isDir: false },
	]),
	importImageFile: vi.fn(async (_path: string) => "/allowed/chart.png"),
	readTextFile: vi.fn(async (_path: string) => "graph TD\nA-->B"),
}));
vi.mock("../../lib/ipc", async (original) => ({
	...(await original<typeof IpcModule>()),
	fsReadDir: h.fsReadDir,
	importImageFile: h.importImageFile,
	readTextFile: h.readTextFile,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/Users/me" }));
vi.mock("../chat/mermaidRender", () => ({
	currentMermaidMode: () => "dark",
	renderMermaidSvg: vi.fn(async () => '<svg viewBox="0 0 100 40"></svg>'),
	svgViewBoxSize: () => ({ width: 100, height: 40 }),
}));

import { FileExplorer } from "./FileExplorer";
import { FilePreviewPanel } from "../files/FilePreviewPanel";
import { useExplorer } from "../../stores/explorer";
import { useFilePreview } from "../../stores/filePreview";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";

describe("file tree preview routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		useSessions.setState({ workspaces: [{ id: "project", name: "Project", path: "/project", kind: "project", mode: "code" }] } as never);
		useExplorer.setState({ workspaceId: "project" });
		useFilePreview.setState({ tabs: [], activePath: null });
		useUi.setState({ centerView: "session", selectedSessionId: null, docPath: null });
	});
	afterEach(cleanup);

	it("opens a project PNG through the actual file tree and renders the scoped copy", async () => {
		render(<><FileExplorer /><FilePreviewPanel /></>);
		fireEvent.click(await screen.findByText("chart.png"));
		await waitFor(() => expect(screen.getByRole("img", { name: "chart.png" }).getAttribute("src")).toBe("/allowed/chart.png"));
		expect(h.importImageFile).toHaveBeenCalledWith("/project/chart.png");
		expect(h.readTextFile).not.toHaveBeenCalled();
		expect(useUi.getState().centerView).toBe("session");
	});

	it("opens a Mermaid tree file as a diagram and leaves ordinary documents in Docs", async () => {
		render(<><FileExplorer /><FilePreviewPanel /></>);
		fireEvent.click(await screen.findByText("chart.mmd"));
		await waitFor(() => expect(screen.getByText("图表")).toBeTruthy());
		expect(h.readTextFile).toHaveBeenCalledWith("/project/chart.mmd");
		fireEvent.click(screen.getByText("notes.md"));
		expect(useUi.getState().docPath).toBe("/project/notes.md");
		expect(useUi.getState().centerView).toBe("doc");
	});
});
