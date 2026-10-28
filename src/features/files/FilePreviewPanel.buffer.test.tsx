// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Dialogs from "../../lib/dialogs";

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn(), revealItemInDir: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (value: string) => value }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: async () => "/Users/me" }));
const readTextFile = vi.fn<(path: string) => Promise<string>>();
const writeTextFile = vi.fn<(path: string, content: string, expectedContent?: string) => Promise<void>>();
const confirmDialog = vi.fn<() => Promise<boolean>>();
vi.mock("../../lib/ipc", () => ({
	readTextFile: (path: string) => readTextFile(path),
	writeTextFile: (path: string, content: string, expectedContent?: string) => writeTextFile(path, content, expectedContent),
}));
vi.mock("../../lib/dialogs", async (original) => ({
	...await original<typeof Dialogs>(),
	confirmDialog: () => confirmDialog(),
}));
vi.mock("./FileEditor", () => ({
	default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
		<textarea aria-label="file contents" value={value} onChange={(event) => onChange(event.target.value)} />
	),
}));
vi.mock("@uiw/react-codemirror", () => ({
	default: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
		<textarea aria-label="document contents" value={value} onChange={(event) => onChange(event.target.value)} />
	),
}));

import { FilePreviewPanel } from "./FilePreviewPanel";
import { useFilePreview } from "../../stores/filePreview";
import { DocView } from "../editor/DocView";
import { useUi } from "../../stores/ui";

beforeEach(() => {
	readTextFile.mockReset().mockImplementation(async (path) => `disk: ${path}`);
	writeTextFile.mockReset().mockResolvedValue(undefined);
	confirmDialog.mockReset().mockResolvedValue(false);
	useFilePreview.setState({ tabs: [], activePath: null });
});
afterEach(cleanup);

