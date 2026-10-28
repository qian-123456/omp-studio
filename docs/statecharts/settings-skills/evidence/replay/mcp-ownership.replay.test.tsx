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
 mcpServerSave: vi.fn(),
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
	mcpServerSave: h.mcpServerSave,
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

describe("McpWriteOwnership", () => {
 it("SingleWriter: closing a saving child must not permit a second in-flight write through the empty-catalog action", async () => {
  h.mcpCatalog.mockResolvedValue({globalPath:"/g/mcp.json",projects:[],servers:[],files:[]});
  h.mcpServerSave.mockImplementation(() => new Promise(() => {}));
  useSessions.setState({workspaces:[]});
  render(<McpSection cwd={null}/>);
  await waitFor(()=>expect(screen.getAllByRole("button",{name:"添加服务器"})).toHaveLength(2));
  async function openAndSave(name:string) {
   const buttons=screen.getAllByRole("button",{name:"添加服务器"}) as HTMLButtonElement[];
   const enabled=buttons.find(b=>!b.disabled)!;
   expect(enabled).toBeTruthy();
   fireEvent.click(enabled);
   const dialog=screen.getByRole("dialog");
   const inputs=dialog.querySelectorAll("input");
   fireEvent.change(inputs[0]!,{target:{value:name}});
   fireEvent.change(inputs[1]!,{target:{value:"npx"}});
   fireEvent.click(screen.getByRole("button",{name:"保存"}));
   await flush();
  }
  await openAndSave("first");
  expect(h.mcpServerSave).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button",{name:"取消"}));
  await flush();
  expect(screen.queryByRole("dialog")).toBeNull();
  await openAndSave("second");
  // Desired invariant. Two unresolved IPC saves means violation reproduced, not acceptance failure.
  expect(h.mcpServerSave).toHaveBeenCalledTimes(1);
 });
});
