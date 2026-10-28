// @vitest-environment jsdom
/**
 * Replays of SettingsSkillsAudit suspected bugs against real repo modules.
 * Only external boundaries are mocked: Tauri IPC (invoke/listen), opener, dialogs, toast, and the
 * CodeMirror widget (a textarea with the same value/onChange/editable contract).
 * A FAILING assertion in a test below = the suspected bug reproduced (rule named in the test title).
 */
import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
	pluginsList: vi.fn(),
	skillsList: vi.fn(),
	ompConfigList: vi.fn(),
	ompConfigSet: vi.fn(),
	extensionEnableFile: vi.fn(),
	ompProjectConfigRead: vi.fn(),
	ompMemoryProjects: vi.fn(),
	ompMemoryFiles: vi.fn(),
	ompMemoryRead: vi.fn(),
	mcpCatalog: vi.fn(),
	ompUpdateCheck: vi.fn(),
	ompUpdateRun: vi.fn(),
	ompInfo: vi.fn(),
	invoke: vi.fn(),
	confirm: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(), openPath: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: () => Promise.resolve("1.0.0") }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(() => Promise.resolve("<HOME>")) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => h.invoke(...a), convertFileSrc: (s: string) => s }));
vi.mock("@tauri-apps/api/event", () => ({ listen: (...a: unknown[]) => h.invoke("__listen", ...a), emit: vi.fn() }));
vi.mock("<repo>/src/lib/dialogs", () => ({ confirmDialog: h.confirm, errMsg: (e: unknown) => String(e) }));
vi.mock("<repo>/src/lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("<repo>/src/lib/ipc", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	pluginsList: h.pluginsList,
	skillsList: h.skillsList,
	ompConfigList: h.ompConfigList,
	ompConfigSet: h.ompConfigSet,
	extensionEnableFile: h.extensionEnableFile,
	ompProjectConfigRead: h.ompProjectConfigRead,
	ompMemoryProjects: h.ompMemoryProjects,
	ompMemoryFiles: h.ompMemoryFiles,
	ompMemoryRead: h.ompMemoryRead,
	mcpCatalog: h.mcpCatalog,
	ompUpdateCheck: h.ompUpdateCheck,
	ompUpdateRun: h.ompUpdateRun,
	ompInfo: h.ompInfo,
	mcpServerSave: vi.fn(),
	mcpServerSetScope: vi.fn(),
	mcpServerSetEnabled: vi.fn(),
	mcpServerDelete: vi.fn(),
}));
vi.mock("<repo>/src/features/settings/OmpSettingsList", () => ({ OmpSections: () => null }));
vi.mock("@uiw/react-codemirror", () => ({
	default: ({ value, onChange, editable }: { value: string; onChange: (v: string) => void; editable?: boolean }) => (
		<textarea data-testid="cm" value={value} disabled={editable === false} onChange={(e) => onChange(e.target.value)} />
	),
	EditorView: { lineWrapping: {} },
}));

import { FileEditor } from "<repo>/src/features/settings/FileEditor";
import { MemoryFilesPanel } from "<repo>/src/features/settings/sections/MemoryFilesPanel";
import { McpSection } from "<repo>/src/features/settings/McpSection";
import { PluginsSection } from "<repo>/src/features/settings/PluginsSection";
import { useSkillsStore } from "<repo>/src/features/skills/store";
import { DEFAULT_SKILL_CONFIG } from "<repo>/src/lib/skillEnablement";
import { useOmpUpdate } from "<repo>/src/stores/ompUpdate";
import { useOmpInstall } from "<repo>/src/stores/ompInstall";
import { useSessions } from "<repo>/src/stores/sessions";

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((a, b) => {
		resolve = a;
		reject = b;
	});
	return { promise, resolve, reject };
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

afterEach(cleanup);

describe("FileEditorBuffer", () => {
	it("TypedTextKept (type while save in flight): text typed after clicking 保存 is still in the editor once the save returns", async () => {
		const save = deferred<string | null>();
		const load = () => Promise.resolve({ content: "v1", stamp: "1" });
		render(<FileEditor fileKey="replay:save" path="/h/a.md" load={load} save={() => save.promise} />);
		const cm = (await screen.findByTestId("cm")) as HTMLTextAreaElement;
		fireEvent.change(cm, { target: { value: "v2" } });
		fireEvent.click(screen.getByRole("button", { name: /^保存/ }));
		await flush();
		// the editor stays editable while saving (editable={!readOnly})
		expect(cm.disabled).toBe(false);
		fireEvent.change(cm, { target: { value: "v2 + typed during save" } });
		save.resolve("2");
		await flush();
		expect(cm.value).toBe("v2 + typed during save");
	});

	it("TypedTextKept (type while reload in flight): text typed after clicking 重新读取 survives the read result", async () => {
		const second = deferred<{ content: string; stamp: string }>();
		let n = 0;
		const load = () => (++n === 1 ? Promise.resolve({ content: "v1", stamp: "1" }) : second.promise);
		render(<FileEditor fileKey="replay:reload" path="/h/a.md" load={load} save={() => Promise.resolve("2")} />);
		const cm = (await screen.findByTestId("cm")) as HTMLTextAreaElement;
		fireEvent.click(screen.getByRole("button", { name: "从磁盘重新读取" }));
		await flush();
		fireEvent.change(cm, { target: { value: "typed while reloading" } });
		second.resolve({ content: "v1", stamp: "1" });
		await flush();
		expect(cm.value).toBe("typed while reloading");
	});
});

