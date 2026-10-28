// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StampedText } from "../../lib/ipc";
import { tNow } from "../../stores/language";

const h = vi.hoisted(() => ({
	pluginsList: vi.fn(), skillsList: vi.fn(), ompMemoryProjects: vi.fn(),
	ompMemoryFiles: vi.fn(), ompMemoryRead: vi.fn(), confirm: vi.fn(), error: vi.fn(),
	ompMemoryDeleteSkill: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(), openPath: vi.fn() }));
vi.mock("../../lib/dialogs", () => ({ confirmDialog: h.confirm, errMsg: (e: unknown) => String(e) }));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: h.error } }));
vi.mock("../../lib/hooks", async (original) => ({
	...(await original<Record<string, unknown>>()),
	useHomeDir: () => "/home/test", useShortPath: () => (path: string) => path,
}));
vi.mock("../../lib/ipc", async (original) => ({
	...(await original<Record<string, unknown>>()),
	pluginsList: h.pluginsList, skillsList: h.skillsList,
	ompMemoryProjects: h.ompMemoryProjects, ompMemoryFiles: h.ompMemoryFiles, ompMemoryRead: h.ompMemoryRead,
	ompMemoryDeleteSkill: h.ompMemoryDeleteSkill,
}));
vi.mock("./useAppSettings", () => ({ useSettingsProjectCwd: () => null }));
vi.mock("./OmpSettingsList", () => ({ OmpSections: () => null }));
vi.mock("@uiw/react-codemirror", () => ({
	default: ({ value, onChange, editable }: { value: string; onChange: (value: string) => void; editable: boolean }) => (
		<textarea aria-label="File content" value={value} disabled={!editable} onChange={(event) => onChange(event.target.value)} />
	),
	EditorView: { lineWrapping: {} },
}));

import { FileEditor } from "./FileEditor";
import { PluginsSection } from "./PluginsSection";
import { MemoryFilesPanel } from "./sections/MemoryFilesPanel";

// ES2021 is the app's configured lib; Promise.withResolvers is not available there.
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
async function settle(fn: () => void) { await act(async () => { fn(); }); }
const saveButton = () => screen.getByRole("button", { name: tNow("settingsCore.fileEditor.saveButton") }) as HTMLButtonElement;
const reloadButton = () => screen.getByRole("button", { name: tNow("settingsCore.fileEditor.reloadFromDisk") }) as HTMLButtonElement;
const edit = (editor: HTMLElement, value: string) => fireEvent.change(editor, { target: { value } });
let fileNumber = 0;
function mountEditor(load: () => Promise<StampedText>, save = vi.fn().mockResolvedValue("s2")) {
	return { ...render(<FileEditor fileKey={`race:${++fileNumber}`} path="/test/rules.md" load={load} save={save} />), save };
}

beforeEach(() => {
	vi.clearAllMocks();
	h.confirm.mockResolvedValue(true);
	h.skillsList.mockResolvedValue({ skills: [], extensions: [] });
	h.ompMemoryRead.mockResolvedValue({ content: "preview", stamp: "s1" });
});
afterEach(cleanup);

