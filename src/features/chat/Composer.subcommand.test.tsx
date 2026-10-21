// @vitest-environment jsdom
/**
 * End-to-end proof for the composer's slash subcommand behaviour, driving the
 * real <Composer/> in jsdom. Only the Tauri transport and the privacy event
 * plumbing are stubbed; every chip / menu / serialization assertion below is
 * against rendered DOM.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import type * as EventsModule from "../../lib/events";
import { emptySessionLive, useLive } from "../../stores/live";
import { useComposer } from "../../stores/composer";
import { Composer } from "./Composer";

const SESSION = "s1";

const h = vi.hoisted(() => ({
	rpcSend: vi.fn(async (_sessionId: string, _command: unknown) => ({}) as Record<string, unknown>),
	mcpConfigList: vi.fn(async (_cwd?: string | null) => ({ servers: [] }) as unknown),
	pluginsList: vi.fn(async (_cwd?: string | null) => ({ roots: [], plugins: [] }) as unknown),
}));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		rpcSend: h.rpcSend,
		rpcEnsureLive: vi.fn(async () => ({ sessionId: SESSION })),
		sessionUsage: vi.fn(async () => ({ available: false, tokens: 0 })),
		sessionSnapshot: vi.fn(async () => ({})),
		listWorkspaceFiles: vi.fn(async () => []),
		listModels: vi.fn(async () => []),
		listSessions: vi.fn(async () => []),
		listWorkspaces: vi.fn(async () => []),
		getSettings: vi.fn(async () => null),
		privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "missing", nativeError: null })),
		privacySessionEntryIds: vi.fn(async () => []),
		mcpConfigList: h.mcpConfigList,
		pluginsList: h.pluginsList,
	};
});

// No webview in jsdom: getCurrentWebview() reads __TAURI_INTERNALS__ eagerly.
vi.mock("@tauri-apps/api/webview", () => ({
	getCurrentWebview: () => ({ onDragDropEvent: () => Promise.resolve(() => {}) }),
}));
// Stores subscribe to backend events at load; a rejected listen() is noise here.
vi.mock("../../lib/events", async (importOriginal) => {
	const orig = await importOriginal<typeof EventsModule>();
	return { ...orig, onPrivacyChanged: async () => () => {} };
});
vi.mock("../../stores/modelCatalog", () => ({
	useModelOptions: () => null,
	useModelCatalog: Object.assign(vi.fn(() => null), {
		getState: () => ({ models: [], refresh: () => Promise.resolve() }),
	}),
}));
vi.mock("../../components/ModelSelect", () => ({
	ModelMenuContent: () => <div data-testid="model-menu" />,
}));

beforeAll(() => {
	class RO {
		observe() {}
		unobserve() {}
		disconnect() {}
	}
	vi.stubGlobal("ResizeObserver", RO);
	// jsdom has none; SlashMenu keeps the active row visible.
	Element.prototype.scrollIntoView = () => {};
});

function mount(): void {
	render(<Composer sessionId={SESSION} />);
}

/** omp's live catalog entry for /mcp (subcommands only ever come from here). */
const MCP_CATALOG = {
	name: "mcp",
	description: "Manage MCP servers",
	hint: "<subcommand>",
	source: "builtin",
	subcommands: [
		"add",
		"list",
		"remove",
		"test",
		"reauth",
		"unauth",
		"enable",
		"disable",
		"smithery-search",
		"smithery-login",
		"smithery-logout",
		"reconnect",
		"reload",
		"resources",
		"prompts",
		"notifications",
		"help",
	].map((name) => ({ name, ...(name === "enable" || name === "disable" ? { usage: "<name>" } : {}) })),
};

beforeEach(() => {
	localStorage.clear();
	h.rpcSend.mockClear();
	h.mcpConfigList.mockReset();
	h.mcpConfigList.mockResolvedValue({ servers: [] });
	h.pluginsList.mockReset();
	h.pluginsList.mockResolvedValue({ roots: [], plugins: [] });
	useComposer.setState({ drafts: {}, annotations: {}, images: {}, files: {}, history: [] });
	useLive.setState({
		sessions: { [SESSION]: { ...emptySessionLive(), alive: true, state: {}, commands: [MCP_CATALOG] } },
	});
	mount();
});

afterEach(() => {
	cleanup();
	document.body.innerHTML = "";
});

const ta = (): HTMLTextAreaElement => {
	const el = document.querySelector<HTMLTextAreaElement>(`textarea[data-composer="${SESSION}"]`);
	if (!el) throw new Error("composer textarea not rendered");
	return el;
};

/** Real keystrokes: one `change` per character, so the composer's
 * single-space-insertion detection (space-to-token, word+space) can fire. */