const plugin = (name: string) => ({ name, spec: null, version: null, description: null, hasManifest: true, kind: "npm", scope: "user", enabled: true, projectDisabled: false, enabledFeatures: null, dir: null });

describe("PluginsCatalogLoad", () => {
	it("PluginsMatchProject: after switching project, the late answer of the old project does not replace the new project's list", async () => {
		const a = deferred<unknown>();
		const b = deferred<unknown>();
		h.pluginsList.mockImplementation((cwd: string) => (cwd === "/proj-a" ? a.promise : b.promise));
		h.skillsList.mockResolvedValue({ skills: [], extensions: [] });
		const { rerender } = render(<PluginsSection cwd="/proj-a" />);
		rerender(<PluginsSection cwd="/proj-b" />);
		await flush();
		b.resolve({ roots: [], plugins: [plugin("plugin-of-b")] });
		await flush();
		a.resolve({ roots: [], plugins: [plugin("plugin-of-a")] });
		await flush();
		expect(screen.queryByText("plugin-of-a")).toBeNull();
		expect(screen.getByText("plugin-of-b")).toBeTruthy();
	});
});

describe("MemoryFilesLoad", () => {
	it("MemoryListMatchesProject: a late file list of the previous memory project is not shown under the newly selected one", async () => {
		const filesOf: Record<string, ReturnType<typeof deferred<unknown>>> = { p1: deferred(), p2: deferred() };
		h.ompMemoryProjects.mockResolvedValue(["p1", "p2"]);
		let phase1 = true;
		h.ompMemoryFiles.mockImplementation((slug: string) => {
			if (phase1) return Promise.resolve([{ rel: "MEMORY.md", editable: true }]); // initial project filter
			return filesOf[slug].promise;
		});
		h.ompMemoryRead.mockResolvedValue({ content: "x", stamp: "1" });
		render(<MemoryFilesPanel />);
		await flush();
		phase1 = false;
		const select = (await screen.findAllByRole("combobox"))[0] as HTMLSelectElement;
		// first selection initialised by the panel (default project) issues a files request for it
		fireEvent.change(select, { target: { value: select.options[select.options.length - 1].value } });
		await flush();
		fireEvent.change(select, { target: { value: select.options[0].value } });
		await flush();
		const calls = h.ompMemoryFiles.mock.calls.map((c) => c[0]);
		expect(calls.length).toBeGreaterThanOrEqual(2);
		// Resolve the LAST-issued (current project) request first, then the older ones
		const current = select.value;
		filesOf[current].resolve([{ rel: "skills/current-only/SKILL.md", editable: true }]);
		await flush();
		const other = current === "p1" ? "p2" : "p1";
		filesOf[other].resolve([{ rel: "skills/other-project/SKILL.md", editable: true }]);
		await flush();
		expect(screen.queryByText("other-project")).toBeNull();
	});
});

const cfgList = (value: string[]) => ({ found: true, error: null, entries: [{ key: "disabledExtensions", value }] });

describe("OmpListToggles", () => {
	beforeEach(() => {
		h.ompConfigList.mockReset();
		h.ompConfigSet.mockReset().mockResolvedValue(undefined);
		h.extensionEnableFile.mockReset();
		h.skillsList.mockReset();
		h.ompProjectConfigRead.mockReset().mockResolvedValue({ exists: false, content: "", path: "" });
	});

	it("OtherEntriesKept: disabling a skill when `omp config list` fails (found=false) does not overwrite the saved disabled list", async () => {
		h.ompConfigList.mockResolvedValue({ found: false, error: "boom", entries: [] });
		const skill = { name: "new-one", path: "/s/new-one/SKILL.md", dir: "/s/new-one" } as never;
		useSkillsStore.setState({ skillConfig: DEFAULT_SKILL_CONFIG, skillConfigOverrides: [] });
		await useSkillsStore.getState().setSkillEnabled(skill, false);
		// user already had `skill:existing` disabled; a write based on an unreadable list would drop it
		const writes = h.ompConfigSet.mock.calls.filter((c) => c[0] === "disabledExtensions");
		expect(writes).toEqual([]);
	});

	it("UiMatchesConfigAfterFailure: enabling a .disabled extension whose rename fails leaves the config consistent with the UI", async () => {
		let stored = ["ext-a"];
		h.ompConfigList.mockImplementation(() => Promise.resolve(cfgList(stored)));
		h.ompConfigSet.mockImplementation((_k: string, v: string) => {
			stored = JSON.parse(v);
			return Promise.resolve();
		});
		h.extensionEnableFile.mockRejectedValue(new Error("rename failed"));
		const ext = { name: "ext-a", path: "/e/ext-a.ts.disabled", source: "user", enabled: false };
		useSkillsStore.setState({
			catalog: { skills: [], extensions: [ext] } as never,
			skillConfig: { ...DEFAULT_SKILL_CONFIG, disabledExtensions: ["ext-a"] },
			skillConfigOverrides: [],
		});
		await useSkillsStore.getState().setExtensionEnabled(ext as never, true, "/p");
		const uiSaysEnabled = useSkillsStore.getState().catalog?.extensions[0].enabled;
		const configSaysDisabled = stored.includes("ext-a");
		// UI rolled back to "disabled"; config on disk must still say disabled
		expect(uiSaysEnabled).toBe(false);
		expect(configSaysDisabled).toBe(true);
	});
});

