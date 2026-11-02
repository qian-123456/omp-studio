// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    listeners: new Map<string, ((event: { payload: unknown }) => void)[]>(),
    calls: [] as { cmd: string; args: Record<string, unknown> }[],
    open: null as null | (() => Promise<string>),
    writes: [] as Uint8Array[],
    gitErrorCwd: null as string | null,
    root: null as null | ((cwd: string) => Promise<string | null>),
    worktrees: null as null | ((cwd: string) => Promise<{ path: string }[]>),
    keyHandlers: [] as ((event: KeyboardEvent) => boolean)[],
    selections: [] as string[],
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(async () => "/tmp") }));
vi.mock("@tauri-apps/api/core", () => ({
    invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
        h.calls.push({ cmd, args });
        if (cmd === "term_open") return h.open ? h.open() : "default";
        if (cmd === "app_paths") return { globalDir: "/tmp" };
        if (cmd === "git_repo_root") {
            if (args.cwd === h.gitErrorCwd) throw new Error("git root failed");
            if (h.root) return h.root(String(args.cwd));
            return null;
        }
        if (cmd === "git_list_worktrees") return h.worktrees ? h.worktrees(String(args.repo)) : [];
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
    index = h.keyHandlers.length;
    attachCustomKeyEventHandler(fn: (event: KeyboardEvent) => boolean) { h.keyHandlers.push(fn); }
    onData() { return { dispose() {} }; }
    onSelectionChange() { return { dispose() {} }; }
    hasSelection() { return false; }
    getSelection() { return h.selections[this.index] ?? ""; }
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
    h.gitErrorCwd = null;
    h.root = null;
    h.worktrees = null;
    h.keyHandlers.length = 0;
    h.selections.length = 0;
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("drawer terminal start handshake", () => {
    it("blocks manual creation while scope discovery is pending or failed", async () => {
        const { CommandTerminalPanel, useDrawerStore, addTerminalTab } = await load();
        // Module reset ensures the panel and tests use the same store instances.
        const { useUi } = await import("../../stores/ui");
        const { useSessions } = await import("../../stores/sessions");
        useSessions.setState({ sessions: { a: { id: "a", cwd: "/repo/sub", workspaceId: null } } as never });
        useUi.setState({ selectedSessionId: "a", centerView: "session" });
        let reject!: (error: Error) => void;
        h.root = () => new Promise((_, fail) => { reject = fail; });
        render(<CommandTerminalPanel />);
        await waitFor(() => expect(reject).toBeDefined());
        let action: Promise<unknown> = Promise.resolve();
        act(() => { action = Promise.resolve(addTerminalTab()); });
        expect(useDrawerStore.getState().tabs).toHaveLength(0);
        expect(calls("term_open")).toHaveLength(0);
        await act(async () => reject(new Error("root unavailable")));
        await act(async () => { await action; });
        await screen.findByText("root unavailable");
        await act(async () => { await addTerminalTab(); });
        expect(useDrawerStore.getState().tabs).toHaveLength(0);
        expect(calls("term_open")).toHaveLength(0);
    });

    it("never quotes hidden A into B when discovery cannot complete", async () => {
        const { CommandTerminalPanel, useDrawerStore } = await load();
        // Module reset ensures the panel and tests use the same store instances.
        const { useUi } = await import("../../stores/ui");
        const { useSessions } = await import("../../stores/sessions");
        const { useComposer } = await import("../../stores/composer");
        useSessions.setState({ sessions: { a: { id: "a", cwd: "/a", workspaceId: null }, b: { id: "b", cwd: "/b", workspaceId: null } } as never });
        useUi.setState({ selectedSessionId: "a", centerView: "session" });
        render(<CommandTerminalPanel />);
        await waitFor(() => expect(h.keyHandlers).toHaveLength(1));
        h.selections[0] = "secret from A";
        const a = useDrawerStore.getState().tabs[0];
        h.gitErrorCwd = "/bad";
        act(() => { useDrawerStore.getState().addTab("/bad", "bad", null, "/bad"); useDrawerStore.getState().setActive(a.id); });
        await screen.findByText("git root failed");
        act(() => useUi.setState({ selectedSessionId: "b" }));
        act(() => { h.keyHandlers[0](new KeyboardEvent("keydown", { key: "a", metaKey: true, shiftKey: true })); });
        expect(useComposer.getState().annotations.b ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: "secret from A" })]));
    });

    it("reuses B subdirectory session without treating a nested repository as B", async () => {
        const { addTerminalTabWithCwd } = await load();
        // Module reset ensures the action and tests use the same store instances.
        const { useUi } = await import("../../stores/ui");
        const { useSessions } = await import("../../stores/sessions");
        useSessions.setState({ sessions: {
            a: { id: "a", cwd: "/a", workspaceId: null, mode: "code", archived: false },
            nested: { id: "nested", cwd: "/repo-b/vendor/nested", workspaceId: null, mode: "code", archived: false },
            b: { id: "b", cwd: "/repo-b/packages/app", workspaceId: null, mode: "code", archived: false },
        } as never });
        useUi.setState({ selectedSessionId: "a", centerView: "session" });
        h.root = async (cwd) => cwd.includes("vendor/nested") ? "/repo-b/vendor/nested" : "/repo-b";
        h.worktrees = async (root) => [{ path: root }];
        await act(async () => { await addTerminalTabWithCwd("/repo-b"); });
        expect(useUi.getState().selectedSessionId).toBe("b");
        expect(calls("git_repo_root").some((call) => call.args.cwd === "/repo-b/vendor/nested")).toBe(true);
        expect(calls("git_repo_root").some((call) => call.args.cwd === "/repo-b/packages/app")).toBe(true);
    });

    it("cancels delayed B navigation after A to C to A", async () => {
        const { addTerminalTabWithCwd, useDrawerStore } = await load();
        // Module reset ensures the action and tests use the same store instances.
        const { useUi } = await import("../../stores/ui");
        const { useSessions } = await import("../../stores/sessions");
        useSessions.setState({ sessions: {
            a: { id: "a", cwd: "/a", workspaceId: null, mode: "code", archived: false },
            b: { id: "b", cwd: "/b", workspaceId: null, mode: "code", archived: false },
            c: { id: "c", cwd: "/c", workspaceId: null, mode: "code", archived: false },
        } as never });
        useUi.setState({ selectedSessionId: "a", centerView: "session" });
        let resolve!: (value: string | null) => void;
        h.root = () => new Promise((done) => { resolve = done; });
        const pending = addTerminalTabWithCwd("/b");
        await waitFor(() => expect(resolve).toBeDefined());
        act(() => { useUi.setState({ selectedSessionId: "c" }); useUi.setState({ selectedSessionId: "a" }); });
        await act(async () => { resolve(null); await pending; });
        expect(useUi.getState().selectedSessionId).toBe("a");
        expect(useDrawerStore.getState().tabs).toHaveLength(0);
    });

    it("reports scope resolution errors without opening or replacing a shell", async () => {
        const { CommandTerminalPanel, useDrawerStore, drawerRegistry } = await load();
        // Match load()'s reset-module boundary for the panel's store instances.
        const { useUi } = await import("../../stores/ui");
        const { useSessions } = await import("../../stores/sessions");
        useSessions.setState({ sessions: {
            a: { id: "a", cwd: "/project/a", workspaceId: "project" },
            b: { id: "b", cwd: "/project/b", workspaceId: "project" },
        } as never });
        useUi.setState({ selectedSessionId: "a", centerView: "session" });
        h.open = async () => "pty-a";
        render(<CommandTerminalPanel />);
        await waitFor(() => expect(calls("term_open")).toHaveLength(1));
        const a = useDrawerStore.getState().tabs[0];
        await waitFor(() => expect(drawerRegistry.get(a.id)?.termId).toBe("pty-a"));
        h.gitErrorCwd = "/project/b";
        act(() => useUi.setState({ selectedSessionId: "b" }));
        await screen.findByText("git root failed");
        expect(calls("term_open")).toHaveLength(1);
        expect(calls("term_close")).toHaveLength(0);
        expect(useDrawerStore.getState().tabs).toHaveLength(1);
        expect(drawerRegistry.get(a.id)?.termId).toBe("pty-a");
    });

    it("keeps each worktree shell alive and restores its terminal on return", async () => {
        const { CommandTerminalPanel, useDrawerStore, drawerRegistry } = await load();
        // Match load()'s reset-module boundary so these are the panel's store instances.
        const { useUi } = await import("../../stores/ui");
        const { useSessions } = await import("../../stores/sessions");
        useSessions.setState({ sessions: {
            a: { id: "a", cwd: "/project/a", workspaceId: "project" },
            b: { id: "b", cwd: "/project/b", workspaceId: "project" },
        } as never });
        useUi.setState({ selectedSessionId: "a", centerView: "session" });
        let next = 0;
        h.open = async () => `pty-${++next}`;
        render(<CommandTerminalPanel />);
        await waitFor(() => expect(calls("term_open")).toHaveLength(1));
        const a = useDrawerStore.getState().tabs.find((t) => t.scope === "/project/a")!;
        await waitFor(() => expect(drawerRegistry.get(a.id)?.termId).toBe("pty-1"));
        const entry = drawerRegistry.get(a.id);
        await act(async () => { emit("terminal:data", { termId: "pty-1", data: btoa("A output") }); });
        act(() => useUi.setState({ selectedSessionId: "b" }));
        await waitFor(() => expect(calls("term_open")).toHaveLength(2));
        expect(calls("term_open").map((call) => [call.args.cwd, call.args.sessionId])).toEqual([
            ["/project/a", "a"], ["/project/b", "b"],
        ]);
        act(() => useUi.setState({ selectedSessionId: "a" }));
        await waitFor(() => expect(useDrawerStore.getState().activeTabId).toBe(a.id));
        expect(drawerRegistry.get(a.id)).toBe(entry);
        expect(h.writes.map((bytes) => String.fromCharCode(...bytes)).join("")).toContain("A output");
        expect(calls("term_close")).toHaveLength(0);
        expect(calls("term_open")).toHaveLength(2);
    });

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