function typeText(value: string): void {
	const el = ta();
	for (let i = 1; i <= value.length; i++) {
		fireEvent.change(el, { target: { value: value.slice(0, i) } });
	}
}

const chips = () => document.querySelectorAll("[data-command-chip]");
const chipText = () => chips()[0]?.textContent ?? "";
const menuRows = () =>
	[...screen.queryAllByRole("option")].map((el) => el.textContent ?? "");

const promptSends = () =>
	h.rpcSend.mock.calls
		.map(([, command]) => command as Record<string, unknown>)
		.filter((c) => c.type === "prompt")
		.map((c) => String(c.message));

/** `/mcp` typed then Tab: legacy chip + open 子命令 menu. */
function openMcpSubmenu(): void {
	typeText("/mcp");
	fireEvent.keyDown(ta(), { key: "Tab" });
}

describe("Composer subcommand chips", () => {
	it("(a) /mcp + Tab keeps a legacy chip and opens the 子命令 menu", () => {
		typeText("/mcp");
		expect(menuRows().length).toBeGreaterThan(0);
		expect(menuRows().some((r) => r.includes("/mcp"))).toBe(true);

		fireEvent.keyDown(ta(), { key: "Tab" });

		// One atomic chip for the command itself; the draft is emptied.
		expect(chips()).toHaveLength(1);
		expect(chips()[0]?.getAttribute("data-command-chip")).toBe("mcp");
		expect(ta().value).toBe("");
		expect(useComposer.getState().drafts[SESSION]).toBe("");

		// The subcommand menu replaced the command menu.
		expect(screen.getByText("子命令")).toBeTruthy();
		expect(menuRows().some((r) => r.includes("/mcp enable"))).toBe(true);
		expect(menuRows().some((r) => r.includes("/mcp disable"))).toBe(true);
	});

	it("(b) picking enable merges it into one chip with its own ghost hint", () => {
		openMcpSubmenu();

		const row = screen
			.getAllByRole("option")
			.find((el) => (el.textContent ?? "").includes("/mcp enable"));
		expect(row).toBeTruthy();
		fireEvent.mouseDown(row!);

		expect(chips()).toHaveLength(1);
		expect(chips()[0]?.getAttribute("data-command-chip")).toBe("mcp");
		expect(chipText()).toBe("MCP 服务器 enable");
		expect(ta().value).toBe("");
		// The subcommand's usage replaces the parent's <子命令> hint.
		expect(ta().placeholder).toBe("<name>");
		expect(screen.queryByRole("option")).toBeNull();
	});

	it("(c) a space right after /mcp becomes a chip with no stray leading space", () => {
		typeText("/mcp ");

		expect(chips()).toHaveLength(1);
		expect(chips()[0]?.getAttribute("data-command-chip")).toBe("mcp");
		expect(chipText()).toBe("MCP 服务器");
		expect(ta().value).toBe("");
		expect(useComposer.getState().drafts[SESSION]).toBe("");
		expect(ta().selectionStart).toBe(0);
		expect(ta().placeholder).toBe("<子命令>");
		expect(screen.getByText("子命令")).toBeTruthy();
	});

	it("(d) Backspace at caret 0 removes only the merged subcommand", () => {
		openMcpSubmenu();
		typeText("enable");
		fireEvent.keyDown(ta(), { key: "Tab" });
		expect(chipText()).toBe("MCP 服务器 enable");
		expect(ta().value).toBe("");

		act(() => ta().setSelectionRange(0, 0));
		fireEvent.keyDown(ta(), { key: "Backspace" });

		// The chip survives; only ` enable` is unmerged.
		expect(chips()).toHaveLength(1);
		expect(chips()[0]?.getAttribute("data-command-chip")).toBe("mcp");
		expect(chipText()).toBe("MCP 服务器");
		expect(ta().value).toBe("");
		// The parent hint is restored and the subcommand menu reopens.
		expect(ta().placeholder).toBe("<子命令>");
		expect(screen.getByText("子命令")).toBeTruthy();
	});

	it("(e) typing an exact subcommand word + space merges it into the chip", () => {
		typeText("/mcp ");
		typeText("enable ");

		expect(chips()).toHaveLength(1);
		expect(chipText()).toBe("MCP 服务器 enable");
		expect(ta().value).toBe("");
		expect(useComposer.getState().drafts[SESSION]).toBe("");
		expect(ta().placeholder).toBe("<name>");
	});

	it("(f) a first word that is not a subcommand stays draft text", () => {
		typeText("/mcp ");
		typeText("ena ");

		expect(chips()).toHaveLength(1);
		expect(chipText()).toBe("MCP 服务器");
		expect(ta().value).toBe("ena ");
	});

	it("(g) submit serializes the merged subcommand ahead of the args", async () => {
		openMcpSubmenu();
		typeText("enable ");
		expect(chipText()).toBe("MCP 服务器 enable");

		typeText("foo");
		fireEvent.keyDown(ta(), { key: "Enter" });

		await waitFor(() => expect(promptSends()).toEqual(["/mcp enable foo"]));
		expect(chips()).toHaveLength(0);
		expect(ta().value).toBe("");
	});

	it("(h) the merged subcommand survives a remount (persisted chip)", () => {
		openMcpSubmenu();
		typeText("enable ");
		expect(chipText()).toBe("MCP 服务器 enable");

		cleanup();
		document.body.innerHTML = "";
		mount();

		expect(chips()).toHaveLength(1);
		expect(chips()[0]?.getAttribute("data-command-chip")).toBe("mcp");
		expect(chipText()).toBe("MCP 服务器 enable");
		expect(ta().placeholder).toBe("<name>");
	});
});