describe("OmpInstallCancel", () => {
	it("CancelHonored: a cancel click made before the installer has been registered by the backend is not lost", async () => {
		// Fake backend = omp_install.rs semantics: cancel on an idle slot is a no-op (omp_install.rs:366-374);
		// the run command registers the slot and finishes successfully unless cancelled meanwhile.
		let slotActive = false;
		let cancelled = false;
		const listenGate = deferred<() => void>();
		const runGate = deferred<void>();
		h.invoke.mockImplementation((cmd: string) => {
			if (cmd === "__listen") return listenGate.promise;
			if (cmd === "omp_install_run") {
				slotActive = true;
				return runGate.promise.then(() => ({ success: !cancelled, output: cancelled ? "已取消" : "ok", info: { found: true, resolvedPath: "/x/omp", version: null, agentDir: "", configPath: "", configExists: false } }));
			}
			if (cmd === "omp_install_cancel") {
				if (slotActive) cancelled = true;
				return Promise.resolve();
			}
			return Promise.resolve(null);
		});
		const store = useOmpInstall;
		const started = store.getState().start();
		await flush();
		expect(store.getState().phase).toBe("running");
		await store.getState().cancel(); // user clicks 取消 while the event listener is still being attached
		listenGate.resolve(() => {});
		await flush();
		runGate.resolve();
		await started;
		expect(store.getState().phase).not.toBe("success");
	});
});

describe("McpEditorDialog", () => {
	it("EditorVisibleWhenOpen: reloading the catalog after the edited server vanished does not leave a hidden, still-open editor", async () => {
		const server = (name: string) => ({
			name,
			definition: { name, transport: "stdio", command: "npx", args: [], url: null, cwd: null, timeoutMs: null, instructions: true, enabled: true, shadowed: false, denylisted: false, allowlisted: false, env: [], headers: [], hasAuth: false, hasOauth: false, sourceFile: "/g/mcp.json", scope: "user", error: null },
			mode: "all", activeProjects: [], excludedProjects: [], copyProjects: [], customProjects: [], hasGlobal: true, denylisted: false, files: ["/g/mcp.json"],
		});
		const cat = (names: string[]) => ({ globalPath: "/g/mcp.json", projects: [], servers: names.map(server), files: [] });
		h.mcpCatalog.mockReset().mockResolvedValueOnce(cat(["fs"])).mockResolvedValue(cat([]));
		useSessions.setState({ workspaces: [] });
		render(<McpSection cwd={null} />);
		await screen.findByText("fs");
		fireEvent.click(screen.getByRole("button", { name: "编辑 fs" }));
		await flush();
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();
		// externally the server is removed; project list changes or user presses reload -> catalog re-read
		fireEvent.click(screen.getByRole("button", { name: "重新读取配置文件" }));
		await flush();
		// A user's open editor must not silently vanish just because the catalog was re-read
		expect(document.querySelector('[role="dialog"]')).not.toBeNull();
	});
});

describe("OmpUpdateCheck", () => {
	it("NoStaleUpdateBadge: a check that started before a successful update must not leave the 'update available' status after it", async () => {
		const oldCheck = deferred<unknown>();
		const info = { found: true, resolvedPath: "/x/omp", version: "omp/2.0.0", agentDir: "", configPath: "", configExists: false };
		h.ompInfo.mockResolvedValue(info);
		let calls = 0;
		h.ompUpdateCheck.mockImplementation(() => {
			calls += 1;
			return calls === 1
				? oldCheck.promise
				: Promise.resolve({ updateAvailable: false, current: "2.0.0", latest: "2.0.0", output: "up to date" });
		});
		h.ompUpdateRun.mockResolvedValue({ success: true, output: "updated", versionAfter: "2.0.0" });
		const store = useOmpUpdate;
		const check = store.getState().check(true); // periodic/manual check begins against the old binary
		await store.getState().runUpdate(); // update completes; its own re-check returns early because a check is in flight
		oldCheck.resolve({ updateAvailable: true, current: "1.0.0", latest: "2.0.0", output: "update available" });
		await check;
		await flush();
		expect(store.getState().status?.updateAvailable ?? false).toBe(false);
	});
});
