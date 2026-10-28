// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    listeners: new Map<string, ((event: { payload: unknown }) => void)[]>(),
    calls: [] as { cmd: string; args: Record<string, unknown> }[],
    open: null as null | (() => Promise<string>),
    writes: [] as Uint8Array[],
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(async () => "/tmp") }));
vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
        h.calls.push({ cmd, args });
        if (cmd === "term_open") return h.open ? h.open() : "default";
        if (cmd === "app_paths") return { globalDir: "/tmp" };
        return undefined;
    }),
}));
vi.mock("@tauri-apps/api/event", () => ({
    listen: vi.fn(async (name: string, cb: (event: { payload: unknown }) => void) => {
        const callbacks = h.listeners.get(name) ?? [];
        callbacks.push(cb);
        h.listeners.set(name, callbacks);
        return () => { h.listeners.set(name, callbacks.filter((fn) => fn !== cb)); };
    }),
}));
vi.mock("@xterm/xterm", () => ({ Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    element: HTMLElement | null = null;
    open(host: HTMLElement) { this.element = document.createElement("div"); host.appendChild(this.element); }
    loadAddon() {}
    attachCustomKeyEventHandler() {}
    onData() { return { dispose() {} }; }
    onSelectionChange() { return { dispose() {} }; }
    hasSelection() { return false; }
    getSelection() { return ""; }
    write(bytes: Uint8Array) { h.writes.push(bytes); }
    focus() {}
    clear() {}
    dispose() { this.element?.remove(); this.element = null; }
} }));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {
    onDidChangeResults() { return { dispose() {} }; }
    clearDecorations() {}
} }));
vi.mock("./terminalTheme", () => ({ bindXtermTheme: () => () => {}, currentXtermTheme: () => ({}), getSearchDecorations: () => ({}) }));
vi.mock("../../lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const calls = (cmd: string) => h.calls.filter((c) => c.cmd === cmd);
function emit(name: string, payload: unknown) {
    for (const callback of h.listeners.get(name) ?? []) callback({ payload });
}
async function load() {
    const panel = await import("./CommandTerminalPanel");
    const store = await import("./drawerStore");
    const registry = await import("./drawerRegistry");
    const tabs = await import("./terminalTabs");
    store.useDrawerStore.setState({ tabs: [], activeTabId: null });
    return { ...panel, ...store, ...registry, ...tabs };
}
beforeEach(() => {
    // Reset/re-import deliberately exercises the module-owned registry/event bridge per mount.
    vi.resetModules();
    h.listeners.clear();
    h.calls.length = 0;
    h.writes.length = 0;
    h.open = null;
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("drawer terminal start handshake", () => {
    it("63 keeps an exit received before the start response", async () => {
        const { CommandTerminalPanel, useDrawerStore, drawerRegistry } = await load();
        let resolve!: (id: string) => void;
        h.open = () => new Promise((done) => { resolve = done; });
        render(<CommandTerminalPanel />);
        await waitFor(() => expect(calls("term_open")).toHaveLength(1));
        await act(async () => {
            emit("terminal:exit", { termId: "fast", code: 3 });
            resolve("fast");
        });
        await waitFor(() => expect(useDrawerStore.getState().tabs[0].status).toBe("exited"));
        const tab = useDrawerStore.getState().tabs[0];
        expect(tab.exitCode).toBe(3);
        expect(drawerRegistry.get(tab.id)?.phase).toBe("exited");
    });

    it("65 replays data before the start response in byte order", async () => {
        const { CommandTerminalPanel, useDrawerStore } = await load();
        let resolve!: (id: string) => void;
        h.open = () => new Promise((done) => { resolve = done; });
        render(<CommandTerminalPanel />);
        await waitFor(() => expect(calls("term_open")).toHaveLength(1));
        await act(async () => {
            emit("terminal:data", { termId: "output", data: btoa("prompt$ ") });
            emit("terminal:data", { termId: "output", data: btoa("first") });
            resolve("output");
        });
        await waitFor(() => expect(useDrawerStore.getState().tabs[0].status).toBe("ready"));
        await act(async () => { emit("terminal:data", { termId: "output", data: btoa("later") }); });
        expect(h.writes.map((bytes) => String.fromCharCode(...bytes)).join("")).toBe("prompt$ firstlater");
    });

    it("64 retries a failed start and reaches ready with a new request", async () => {
        const { CommandTerminalPanel, useDrawerStore, drawerRegistry } = await load();
        h.open = async () => { throw new Error("missing cwd"); };
        render(<CommandTerminalPanel />);
		await screen.findByText((text) => text.includes("missing cwd"));
		const retry = screen.getByRole("button");
        expect(calls("term_open")).toHaveLength(1);
        h.open = async () => "recovered";
        await act(async () => { fireEvent.click(retry); });
        await waitFor(() => expect(calls("term_open")).toHaveLength(2));
        await waitFor(() => expect(useDrawerStore.getState().tabs[0].status).toBe("ready"));
        expect(drawerRegistry.get(useDrawerStore.getState().tabs[0].id)?.termId).toBe("recovered");
    });

    it("closes a start response belonging to a removed tab", async () => {
        const { CommandTerminalPanel, useDrawerStore, closeTerminalTab, drawerRegistry } = await load();
        let resolve!: (id: string) => void;
        h.open = () => new Promise((done) => { resolve = done; });
        render(<CommandTerminalPanel />);
        await waitFor(() => expect(calls("term_open")).toHaveLength(1));
        await act(async () => { await closeTerminalTab(useDrawerStore.getState().tabs[0].id); });
        await act(async () => { resolve("orphan"); });
        await waitFor(() => expect(calls("term_close").some((c) => c.args.termId === "orphan")).toBe(true));
        expect(drawerRegistry.size).toBe(0);
    });
});