describe("Composer history arrow navigation", () => {
	beforeEach(() => {
		act(() => useComposer.setState({ history: ["older", "a\nb\nc"] }));
		// Recall the newest (multi-line) entry from an empty composer.
		fireEvent.keyDown(ta(), { key: "ArrowUp" });
		expect(ta().value).toBe("a\nb\nc");
	});

	const key = (k: string, pos: number): boolean => {
		ta().setSelectionRange(pos, pos);
		return fireEvent.keyDown(ta(), { key: k });
	};

	it("ArrowUp mid-text leaves the caret to the browser", () => {
		expect(key("ArrowUp", 3)).toBe(true);
		expect(ta().value).toBe("a\nb\nc");
	});

	it("ArrowUp on the first line goes to the previous history entry", () => {
		expect(key("ArrowUp", 1)).toBe(false);
		expect(ta().value).toBe("older");
	});

	it("ArrowDown mid-text does not navigate; on the last line it does", () => {
		expect(key("ArrowDown", 1)).toBe(true);
		expect(ta().value).toBe("a\nb\nc");
		expect(key("ArrowDown", 5)).toBe(false);
		expect(ta().value).toBe("");
	});
});

describe("Composer MCP server-name completion", () => {
	const server = (name: string, enabled: boolean, transport = "stdio") => ({
		name,
		transport,
		command: transport === "stdio" ? "npx" : null,
		args: [],
		url: transport === "stdio" ? null : "https://x.test/mcp",
		enabled,
		scope: "user",
	});

	function openMcpEnable(): void {
		openMcpSubmenu();
		typeText("enable ");
		expect(chipText()).toBe("MCP 服务器 enable");
	}

	it("lists servers (disabled first for enable); picking writes `<name> ` and submit sends it", async () => {
		h.mcpConfigList.mockResolvedValue({
			servers: [server("alpha", true), server("beta", false, "http")],
		});
		openMcpEnable();

		await waitFor(() => expect(screen.getByText("MCP 服务器")).toBeTruthy());
		const rows = menuRows();
		expect(rows).toHaveLength(2);
		expect(rows[0]).toContain("beta");
		expect(rows[0]).toContain("已禁用 · http");
		expect(rows[0]).not.toContain("/beta");
		expect(rows[1]).toContain("已启用 · stdio");

		fireEvent.keyDown(ta(), { key: "Tab" });
		expect(ta().value).toBe("beta ");
		expect(chipText()).toBe("MCP 服务器 enable");
		expect(menuRows()).toHaveLength(0);

		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(promptSends()).toEqual(["/mcp enable beta"]));
	});

	it("filters by the typed first word and shows nothing when none match", async () => {
		h.mcpConfigList.mockResolvedValue({
			servers: [server("alpha", true), server("beta", false)],
		});
		openMcpEnable();
		await waitFor(() => expect(menuRows()).toHaveLength(2));

		typeText("al");
		await waitFor(() => expect(menuRows()).toHaveLength(1));
		expect(menuRows()[0]).toContain("alpha");

		fireEvent.change(ta(), { target: { value: "zzz" } });
		expect(menuRows()).toHaveLength(0);
	});

	it("an mcpConfigList rejection leaves typing unaffected", async () => {
		h.mcpConfigList.mockRejectedValue(new Error("boom"));
		openMcpEnable();
		await waitFor(() => expect(h.mcpConfigList).toHaveBeenCalled());

		typeText("foo");
		expect(menuRows()).toHaveLength(0);
		expect(ta().value).toBe("foo");
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(promptSends()).toEqual(["/mcp enable foo"]));
	});
});

