// @vitest-environment jsdom
/**
 * Settings ▸ MCP 服务器: catalog-driven list, per-server project placement, editor,
 * scope dialog and import dialog.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpCatalog, McpServerItem, McpServerView } from "../../lib/contracts";

const ipc = vi.hoisted(() => ({
	mcpCatalog: vi.fn(),
	mcpServerSave: vi.fn(),
	mcpServerSetScope: vi.fn(),
	mcpServerSetEnabled: vi.fn(),
	mcpServerDelete: vi.fn(),
}));
const confirm = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn() }));
vi.mock("../../lib/dialogs", () => ({
	confirmDialog: confirm,
	errMsg: (e: unknown) => String(e),
}));
vi.mock("../../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../../lib/ipc", () => ipc);
vi.mock("./OmpSettingsList", () => ({
	OmpSections: ({ page }: { page: string }) => <div data-testid="omp-sections" data-page={page} />,
}));

import { useSessions } from "../../stores/sessions";
import { McpSection } from "./McpSection";

const DEMO = "/home/user/projects/demo";
const OTHER = "/home/user/projects/other";
const GLOBAL_FILE = "/home/user/.omp/agent/mcp.json";

function item(name: string, over: Partial<McpServerItem> = {}): McpServerItem {
	return {
		name,
		transport: "stdio",
		command: "npx",
		args: ["-y", name],
		url: null,
		cwd: null,
		timeoutMs: null,
		instructions: true,
		enabled: true,
		shadowed: false,
		denylisted: false,
		allowlisted: false,
		env: [],
		headers: [],
		hasAuth: false,
		hasOauth: false,
		sourceFile: GLOBAL_FILE,
		scope: "user",
		error: null,
		...over,
	};
}

function view(name: string, over: Partial<McpServerView> = {}): McpServerView {
	return {
		name,
		definition: item(name),
		mode: "all",
		activeProjects: [DEMO, OTHER],
		excludedProjects: [],
		copyProjects: [],
		customProjects: [],
		hasGlobal: true,
		denylisted: false,
		files: [GLOBAL_FILE],
		...over,
	};
}

const CATALOG: McpCatalog = {
	globalPath: GLOBAL_FILE,
	projects: [
		{ path: DEMO, configPath: `${DEMO}/.omp/mcp.json`, worktrees: [`${DEMO}/.worktrees/a`] },
		{ path: OTHER, configPath: `${OTHER}/.omp/mcp.json`, worktrees: [] },
	],
	servers: [
		view("rea", { activeProjects: [DEMO], excludedProjects: [OTHER] }),
		view("fs", {
			mode: "projects",
			hasGlobal: false,
			activeProjects: [OTHER],
			copyProjects: [OTHER],
			customProjects: [OTHER],
		}),
		view("idle", {
			mode: "off",
			hasGlobal: false,
			activeProjects: [],
			copyProjects: [DEMO, OTHER],
		}),
		view("wide", { activeProjects: [OTHER], excludedProjects: [DEMO] }),
	],
	files: [
		{
			path: GLOBAL_FILE,
			scope: "user",
			project: null,
			exists: true,
			parseError: null,
			disabledServers: [],
			enabledServers: [],
		},
		{
			path: `${OTHER}/.omp/mcp.json`,
			scope: "project",
			project: OTHER,
			exists: true,
			parseError: "Unexpected token } at line 3",
			disabledServers: [],
			enabledServers: [],
		},
	],
};

const ws = (id: string, name: string, path: string, mode = "code") =>
	({ id, name, path, kind: "project", sort: 0, mode }) as never;

beforeEach(() => {
	for (const fn of Object.values(ipc)) fn.mockReset();
	ipc.mcpCatalog.mockResolvedValue(CATALOG);
	for (const fn of [ipc.mcpServerSave, ipc.mcpServerSetScope, ipc.mcpServerSetEnabled, ipc.mcpServerDelete])
		fn.mockResolvedValue(undefined);
	confirm.mockReset();
	useSessions.setState({
		workspaces: [
			ws("ws-1", "demo", DEMO),
			ws("ws-1b", "demo", DEMO, "chat"),
			ws("ws-2", "other", OTHER),
			{ id: "g", name: "全局", path: "/home/user", kind: "global", sort: 0, mode: "code" } as never,
		],
	});
});

afterEach(cleanup);

const row = (name: string) => document.querySelector(`[data-mcp-server="${name}"]`) as HTMLElement;
const placement = (name: string) => within(row(name)).getByTestId("mcp-placement").textContent;

describe("McpSection projects", () => {
	it("requests the catalog with deduped project paths, adding a cwd outside every workspace", async () => {
		render(<McpSection cwd="/tmp/outside" />);
		await screen.findByText("rea");
		expect(ipc.mcpCatalog).toHaveBeenCalledWith([DEMO, OTHER, "/tmp/outside"]);
		expect(screen.getByText(/当前项目「outside」的新会话会加载 0 个服务器/)).toBeDefined();
	});

	it("maps a worktree cwd to its project", async () => {
		render(<McpSection cwd={`${DEMO}/.worktrees/a`} />);
		await screen.findByText("rea");
		expect(ipc.mcpCatalog).toHaveBeenCalledWith([DEMO, OTHER]);
		// rea (demo active) + wide? wide excludes demo; fs/idle not active → 1
		expect(screen.getByText(/当前项目「demo」的新会话会加载 1 个服务器/)).toBeDefined();
	});

	it("filters to the current project", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(screen.getByRole("radio", { name: "只看当前项目" }));
		expect(row("rea")).not.toBeNull();
		expect(row("fs")).toBeNull();
	});

	it("shows broken config files with the full error", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		expect(screen.getByText("Unexpected token } at line 3")).toBeDefined();
		expect(screen.getAllByText(`${OTHER}/.omp/mcp.json`).length).toBeGreaterThan(0);
		expect(screen.getByRole("button", { name: "打开文件" })).toBeDefined();
	});
});

describe("McpSection placement", () => {
	it("describes all / projects / off modes", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		expect(placement("rea")).toBe("用在：所有项目除了other");
		expect(placement("fs")).toContain("other");
		expect(placement("fs")).toContain("单独配置");
		expect(placement("idle")).toContain("暂未使用");
		expect(placement("idle")).toContain("之前用在：demo、other");
	});

	it("toggles pause/resume through mcpServerSetEnabled", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("idle");
		fireEvent.click(within(row("idle")).getByRole("switch"));
		await waitFor(() =>
			expect(ipc.mcpServerSetEnabled).toHaveBeenCalledWith([DEMO, OTHER], "idle", true),
		);
		await waitFor(() => expect(ipc.mcpCatalog).toHaveBeenCalledTimes(2));
	});
});

describe("McpSection scope dialog", () => {
	it("saves the exact scope for mode all (unchecked project stays out)", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(within(row("rea")).getByRole("button", { name: "选择项目" }));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByText("“rea” 用在哪些项目")).toBeDefined();
		expect(within(dialog).getByText("含 1 个工作树")).toBeDefined();
		expect((within(dialog).getByRole("checkbox", { name: "demo" }) as HTMLInputElement).checked).toBe(true);
		expect((within(dialog).getByRole("checkbox", { name: "other" }) as HTMLInputElement).checked).toBe(false);
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
		await waitFor(() =>
			expect(ipc.mcpServerSetScope).toHaveBeenCalledWith([DEMO, OTHER], "rea", {
				allProjects: true,
				projects: [DEMO],
			}),
		);
	});

	it("saves selected projects and blocks an empty selection", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("fs");
		fireEvent.click(within(row("fs")).getByRole("button", { name: "选择项目" }));
		const dialog = await screen.findByRole("dialog");
		const save = within(dialog).getByRole("button", { name: "保存" }) as HTMLButtonElement;

		fireEvent.click(within(dialog).getByRole("checkbox", { name: "other" }));
		expect(within(dialog).getByText("请至少选择一个项目")).toBeDefined();
		expect(save.disabled).toBe(true);

		fireEvent.click(within(dialog).getByRole("checkbox", { name: "demo" }));
		expect(save.disabled).toBe(false);
		fireEvent.click(save);
		await waitFor(() =>
			expect(ipc.mcpServerSetScope).toHaveBeenCalledWith([DEMO, OTHER], "fs", {
				allProjects: false,
				projects: [DEMO],
			}),
		);
	});

	it("加到当前项目 sends the right scope per mode", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("fs");
		// mode projects: active ∪ current
		fireEvent.click(within(row("fs")).getByRole("button", { name: "加到当前项目" }));
		await waitFor(() =>
			expect(ipc.mcpServerSetScope).toHaveBeenLastCalledWith([DEMO, OTHER], "fs", {
				allProjects: false,
				projects: [DEMO, OTHER],
			}),
		);
		// mode all: drop the current project from the exclusions
		await waitFor(() => expect((row("wide").querySelector("button:disabled")) === null).toBe(true));
		fireEvent.click(within(row("wide")).getByRole("button", { name: "加到当前项目" }));
		await waitFor(() =>
			expect(ipc.mcpServerSetScope).toHaveBeenLastCalledWith([DEMO, OTHER], "wide", {
				allProjects: true,
				projects: [DEMO, OTHER],
			}),
		);
		// mode off: remembered copies ∪ current
		await waitFor(() => expect((row("idle").querySelector("button:disabled")) === null).toBe(true));
		fireEvent.click(within(row("idle")).getByRole("button", { name: "加到当前项目" }));
		await waitFor(() =>
			expect(ipc.mcpServerSetScope).toHaveBeenLastCalledWith([DEMO, OTHER], "idle", {
				allProjects: false,
				projects: [DEMO, OTHER],
			}),
		);
		// already active in the current project: no shortcut
		expect(within(row("rea")).queryByRole("button", { name: "加到当前项目" })).toBeNull();
	});
});

describe("McpSection editor", () => {
	const fill = async (dialog: HTMLElement) => {
		fireEvent.change(within(dialog).getByPlaceholderText("例如 filesystem"), { target: { value: "newsrv" } });
		fireEvent.change(within(dialog).getByPlaceholderText("npx"), { target: { value: "node" } });
	};

	it("defaults a new server to only the current project", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByRole("radio", { name: /^只在选中的项目/ }).getAttribute("aria-checked")).toBe("true");
		expect((within(dialog).getByRole("checkbox", { name: "demo" }) as HTMLInputElement).checked).toBe(true);
		await fill(dialog);
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
		await waitFor(() =>
			expect(ipc.mcpServerSave).toHaveBeenCalledWith(
				[DEMO, OTHER],
				null,
				"newsrv",
				expect.objectContaining({ command: "node", type: "stdio" }),
				{ allProjects: false, projects: [DEMO] },
			),
		);
	});

	it("defaults a new server to all projects without a current project", async () => {
		render(<McpSection cwd={null} />);
		await screen.findByText("rea");
		fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
		const dialog = await screen.findByRole("dialog");
		expect(within(dialog).getByRole("radio", { name: /^所有项目/ }).getAttribute("aria-checked")).toBe("true");
		await fill(dialog);
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
		await waitFor(() =>
			expect(ipc.mcpServerSave).toHaveBeenCalledWith(
				[DEMO, OTHER],
				null,
				"newsrv",
				expect.anything(),
				{ allProjects: true, projects: [DEMO, OTHER] },
			),
		);
	});

	it("rejects a name already used in the catalog and keeps the dialog on backend failure", async () => {
		ipc.mcpServerSave.mockRejectedValueOnce("磁盘已满");
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByPlaceholderText("例如 filesystem"), { target: { value: "fs" } });
		fireEvent.change(within(dialog).getByPlaceholderText("npx"), { target: { value: "node" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
		expect(await within(dialog).findByText("已存在同名服务器「fs」")).toBeDefined();
		expect(ipc.mcpServerSave).not.toHaveBeenCalled();

		fireEvent.change(within(dialog).getByPlaceholderText("例如 filesystem"), { target: { value: "fresh" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
		expect(await within(dialog).findByText("磁盘已满")).toBeDefined();
		expect(screen.getByRole("dialog")).toBeDefined();
	});

	it("splits a whole command line on blur and only sends scope when it changed", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(within(row("rea")).getByRole("button", { name: "编辑 rea" }));
		const dialog = await screen.findByRole("dialog");
		const command = within(dialog).getByPlaceholderText("npx") as HTMLInputElement;
		fireEvent.change(command, { target: { value: 'npx -y @scope/pkg --flag "a b"' } });
		// args are already set for rea, so nothing is split
		fireEvent.blur(command);
		expect(command.value).toBe('npx -y @scope/pkg --flag "a b"');
		fireEvent.change(command, { target: { value: "npx" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));
		await waitFor(() =>
			expect(ipc.mcpServerSave).toHaveBeenCalledWith([DEMO, OTHER], "rea", "rea", expect.anything(), null),
		);
	});

	it("moves a pasted command line into the arguments", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(screen.getByRole("button", { name: "添加服务器" }));
		const dialog = await screen.findByRole("dialog");
		const command = within(dialog).getByPlaceholderText("npx") as HTMLInputElement;
		fireEvent.change(command, { target: { value: 'npx -y @scope/pkg --flag "a b"' } });
		fireEvent.blur(command);
		expect(command.value).toBe("npx");
		const args = within(dialog).getByPlaceholderText(/-y/) as HTMLTextAreaElement;
		expect(args.value).toBe("-y\n@scope/pkg\n--flag\na b");
		expect(within(dialog).getByText(/已把整行命令拆成/)).toBeDefined();
	});
});

describe("McpSection import", () => {
	it("previews, skips duplicates and saves the rest with the chosen scope", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(screen.getByRole("button", { name: "导入配置" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByRole("textbox"), {
			target: {
				value: `{ // comment
				"mcpServers": { "rea": {"command": "x"}, "newone": {"command": "npx", "args": ["-y","p"], "enabled": false,}, "bad name": {"command":"x"}, "empty": {} } }`,
			},
		});
		expect(within(dialog).getByText("将跳过：名称已存在")).toBeDefined();
		expect(within(dialog).getByText("将跳过：名称不合法")).toBeDefined();
		expect(within(dialog).getByText("将跳过：缺少命令或地址")).toBeDefined();
		fireEvent.click(within(dialog).getByRole("button", { name: "导入 1 个" }));
		await waitFor(() =>
			expect(ipc.mcpServerSave).toHaveBeenCalledWith(
				[DEMO, OTHER],
				null,
				"newone",
				{ command: "npx", args: ["-y", "p"] },
				{ allProjects: false, projects: [DEMO] },
			),
		);
	});

	it("asks for a name when a single entry is pasted and keeps failures listed", async () => {
		ipc.mcpServerSave.mockRejectedValueOnce("写入失败");
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(screen.getByRole("button", { name: "导入配置" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: '{"url":"https://x/mcp"}' } });
		const go = within(dialog).getByRole("button", { name: "导入 0 个" }) as HTMLButtonElement;
		expect(go.disabled).toBe(true);
		fireEvent.change(within(dialog).getByPlaceholderText("例如 filesystem"), { target: { value: "remote" } });
		fireEvent.click(within(dialog).getByRole("button", { name: "导入 1 个" }));
		expect(await within(dialog).findByText(/导入失败：写入失败/)).toBeDefined();
	});
});

describe("McpSection delete", () => {
	it("confirms with where it will be removed from, then deletes", async () => {
		confirm.mockResolvedValue(true);
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("fs");
		fireEvent.click(within(row("fs")).getByRole("button", { name: "删除 fs" }));
		await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
		expect(String(confirm.mock.calls[0]![0])).toContain("项目 other");
		expect(confirm.mock.calls[0]![1]).toMatchObject({ danger: true, okLabel: "删除" });
		await waitFor(() => expect(ipc.mcpServerDelete).toHaveBeenCalledWith([DEMO, OTHER], "fs"));
	});

	it("renders the mcp omp sections", async () => {
		render(<McpSection cwd={DEMO} />);
		expect((await screen.findByTestId("omp-sections")).getAttribute("data-page")).toBe("mcp");
	});
});

function pending<T>() {
	// The project's ES2021 lib does not expose Promise.withResolvers.
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}

describe("MCP editor and parent write ownership", () => {
	it("preserves the open editor and draft with an explanation after external deletion", async () => {
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(within(row("rea")).getByRole("button", { name: "编辑 rea" }));
		const editor = await screen.findByRole("dialog");
		const command = within(editor).getByPlaceholderText("npx") as HTMLInputElement;
		fireEvent.change(command, { target: { value: "my-unsaved-command" } });
		ipc.mcpCatalog.mockResolvedValueOnce({ ...CATALOG, servers: CATALOG.servers.filter((s) => s.name !== "rea") });
		fireEvent.click(screen.getByRole("button", { name: "重新读取配置文件" }));
		expect((await within(editor).findByRole("alert")).textContent).toContain("此服务器已被外部删除");
		expect(screen.getByRole("dialog")).toBe(editor);
		expect(command.value).toBe("my-unsaved-command");
		expect((within(editor).getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
		fireEvent.keyDown(command, { key: "Enter", ctrlKey: true });
		expect(ipc.mcpServerSave).not.toHaveBeenCalled();

		// Reappearing data does not silently replace the draft or remount the editor.
		fireEvent.click(screen.getByRole("button", { name: "重新读取配置文件" }));
		await waitFor(() => expect(within(editor).queryByRole("alert")).toBeNull());
		expect(command.value).toBe("my-unsaved-command");
		expect((within(editor).getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(false);
		fireEvent.click(within(editor).getByRole("button", { name: "取消" }));
		fireEvent.click(screen.getByRole("button", { name: "重新读取配置文件" }));
		await waitFor(() => expect(ipc.mcpCatalog).toHaveBeenCalledTimes(4));
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	it("keeps empty-list add and import disabled after closing a saving editor until its reload finishes", async () => {
		const empty = { ...CATALOG, servers: [] };
		ipc.mcpCatalog.mockResolvedValue(empty);
		const save = pending<void>();
		const reload = pending<McpCatalog>();
		ipc.mcpServerSave.mockReturnValueOnce(save.promise);
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("还没有配置 MCP 服务器");
		fireEvent.click(screen.getAllByRole("button", { name: "添加服务器" })[1]!);
		const editor = await screen.findByRole("dialog");
		fireEvent.change(within(editor).getByPlaceholderText("例如 filesystem"), { target: { value: "first" } });
		fireEvent.change(within(editor).getByPlaceholderText("npx"), { target: { value: "node" } });
		fireEvent.click(within(editor).getByRole("button", { name: "保存" }));
		await waitFor(() => expect(ipc.mcpServerSave).toHaveBeenCalledTimes(1));
		fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
		expect(screen.queryByRole("dialog")).toBeNull();
		const assertLocked = () => {
			for (const name of ["添加服务器", "导入配置"]) {
				for (const button of screen.getAllByRole("button", { name })) {
					expect((button as HTMLButtonElement).disabled).toBe(true);
					fireEvent.click(button);
				}
			}
			expect(screen.queryByRole("dialog")).toBeNull();
			expect(ipc.mcpServerSave).toHaveBeenCalledTimes(1);
		};
		assertLocked();
		ipc.mcpCatalog.mockReturnValueOnce(reload.promise);
		await act(async () => save.resolve());
		assertLocked();
		await act(async () => reload.resolve(empty));
		await waitFor(() => expect((screen.getAllByRole("button", { name: "添加服务器" })[1] as HTMLButtonElement).disabled).toBe(false));
		fireEvent.click(screen.getAllByRole("button", { name: "添加服务器" })[1]!);
		expect(await screen.findByRole("dialog")).toBeDefined();
	});

	it("holds parent ownership across every import entry and closing the import dialog", async () => {
		ipc.mcpCatalog.mockResolvedValue({ ...CATALOG, servers: [] });
		const first = pending<void>();
		const second = pending<void>();
		ipc.mcpServerSave.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("还没有配置 MCP 服务器");
		fireEvent.click(screen.getAllByRole("button", { name: "导入配置" })[1]!);
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: '{"mcpServers":{"one":{"command":"node"},"two":{"command":"node"}}}' } });
		fireEvent.click(within(dialog).getByRole("button", { name: "导入 2 个" }));
		await waitFor(() => expect(ipc.mcpServerSave).toHaveBeenCalledTimes(1));
		fireEvent.click(within(dialog).getAllByRole("button", { name: "关闭" })[0]!);
		for (const button of screen.getAllByRole("button", { name: "添加服务器" })) expect((button as HTMLButtonElement).disabled).toBe(true);
		await act(async () => first.resolve());
		await waitFor(() => expect(ipc.mcpServerSave).toHaveBeenCalledTimes(2));
		for (const name of ["添加服务器", "导入配置"]) {
			for (const button of screen.getAllByRole("button", { name })) {
				expect((button as HTMLButtonElement).disabled).toBe(true);
				fireEvent.click(button);
			}
		}
		expect(screen.queryByRole("dialog")).toBeNull();
		await act(async () => second.resolve());
		await waitFor(() => expect((screen.getAllByRole("button", { name: "导入配置" })[1] as HTMLButtonElement).disabled).toBe(false));
	});

	it("does not issue duplicate writes for same-batch keyboard submits", async () => {
		const save = pending<void>();
		ipc.mcpServerSave.mockReturnValueOnce(save.promise);
		render(<McpSection cwd={DEMO} />);
		await screen.findByText("rea");
		fireEvent.click(within(row("rea")).getByRole("button", { name: "编辑 rea" }));
		const dialog = await screen.findByRole("dialog");
		const command = within(dialog).getByPlaceholderText("npx");
		act(() => {
			fireEvent.keyDown(command, { key: "Enter", ctrlKey: true });
			fireEvent.keyDown(command, { key: "Enter", ctrlKey: true });
		});
		expect(ipc.mcpServerSave).toHaveBeenCalledTimes(1);
		expect((within(dialog).getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled).toBe(true);
		await act(async () => save.resolve());
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
});