describe("76: settings file buffer ownership", () => {
	it("keeps typing during save dirty and uses the saved snapshot stamp for the next write", async () => {
		const first = deferred<string>();
		const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue("s3");
		mountEditor(async () => ({ content: "initial", stamp: "s1" }), save);
		const editor = await screen.findByRole("textbox", { name: "File content" }) as HTMLTextAreaElement;
		edit(editor, "saved snapshot");
		fireEvent.click(saveButton());
		expect(reloadButton().disabled).toBe(true);
		edit(editor, "new typing");
		await settle(() => first.resolve("s2"));
		expect(editor.value).toBe("new typing");
		expect(saveButton().disabled).toBe(false);
		fireEvent.click(saveButton());
		await waitFor(() => expect(save).toHaveBeenLastCalledWith("new typing", "s2"));
	});

	it("does not adopt an unseen disk snapshot or stamp when typing during reload", async () => {
		const reload = deferred<StampedText>();
		const load = vi.fn().mockResolvedValueOnce({ content: "initial", stamp: "s1" }).mockReturnValue(reload.promise);
		const { save } = mountEditor(load);
		const editor = await screen.findByRole("textbox", { name: "File content" }) as HTMLTextAreaElement;
		fireEvent.click(reloadButton());
		edit(editor, "typed against initial");
		fireEvent.keyDown(window, { key: "s", metaKey: true });
		expect(save).not.toHaveBeenCalled();
		await settle(() => reload.resolve({ content: "external changes", stamp: "external-stamp" }));
		expect(editor.value).toBe("typed against initial");
		fireEvent.click(saveButton());
		await waitFor(() => expect(save).toHaveBeenCalledWith("typed against initial", "s1"));
	});

	it("adopts a completed reload when there is no intervening edit", async () => {
		const reload = deferred<StampedText>();
		mountEditor(vi.fn().mockResolvedValueOnce({ content: "initial", stamp: "s1" }).mockReturnValue(reload.promise));
		const editor = await screen.findByRole("textbox", { name: "File content" }) as HTMLTextAreaElement;
		fireEvent.click(reloadButton());
		await settle(() => reload.resolve({ content: "fresh", stamp: "s2" }));
		expect(editor.value).toBe("fresh");
		expect(saveButton().disabled).toBe(true);
	});

	it("keeps the buffer and stamp when reload fails after typing", async () => {
		const reload = deferred<StampedText>();
		const { save } = mountEditor(vi.fn().mockResolvedValueOnce({ content: "initial", stamp: "s1" }).mockReturnValue(reload.promise));
		const editor = await screen.findByRole("textbox", { name: "File content" }) as HTMLTextAreaElement;
		fireEvent.click(reloadButton());
		edit(editor, "survives error");
		await settle(() => reload.reject(new Error("read failed")));
		expect(editor.value).toBe("survives error");
		expect(h.error).toHaveBeenCalledWith("read failed");
		fireEvent.click(saveButton());
		await waitFor(() => expect(save).toHaveBeenCalledWith("survives error", "s1"));
	});

	it("preserves typing while the conflict dialog's reload is pending", async () => {
		h.confirm.mockResolvedValue(false);
		const reload = deferred<StampedText>();
		const load = vi.fn().mockResolvedValueOnce({ content: "initial", stamp: "s1" }).mockReturnValue(reload.promise);
		const save = vi.fn().mockRejectedValueOnce("CONFLICT: changed").mockResolvedValue("s3");
		mountEditor(load, save);
		const editor = await screen.findByRole("textbox", { name: "File content" }) as HTMLTextAreaElement;
		edit(editor, "save attempt");
		fireEvent.click(saveButton());
		await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
		edit(editor, "typed during conflict read");
		await settle(() => reload.resolve({ content: "external", stamp: "s2" }));
		expect(editor.value).toBe("typed during conflict read");
		fireEvent.click(saveButton());
		await waitFor(() => expect(save).toHaveBeenLastCalledWith("typed during conflict read", "s1"));
	});

	it("ignores a previous editor's pending load after unmount", async () => {
		const old = deferred<StampedText>();
		const view = mountEditor(() => old.promise);
		view.unmount();
		mountEditor(async () => ({ content: "current editor", stamp: "current" }));
		const editor = await screen.findByRole("textbox", { name: "File content" }) as HTMLTextAreaElement;
		await settle(() => old.reject(new Error("old read failure")));
		expect(editor.value).toBe("current editor");
		expect(h.error).not.toHaveBeenCalled();
	});

	it("allows only one pending create and blocks reload until it settles", async () => {
		const creating = deferred<string>();
		const save = vi.fn().mockReturnValue(creating.promise);
		render(<FileEditor fileKey={`create:${++fileNumber}`} path="/test/new.md" load={async () => ({ content: null, stamp: null })} save={save} createContent="new content" />);
		const create = await screen.findByRole("button", { name: tNow("settingsCore.fileEditor.createFile") }) as HTMLButtonElement;
		fireEvent.click(create);
		fireEvent.click(create);
		expect(save).toHaveBeenCalledTimes(1);
		expect(create.disabled).toBe(true);
		expect(reloadButton().disabled).toBe(true);
		await settle(() => creating.resolve("created-stamp"));
		const editor = await screen.findByRole("textbox", { name: "File content" }) as HTMLTextAreaElement;
		expect(editor.value).toBe("new content");
		expect(saveButton().disabled).toBe(true);
	});

	it("releases create ownership after failure so the user can retry", async () => {
		const creating = deferred<string>();
		const save = vi.fn().mockReturnValueOnce(creating.promise).mockResolvedValue("created");
		render(<FileEditor fileKey={`create:${++fileNumber}`} path="/test/new.md" load={async () => ({ content: null, stamp: null })} save={save} createContent="retry content" />);
		const create = await screen.findByRole("button", { name: tNow("settingsCore.fileEditor.createFile") }) as HTMLButtonElement;
		fireEvent.click(create);
		await settle(() => creating.reject(new Error("create failed")));
		expect(create.disabled).toBe(false);
		fireEvent.click(create);
		await screen.findByRole("textbox", { name: "File content" });
		expect(save).toHaveBeenCalledTimes(2);
	});

	it("releases create ownership when the conflict reread fails", async () => {
		const load = vi.fn().mockResolvedValueOnce({ content: null, stamp: null }).mockRejectedValue(new Error("conflict read failed"));
		const save = vi.fn().mockRejectedValueOnce("CONFLICT: appeared").mockResolvedValue("created");
		render(<FileEditor fileKey={`create:${++fileNumber}`} path="/test/new.md" load={load} save={save} createContent="retry content" />);
		const create = await screen.findByRole("button", { name: tNow("settingsCore.fileEditor.createFile") }) as HTMLButtonElement;
		fireEvent.click(create);
		await waitFor(() => expect(h.error).toHaveBeenCalledWith(expect.stringContaining("conflict read failed")));
		expect(create.disabled).toBe(false);
		fireEvent.click(create);
		await screen.findByRole("textbox", { name: "File content" });
		expect(save).toHaveBeenCalledTimes(2);
	});
});