describe("FilePreviewPanel buffer lifecycle", () => {
	it("retains document edits after the center close action and reopening", async () => {
		const path = "/Users/me/document-close.md";
		useUi.setState({ selectedSessionId: null, centerView: "doc" });
		const view = render(<DocView path={path} />);
		await screen.findByRole("link", { name: path });
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		fireEvent.change(screen.getByRole("textbox", { name: "document contents" }), { target: { value: "center draft" } });
		fireEvent.click(screen.getByTitle("关闭 (Esc)"));
		expect(useUi.getState().centerView).toBe("home");
		expect(confirmDialog).not.toHaveBeenCalled();
		view.unmount();
		render(<DocView path={path} />);
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		expect((screen.getByRole("textbox", { name: "document contents" }) as HTMLTextAreaElement).value).toBe("center draft");
		expect(screen.getByText("未保存")).toBeTruthy();
	});

	it("uses exactly one shared confirmation for document reload", async () => {
		const path = "/Users/me/document-reload.md";
		render(<DocView path={path} />);
		await screen.findByRole("link", { name: path });
		fireEvent.click(screen.getByRole("button", { name: "编辑" }));
		fireEvent.change(screen.getByRole("textbox", { name: "document contents" }), { target: { value: "dirty document" } });
		confirmDialog.mockResolvedValue(true);
		readTextFile.mockResolvedValue("reloaded document");
		fireEvent.click(screen.getByTitle("从磁盘重新加载"));
		await waitFor(() => expect((screen.getByRole("textbox", { name: "document contents" }) as HTMLTextAreaElement).value).toBe("reloaded document"));
		expect(confirmDialog).toHaveBeenCalledTimes(1);
	});

	it("keeps the same file synchronized between the document and right preview", async () => {
		const path = "/Users/me/dual-consumers.md";
		useFilePreview.getState().openFile(path, { mode: "edit" });
		render(<><DocView path={path} /><FilePreviewPanel /></>);
		fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
		await waitFor(() => expect((screen.getByRole("textbox", { name: "document contents" }) as HTMLTextAreaElement).value).toBe(`disk: ${path}`));
		fireEvent.change(screen.getByRole("textbox", { name: "document contents" }), { target: { value: "one shared draft" } });
		expect((await screen.findByRole("textbox", { name: "file contents" }) as HTMLTextAreaElement).value).toBe("one shared draft");
		fireEvent.change(screen.getByRole("textbox", { name: "file contents" }), { target: { value: "edited from preview" } });
		expect((screen.getByRole("textbox", { name: "document contents" }) as HTMLTextAreaElement).value).toBe("edited from preview");
	});

	it("keeps the real dirty buffer after closeFile and reopening (finding 16)", async () => {
		const path = "/Users/me/close-retain.md";
		useFilePreview.getState().openFile(path, { mode: "edit" });
		render(<FilePreviewPanel />);
		fireEvent.change(await screen.findByRole("textbox", { name: "file contents" }), { target: { value: "my unsaved work" } });
		expect(screen.getByText("未保存")).toBeTruthy();
		act(() => useFilePreview.getState().closeFile(path));
		expect(screen.queryByRole("textbox")).toBeNull();
		act(() => useFilePreview.getState().openFile(path, { mode: "edit" }));
		expect((await screen.findByRole("textbox") as HTMLTextAreaElement).value).toBe("my unsaved work");
		expect(screen.getByText("未保存")).toBeTruthy();
		expect(confirmDialog).not.toHaveBeenCalled(); // Closing is retained, not destructive.
	});

	it("keeps drafts when switching tabs through the actual store (finding 18)", async () => {
		const path = "/Users/me/switch-retain.md";
		useFilePreview.getState().openFile(path, { mode: "edit" });
		render(<FilePreviewPanel />);
		fireEvent.change(await screen.findByRole("textbox"), { target: { value: "first draft" } });
		act(() => useFilePreview.getState().openFile("/Users/me/other-switch.md", { mode: "edit" }));
		await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("disk: /Users/me/other-switch.md"));
		act(() => useFilePreview.getState().setActive(path));
		expect((await screen.findByRole("textbox") as HTMLTextAreaElement).value).toBe("first draft");
		expect(screen.getByText("未保存")).toBeTruthy();
	});

	it("confirms the toolbar and external-banner reload before discarding (finding 17)", async () => {
		useFilePreview.getState().openFile("/Users/me/reload-consumer.md", { mode: "edit" });
		render(<FilePreviewPanel />);
		fireEvent.change(await screen.findByRole("textbox"), { target: { value: "unsaved draft" } });
		fireEvent.click(screen.getByTitle("从磁盘重新加载"));
		await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("unsaved draft");
		readTextFile.mockResolvedValue("external replacement");
		act(() => window.dispatchEvent(new Event("focus")));
		await screen.findByText("文件已在磁盘上被修改");
		fireEvent.click(screen.getAllByRole("button", { name: "重新加载" })[1]);
		await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(2));
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("unsaved draft");
		confirmDialog.mockResolvedValue(true);
		fireEvent.click(screen.getAllByRole("button", { name: "重新加载" })[1]);
		await waitFor(() => expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("external replacement"));
		expect(screen.queryByText("未保存")).toBeNull();
	});

	it("renders save conflicts and never treats keep-my-changes as overwrite permission", async () => {
		const path = "/Users/me/conflict-consumer.md";
		useFilePreview.getState().openFile(path, { mode: "edit" });
		render(<FilePreviewPanel />);
		fireEvent.change(await screen.findByRole("textbox"), { target: { value: "my changes" } });
		writeTextFile.mockRejectedValue("CONFLICT: changed on disk");
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await screen.findByText("CONFLICT: changed on disk");
		expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("my changes");
		expect(screen.getByText("未保存")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "保留我的修改" }));
		fireEvent.click(screen.getByRole("button", { name: "保存" }));
		await waitFor(() => expect(writeTextFile).toHaveBeenCalledTimes(2));
		expect(writeTextFile).toHaveBeenLastCalledWith(path, "my changes", `disk: ${path}`);
	});
});
