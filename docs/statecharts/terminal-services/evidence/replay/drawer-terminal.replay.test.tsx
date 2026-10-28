// @vitest-environment jsdom
/**
 * 真实入口重放: 抽屉终端 (CommandTerminalPanel + drawerRegistry + drawerStore + terminalTabs)。
 * 只在外部 I/O 边界做替身: Tauri invoke / listen、xterm 画布类、右侧面板之外的 toast/dialog 由真实代码处理。
 * 每个用例对应 statechart 模型里的一条故事。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const REPO = "<repo>";

const h = vi.hoisted(() => {
	type Listener = (e: { payload: any }) => void;
	const listeners = new Map<string, Listener[]>();
	const calls: { cmd: string; args: any }[] = [];
	const state = {
		termOpen: null as null | ((args: any) => Promise<string>),
		xtermWrites: [] as Uint8Array[],
	};
	return { listeners, calls, state };
});

vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(() => Promise.resolve("/tmp")) }));
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(async (cmd: string, args: any) => {
		h.calls.push({ cmd, args });
		if (cmd === "term_open") return h.state.termOpen ? h.state.termOpen(args) : "T-default";
		if (cmd === "app_paths") return { globalDir: "/tmp" };
		return undefined;
	}),
}));
vi.mock("@tauri-apps/api/event", () => ({
	listen: vi.fn(async (name: string, cb: any) => {
		const arr = h.listeners.get(name) ?? [];
		arr.push(cb);
		h.listeners.set(name, arr);
		return () => {};
	}),
}));
vi.mock("@xterm/xterm", () => {
	class Terminal {
		cols = 80;
		rows = 24;
		options: any = {};
		element: HTMLElement | null = null;
		open(host: HTMLElement) {
			this.element = document.createElement("div");
			host.appendChild(this.element);
		}
		loadAddon() {}
		attachCustomKeyEventHandler() {}
		onData() { return { dispose() {} }; }
		onSelectionChange() { return { dispose() {} }; }
		hasSelection() { return false; }
		getSelection() { return ""; }
		write(d: Uint8Array) { h.state.xtermWrites.push(d); }
		focus() {}
		clear() {}
		dispose() { this.element?.remove(); this.element = null; }
	}
	return { Terminal };
});
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-search", () => ({
	SearchAddon: class {
		onDidChangeResults() { return { dispose() {} }; }
		clearDecorations() {}
	},
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

class FakeResizeObserver { observe() {} disconnect() {} unobserve() {} }
(globalThis as any).ResizeObserver = FakeResizeObserver;
(window as any).matchMedia = (window as any).matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
(globalThis as any).requestAnimationFrame = (cb: any) => setTimeout(cb, 0);
(globalThis as any).cancelAnimationFrame = (i: any) => clearTimeout(i);

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
	getItem: (k: string) => mem.get(k) ?? null,
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
	key: () => null,
	get length() { return mem.size; },
};

async function loadApp() {
	const { CommandTerminalPanel } = await import(`${REPO}/src/features/terminal/CommandTerminalPanel`);
	const { useDrawerStore } = await import(`${REPO}/src/features/terminal/drawerStore`);
	const reg = await import(`${REPO}/src/features/terminal/drawerRegistry`);
	const tabs = await import(`${REPO}/src/features/terminal/terminalTabs`);
	return { CommandTerminalPanel, useDrawerStore, ...reg, ...tabs };
}

function emit(name: string, payload: any) {
	for (const cb of h.listeners.get(name) ?? []) cb({ payload });
}
const calls = (cmd: string) => h.calls.filter((c) => c.cmd === cmd);

beforeEach(() => {
	mem.clear();
	h.calls.length = 0;
	h.state.termOpen = null;
	h.state.xtermWrites.length = 0;
});
afterEach(() => {
	cleanup();
});

describe("drawer terminal replay", () => {
	it("规则成立: 启动请求在途时关闭标签，返回后后端进程被关掉 (模型 NoLeakAfterClose)", async () => {
		const { CommandTerminalPanel, useDrawerStore, closeTerminalTab, drawerRegistry } = await loadApp();
		let release!: (id: string) => void;
		h.state.termOpen = () => new Promise<string>((r) => (release = r));
		useDrawerStore.setState({ tabs: [], activeTabId: null });
		render(<CommandTerminalPanel />);
		await waitFor(() => expect(calls("term_open").length).toBe(1));
		await act(async () => { await closeTerminalTab(useDrawerStore.getState().tabs[0].id); });
		expect(useDrawerStore.getState().tabs.length).toBe(0);
		await act(async () => { release("T-orphan"); });
		await waitFor(() => expect(calls("term_close").map((c) => c.args.termId)).toContain("T-orphan"));
		expect(drawerRegistry.size).toBe(0);
	});

	it("BUG(ReadyMeansAlive): 启动请求返回前 shell 已退出，标签仍被标成运行中", async () => {
		const { CommandTerminalPanel, useDrawerStore, drawerRegistry } = await loadApp();
		let release!: (id: string) => void;
		h.state.termOpen = () => new Promise<string>((r) => (release = r));
		useDrawerStore.setState({ tabs: [], activeTabId: null });
		render(<CommandTerminalPanel />);
		await waitFor(() => expect(calls("term_open").length).toBe(1));
		// 后端: shell 在 term_open 的返回送达前已经退出，terminal:exit 已先到
		await act(async () => { emit("terminal:exit", { termId: "T-fast", code: 0 }); });
		await act(async () => { release("T-fast"); });
		await waitFor(() => expect(useDrawerStore.getState().tabs[0].status).toBe("ready"));
		const tab = useDrawerStore.getState().tabs[0];
		const entry = drawerRegistry.get(tab.id)!;
		// 用户可见的结果: 没有“已退出/重新连接”横幅，标签点是运行中，而进程其实已经退出
		expect(tab.status).toBe("ready");
		expect(entry.phase).toBe("ready");
		expect(screen.queryByText(/重新连接/)).toBeNull();
	});

	it("BUG(OutputNotLost): 启动请求返回前到达的第一段输出被丢弃", async () => {
		const { CommandTerminalPanel, useDrawerStore } = await loadApp();
		let release!: (id: string) => void;
		h.state.termOpen = () => new Promise<string>((r) => (release = r));
		useDrawerStore.setState({ tabs: [], activeTabId: null });
		render(<CommandTerminalPanel />);
		await waitFor(() => expect(calls("term_open").length).toBe(1));
		await act(async () => { emit("terminal:data", { termId: "T-out", data: btoa("prompt$ ") }); });
		await act(async () => { release("T-out"); });
		await waitFor(() => expect(useDrawerStore.getState().tabs[0].status).toBe("ready"));
		// 终端界面一个字节也没有收到
		expect(h.state.xtermWrites.length).toBe(0);
		// 对照: 返回之后到达的输出会被写入
		await act(async () => { emit("terminal:data", { termId: "T-out", data: btoa("later") }); });
		expect(h.state.xtermWrites.length).toBe(1);
	});

	it("BUG(OpeningMakesProgress): 启动失败后点击“重试”，不再发起新的终端启动", async () => {
		const { CommandTerminalPanel, useDrawerStore, drawerRegistry } = await loadApp();
		h.state.termOpen = () => Promise.reject(new Error("目录不存在"));
		useDrawerStore.setState({ tabs: [], activeTabId: null });
		render(<CommandTerminalPanel />);
		const retry = await screen.findByText("重试");
		expect(calls("term_open").length).toBe(1);
		// 之后后端恢复正常
		h.state.termOpen = async () => "T-recovered";
		await act(async () => { fireEvent.click(retry); });
		await new Promise((r) => setTimeout(r, 300));
		const tab = useDrawerStore.getState().tabs[0];
		// 用户可见的结果: 标签永远“连接中”，没有新的启动请求，界面里没有终端条目
		expect(tab.status).toBe("opening");
		expect(calls("term_open").length).toBe(1);
		expect(drawerRegistry.has(tab.id)).toBe(false);
	});
});
