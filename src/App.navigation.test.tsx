// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta, Workspace } from "./lib/contracts";

const backend = vi.hoisted(() => ({ sessions: [] as SessionMeta[], workspaces: [] as Workspace[] }));
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(async (cmd: string) => {
		if (cmd === "list_sessions") return backend.sessions;
		if (cmd === "list_workspaces") return backend.workspaces;
		if (cmd === "get_transcript") return { sessionId: "a", items: [], nextOffset: 0, reset: true, tailId: null };
		if (cmd.startsWith("privacy")) return { entries: [], rules: [] };
		if (cmd.startsWith("list_") || cmd.endsWith("_list") || cmd.endsWith("_turns")) return [];
		return null;
	}),
	convertFileSrc: (path: string) => path,
	Channel: class {},
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
	hide: vi.fn(), onFocusChanged: async () => () => {}, onResized: async () => () => {},
	isFullscreen: async () => false, setTitle: async () => {}, label: "main",
}) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
vi.mock("./features/settings/useStartupImageGc", () => ({ useStartupImageGc() {} }));
vi.mock("./features/heatmap/doctorStore", () => ({ useDoctorAutoScheduler() {} }));
vi.mock("./features/todos/store", () => ({ startTodos() {} }));
vi.mock("./stores/ompUpdate", () => ({
	useOmpUpdate: { getState: () => ({ checkOnStartup: async () => {} }) },
	watchOmpUpdateChecks: () => () => {}, watchOmpStaleness: () => () => {},
}));
vi.mock("./stores/ompInstall", () => ({ useOmpInstall: { getState: () => ({ checkOnStartup: async () => {} }) } }));
vi.mock("./features/omp-install/OmpInstallDialog", () => ({ OmpInstallDialog: () => null }));
vi.mock("./lib/nativeShortcuts", () => ({ installNativeShortcuts: () => () => {} }));
vi.mock("./features/shortcuts/dispatcher", () => ({ installShortcutDispatcher: () => () => {} }));
vi.mock("./features/sessions/SessionSidebar", () => ({ SessionSidebar: () => <div data-testid="sidebar" /> }));
vi.mock("./features/chat/SessionView", () => ({ SessionView: ({ sessionId }: { sessionId: string }) => <div data-testid="session">{sessionId}</div> }));
vi.mock("./features/chat/Composer", () => ({ Composer: ({ sessionId }: { sessionId: string }) => <div data-testid="composer">{sessionId}</div> }));
vi.mock("./features/sessions/ForkDraftView", () => ({ ForkDraftView: () => <div data-testid="fork">fork</div> }));
vi.mock("./features/home/StartPage", () => ({ StartPage: () => <div data-testid="home">home</div> }));
vi.mock("./features/inbox/InboxPage", () => ({ InboxPage: () => <div data-testid="inbox">inbox</div> }));
vi.mock("./features/settings/SettingsOverlay", () => ({ SettingsOverlay: () => null }));
vi.mock("./components/CenterHeader", () => ({ CenterHeader: () => null, CENTER_WITHOUT_RIGHT_PANEL: { has: (view: string) => ["inbox", "schedules", "skills"].includes(view) } }));
vi.mock("./components/BottomBar", () => ({ BottomBar: () => null }));
vi.mock("./components/RightAside", () => ({ RightAside: () => null }));
vi.mock("./features/backlog/QuickCapture", () => ({ QuickCapture: () => null }));
vi.mock("./features/sidechat/HandbackDialog", () => ({ HandbackDialog: () => null }));
vi.mock("./features/diagnose/DiagnoseDialog", () => ({ DiagnoseDialog: () => null }));
vi.mock("./features/chat/share/ShareImageDialog", () => ({ ShareImageDialog: () => null }));
vi.mock("./features/git/NewSessionDialog", () => ({ NewSessionDialog: () => null }));
vi.mock("./features/sessions/ResumeMissingCwdDialog", () => ({ ResumeMissingCwdDialog: () => null }));

import App from "./App";
import { useUi } from "./stores/ui";
import { useSessions } from "./stores/sessions";
import { useSidebarStore } from "./features/sessions/sidebarStore";
import { usePendingSession } from "./features/sessions/pendingSession";
import { openForkDraft, useForkDraft } from "./features/sessions/forkDraft";
import { startNewSession } from "./features/sessions/newSession";

const session = (id: string, mode: SessionMeta["mode"]): SessionMeta => ({
	id, mode, cwd: `/repo/${id}`, file: `/sessions/${id}.jsonl`, title: id, label: "",
	status: "idle", updatedAt: "2026-01-02T00:00:00Z", createdAt: "2026-01-01T00:00:00Z",
	workspaceId: id, lastAssistant: "answer", live: false,
} as SessionMeta);