describe("Composer generic subcommands (registry command + omp dynamic list)", () => {
	const withCommands = (commands: unknown[]) =>
		act(() => {
			useLive.setState({
				sessions: {
					[SESSION]: {
						...emptySessionLive(),
						alive: true,
						state: {},
						commands: commands as never,
					},
				},
			});
		});

	it("/fast + space → chip + sub popup; picking `on` submits `/fast on`", async () => {
		withCommands([
			{
				name: "fast",
				source: "builtin",
				subcommands: [{ name: "on" }, { name: "ultra" }, { name: "off" }, { name: "status" }],
			},
		]);
		typeText("/fast ");
		expect(chips()).toHaveLength(1);
		expect(chips()[0]?.getAttribute("data-command-chip")).toBe("fast");
		expect(chipText()).toBe("快速模式");
		expect(ta().value).toBe("");
		expect(menuRows().some((r) => r.includes("/fast on"))).toBe(true);
		expect(menuRows().some((r) => r.includes("/fast ultra"))).toBe(true);

		const row = screen.getAllByRole("option").find((el) => (el.textContent ?? "").includes("/fast on"));
		if (!row) throw new Error("on row missing");
		fireEvent.mouseDown(row);
		fireEvent.click(row);
		expect(chipText()).toBe("快速模式 on");

		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(promptSends()).toEqual(["/fast on"]));
		expect(h.rpcSend.mock.calls.some(([, c]) => (c as { type?: string }).type === "set_fast_mode")).toBe(false);
	});

	it("selecting /fast opens its subcommand list; the first entry runs the native action", async () => {
		withCommands([{ name: "fast", source: "builtin", subcommands: [{ name: "on" }] }]);
		typeText("/fast");
		fireEvent.keyDown(ta(), { key: "Enter" });
		expect(chips()).toHaveLength(1);
		expect(menuRows()[0]).toContain("直接运行");
		expect(menuRows()[1]).toContain("/fast on");
		expect(h.rpcSend.mock.calls.some(([, c]) => (c as { type?: string }).type === "set_fast_mode")).toBe(false);
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() =>
			expect(h.rpcSend.mock.calls.some(([, c]) => (c as { type?: string }).type === "set_fast_mode")).toBe(true),
		);
		expect(chips()).toHaveLength(0);
	});

	it("top-level search lists subcommands as indented rows; picking one chips `/parent sub`", () => {
		withCommands([
			{
				name: "memory",
				source: "builtin",
				subcommands: [{ name: "view" }, { name: "stats" }, { name: "mm list", description: "List models" }],
			},
		]);
		typeText("/mem");
		const rows = menuRows();
		expect(rows[0]).toContain("/memory");
		expect(rows.some((r) => r.includes("/memory view"))).toBe(true);
		const mm = screen.getAllByRole("option").find((el) => el.textContent?.includes("/memory mm list"));
		expect(mm?.className).toContain("pl-8");
		fireEvent.mouseDown(mm as Element);
		expect(chipText()).toContain("mm list");
		expect(ta().value).toBe("");
	});

	it("TUI-only subcommands (e.g. /todo edit) are not listed", () => {
		withCommands([
			{ name: "todo", source: "builtin", subcommands: [{ name: "edit" }, { name: "copy" }, { name: "expand" }] },
		]);
		typeText("/todo");
		const rows = menuRows().join("|");
		expect(rows).toContain("/todo copy");
		expect(rows).not.toContain("/todo edit");
		expect(rows).not.toContain("/todo expand");
	});

	it("/plugins enable completes installed plugins (disabled first) and submits the name", async () => {
		withCommands([
			{ name: "plugins", source: "builtin", subcommands: [{ name: "list" }, { name: "enable" }, { name: "disable" }] },
		]);
		h.pluginsList.mockResolvedValue({
			roots: [],
			plugins: [
				{ name: "alpha", enabled: true, kind: "npm", version: "1.0.0", description: null, scope: "user" },
				{ name: "beta", enabled: false, kind: "link", version: null, description: "Beta plugin", scope: "project" },
			],
		});
		typeText("/plugins ");
		expect(chips()[0]?.getAttribute("data-command-chip")).toBe("plugins");
		typeText("enable ");
		expect(chipText()).toBe("插件 enable");

		await waitFor(() => expect(screen.getByText("插件", { selector: "*" })).toBeTruthy());
		await waitFor(() => expect(menuRows()).toHaveLength(2));
		const rows = menuRows();
		expect(rows[0]).toContain("beta");
		expect(rows[0]).toContain("已禁用 · link");
		expect(rows[1]).toContain("alpha");
		expect(rows[1]).toContain("已启用 · npm · v1.0.0");

		fireEvent.keyDown(ta(), { key: "Tab" });
		expect(ta().value).toBe("beta ");
		fireEvent.keyDown(ta(), { key: "Enter" });
		await waitFor(() => expect(promptSends()).toEqual(["/plugins enable beta"]));
	});
});