const pluginCatalog = (name: string) => ({ roots: [], plugins: [{ name, spec: null, version: null, description: null, hasManifest: true, kind: "npm", scope: "user", enabled: true, projectDisabled: false, enabledFeatures: null, dir: null }] });

describe("77: plugin catalog generation", () => {
	it("ignores the previous project's success including its extension list", async () => {
		const a = deferred<unknown>();
		const b = deferred<unknown>();
		h.pluginsList.mockImplementation((cwd: string) => cwd === "/a" ? a.promise : b.promise);
		h.skillsList.mockImplementation(async (cwd: string) => ({ skills: [], extensions: [{ name: `extension-${cwd}`, path: `${cwd}/extension.ts`, source: "project", enabled: true }] }));
		const view = render(<PluginsSection cwd="/a" />);
		view.rerender(<PluginsSection cwd="/b" />);
		await settle(() => b.resolve(pluginCatalog("current-plugin")));
		await screen.findByText("current-plugin");
		await settle(() => a.resolve(pluginCatalog("old-plugin")));
		expect(screen.queryByText("old-plugin")).toBeNull();
		expect(screen.getByText("extension-/b")).toBeTruthy();
		expect(screen.queryByText("extension-/a")).toBeNull();
	});

	it("does not let an old failure clear the active project's pending indicator or error", async () => {
		const a = deferred<unknown>();
		const b = deferred<unknown>();
		h.pluginsList.mockImplementation((cwd: string) => cwd === "/a" ? a.promise : b.promise);
		const view = render(<PluginsSection cwd="/a" />);
		view.rerender(<PluginsSection cwd="/b" />);
		await settle(() => a.reject(new Error("obsolete plugin error")));
		expect(screen.queryByText(/obsolete plugin error/)).toBeNull();
		const rescan = screen.getByRole("button", { name: tNow("settingsCore.plugins.rescan") }) as HTMLButtonElement;
		expect(rescan.disabled).toBe(true);
		await settle(() => b.resolve(pluginCatalog("current-plugin")));
		expect(rescan.disabled).toBe(false);
	});

	it("rejects an earlier request even when switching back to the same project", async () => {
		const old = deferred<unknown>();
		const other = deferred<unknown>();
		h.pluginsList.mockReturnValueOnce(old.promise).mockReturnValueOnce(other.promise).mockResolvedValue(pluginCatalog("latest-a"));
		const view = render(<PluginsSection cwd="/a" />);
		view.rerender(<PluginsSection cwd="/b" />);
		view.rerender(<PluginsSection cwd="/a" />);
		await screen.findByText("latest-a");
		await settle(() => { old.resolve(pluginCatalog("outdated-a")); other.resolve(pluginCatalog("outdated-b")); });
		expect(screen.getByText("latest-a")).toBeTruthy();
		expect(screen.queryByText("outdated-a")).toBeNull();
	});

	it("clears the previous project's visible rows while the next project loads", async () => {
		const next = deferred<unknown>();
		h.pluginsList.mockResolvedValueOnce(pluginCatalog("previous-visible")).mockReturnValue(next.promise);
		const view = render(<PluginsSection cwd="/a" />);
		await screen.findByText("previous-visible");
		view.rerender(<PluginsSection cwd="/b" />);
		expect(screen.queryByText("previous-visible")).toBeNull();
		await settle(() => next.resolve(pluginCatalog("new-visible")));
		await screen.findByText("new-visible");
	});

	it("does not let old success clear the current project's error", async () => {
		const old = deferred<unknown>();
		const current = deferred<unknown>();
		h.pluginsList.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
		const view = render(<PluginsSection cwd="/a" />);
		view.rerender(<PluginsSection cwd="/b" />);
		await settle(() => current.reject(new Error("current plugin failure")));
		await screen.findByText(/current plugin failure/);
		await settle(() => old.resolve(pluginCatalog("obsolete-success")));
		expect(screen.getByText(/current plugin failure/)).toBeTruthy();
		expect(screen.queryByText("obsolete-success")).toBeNull();
	});
});