beforeEach(() => {
	localStorage.clear();
	backend.sessions = [session("a", "code"), session("b", "work")];
	backend.workspaces = [{ id: "a", path: "/repo/a", name: "A", kind: "project", mode: "code", sort: 0 }];
	useSessions.setState({ sessions: Object.fromEntries(backend.sessions.map((s) => [s.id, s])), workspaces: backend.workspaces, hasLoaded: false, loadError: null });
	useSidebarStore.setState({ activeMode: "code" });
	usePendingSession.setState({ drafts: {}, selectedId: null });
	useForkDraft.setState({ draft: null });
	useUi.setState({ centerView: "home", previousCenterView: null, selectedSessionId: null, lastSessionId: null, sidebarOpen: false, rightOpen: false, modal: null });
});
afterEach(cleanup);

describe("shell navigation ownership", () => {
	it("72: follows a cross-space selection with the sidebar unmounted", async () => {
		const view = render(<App />);
		act(() => useUi.getState().selectSession("b"));
		await waitFor(() => expect(useSidebarStore.getState().activeMode).toBe("work"));
		expect(view.getByTestId("session").textContent).toBe("b");
		act(() => useUi.getState().setSidebarOpen(true));
		expect(view.getByTestId("sidebar")).toBeTruthy();
		expect(useSidebarStore.getState().activeMode).toBe("work");
	});

	it("72: follows the selected session when its metadata arrives later", async () => {
		useSessions.setState({ sessions: {} });
		render(<App />);
		act(() => useUi.getState().selectSession("b"));
		act(() => useSessions.getState().upsert([session("b", "work")]));
		await waitFor(() => expect(useSidebarStore.getState().activeMode).toBe("work"));
	});

	it("74: new-session navigation replaces a fork draft in the rendered center", async () => {
		const view = render(<App />);
		act(() => openForkDraft("a"));
		expect(view.getByTestId("fork")).toBeTruthy();
		await act(async () => { await startNewSession(); });
		const id = usePendingSession.getState().selectedId;
		expect(id).toBeTruthy();
		expect(useForkDraft.getState().draft).toBeNull();
		expect(view.queryByTestId("fork")).toBeNull();
		expect(view.getByTestId("composer").textContent).toBe(id);
	});

	it("74: new-session without a workspace clears fork priority and shows the launcher", async () => {
		useSessions.setState({ workspaces: [] });
		const view = render(<App />);
		act(() => openForkDraft("a"));
		await act(async () => { await startNewSession(); });
		expect(useForkDraft.getState().draft).toBeNull();
		expect(usePendingSession.getState().selectedId).toBeNull();
		expect(view.queryByTestId("fork")).toBeNull();
		expect(view.getByTestId("home")).toBeTruthy();
	});

	it.each(["settings", "inbox"] as const)("75: preserves %s opened before startup loading completes", async (page) => {
		useUi.setState({ lastSessionId: "a" });
		render(<App />);
		act(() => page === "settings" ? useUi.getState().openSettings() : useUi.getState().setCenter(page));
		act(() => useSessions.setState({ hasLoaded: true }));
		expect(useUi.getState().centerView).toBe(page);
		expect(useUi.getState().selectedSessionId).toBeNull();
	});

	it.each(["b", "missing"])("75: a last session outside the launch space (%s) cannot clear a user page", (last) => {
		useUi.setState({ lastSessionId: last });
		render(<App />);
		act(() => useUi.getState().setCenter("inbox"));
		act(() => useSessions.setState({ hasLoaded: true }));
		expect(useUi.getState().centerView).toBe("inbox");
		expect(useUi.getState().lastSessionId).toBe(last);
	});

	it("75: returning home during loading is still explicit navigation", () => {
		useUi.setState({ lastSessionId: "a" });
		const view = render(<App />);
		act(() => { useUi.getState().setCenter("inbox"); useUi.getState().setCenter("home"); });
		act(() => useSessions.setState({ hasLoaded: true }));
		expect(view.getByTestId("home")).toBeTruthy();
		expect(useUi.getState().selectedSessionId).toBeNull();
	});

	it("75: still restores the last session on an untouched launch page", () => {
		useUi.setState({ lastSessionId: "a" });
		const view = render(<App />);
		act(() => useSessions.setState({ hasLoaded: true }));
		expect(view.getByTestId("session").textContent).toBe("a");
	});
});
