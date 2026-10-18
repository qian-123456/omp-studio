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

beforeEach(() => {
	localStorage.clear();
	h.rpcSend.mockClear();
	useComposer.setState({ drafts: {}, annotations: {}, images: {}, files: {}, history: [] });
	useLive.setState({
		sessions: { [SESSION]: { ...emptySessionLive(), alive: true, state: {} } },
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