const memorySkill = (name: string) => [{ rel: `skills/${name}/SKILL.md`, editable: true }];
async function mountMemory() {
	h.ompMemoryProjects.mockResolvedValue(["p1", "p2"]);
	// The first two calls only discover which projects have memory files.
	h.ompMemoryFiles.mockResolvedValueOnce(memorySkill("p1-discovery")).mockResolvedValueOnce(memorySkill("p2-discovery"));
	render(<MemoryFilesPanel />);
	return await screen.findByRole("combobox", { name: tNow("memoryRules.projectSelectAria") }) as HTMLSelectElement;
}

describe("78: memory file list generation", () => {
	it.each(["success", "failure"] as const)("ignores a previous project's late %s", async (outcome) => {
		const old = deferred<unknown>();
		const current = deferred<unknown>();
		h.ompMemoryFiles.mockReset();
		const mounting = mountMemory();
		h.ompMemoryFiles.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
		const select = await mounting;
		await waitFor(() => expect(select.value).toBe("p1"));
		fireEvent.change(select, { target: { value: "p2" } });
		await settle(() => current.resolve(memorySkill("current-memory")));
		await screen.findByText("current-memory");
		await settle(() => outcome === "success" ? old.resolve(memorySkill("old-memory")) : old.reject(new Error("obsolete memory error")));
		expect(screen.getByText("current-memory")).toBeTruthy();
		expect(screen.queryByText("old-memory")).toBeNull();
		expect(screen.queryByText(/obsolete memory error/)).toBeNull();
	});

	it("keeps the latest list when a prior request for the same project returns last", async () => {
		const old = deferred<unknown>();
		const other = deferred<unknown>();
		h.ompMemoryFiles.mockReset();
		const mounting = mountMemory();
		h.ompMemoryFiles.mockReturnValueOnce(old.promise).mockReturnValueOnce(other.promise).mockResolvedValue(memorySkill("latest-memory"));
		const select = await mounting;
		await waitFor(() => expect(select.value).toBe("p1"));
		fireEvent.change(select, { target: { value: "p2" } });
		fireEvent.change(select, { target: { value: "p1" } });
		await screen.findByText("latest-memory");
		await settle(() => { old.resolve(memorySkill("outdated-p1")); other.resolve(memorySkill("outdated-p2")); });
		expect(screen.getByText("latest-memory")).toBeTruthy();
		expect(screen.queryByText("outdated-p1")).toBeNull();
	});

	it("does not let old success clear the selected memory project's error", async () => {
		const old = deferred<unknown>();
		const current = deferred<unknown>();
		h.ompMemoryFiles.mockReset();
		const mounting = mountMemory();
		h.ompMemoryFiles.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
		const select = await mounting;
		await waitFor(() => expect(select.value).toBe("p1"));
		fireEvent.change(select, { target: { value: "p2" } });
		await settle(() => current.reject(new Error("current memory failure")));
		await screen.findByText("current memory failure");
		await settle(() => old.resolve(memorySkill("obsolete-success")));
		expect(screen.getByText("current memory failure")).toBeTruthy();
		expect(screen.queryByText("obsolete-success")).toBeNull();
	});

	it("does not close the new project's editor when an old skill deletion finishes", async () => {
		const deletion = deferred<void>();
		h.ompMemoryDeleteSkill.mockReturnValue(deletion.promise);
		h.ompMemoryFiles.mockReset();
		const mounting = mountMemory();
		h.ompMemoryFiles.mockResolvedValueOnce(memorySkill("old-skill")).mockResolvedValue(memorySkill("current-skill"));
		const select = await mounting;
		await screen.findByText("old-skill");
		fireEvent.click(screen.getByRole("button", { name: tNow("memoryRules.delete") }));
		await waitFor(() => expect(h.ompMemoryDeleteSkill).toHaveBeenCalledWith("p1", "old-skill"));
		fireEvent.change(select, { target: { value: "p2" } });
		await screen.findByText("current-skill");
		fireEvent.click(screen.getByRole("button", { name: tNow("memoryRules.edit") }));
		await screen.findByRole("textbox", { name: "File content" });
		await settle(() => deletion.resolve());
		expect(screen.getByRole("textbox", { name: "File content" })).toBeTruthy();
		expect(h.ompMemoryFiles.mock.calls.filter(([slug]) => slug === "p1")).toHaveLength(2);
	});
});
