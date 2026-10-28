// @vitest-environment jsdom
// Replays F2/F3/F4 through the real <App/>, faking only the Tauri IPC/event boundary.
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const H = vi.hoisted(() => ({
	sessions: [] as any[], workspaces: [] as any[], gate: null as null | Promise<void>,
}));
vi.mock("@tauri-apps/api/core", () => ({
	invoke: vi.fn(async (cmd: string) => {
		if (cmd === "list_sessions") { if (H.gate) await H.gate; return H.sessions; }
		if (cmd === "list_workspaces") return H.workspaces;
		if (cmd === "get_transcript") return { sessionId: "x", items: [], nextOffset: 0, reset: true, tailId: null };
		if (cmd === "git_session_turns" || cmd === "git_worktree_turns") return [];
		if (cmd === "privacy_snapshot" || cmd.startsWith("privacy")) return { entries: [], rules: [] };
		if (cmd.startsWith("list_") || cmd.endsWith("_list")) return [];
		return null;
	}),
	convertFileSrc: (p: string) => p, Channel: class {},
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}), emit: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ hide: vi.fn(), onFocusChanged: async () => () => {}, onResized: async () => () => {}, isFullscreen: async () => false, setTitle: async () => {}, label: "main" }) }));
vi.mock("@tauri-apps/api/webview", () => ({ getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }) }));
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
globalThis.matchMedia ??= (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as any;

const B = "<repo>/src";
import App from "<repo>/src/App";
import { useUi } from "<repo>/src/stores/ui";
import { useSessions } from "<repo>/src/stores/sessions";
import { useSidebarStore } from "<repo>/src/features/sessions/sidebarStore";
import { usePendingSession } from "<repo>/src/features/sessions/pendingSession";
import { openForkDraft, useForkDraft } from "<repo>/src/features/sessions/forkDraft";
import { startNewSession, installDraftAutoCleanup } from "<repo>/src/features/sessions/newSession";
import { dispatchShortcut } from "<repo>/src/features/shortcuts/dispatcher";

const meta = (id: string, mode: string, ws: string, over: any = {}) => ({
	id, tool: "omp", file: `/x/${id}.jsonl`, cwd: `/p/${ws}`, title: `T-${id}`, label: "", createdAt: "2026-01-01T00:00:00Z",
	updatedAt: "2026-01-02T00:00:00Z", parentId: null, forkDepth: 0, status: "idle", unread: false, pending: null, live: false,
	externalPid: null, pinned: false, archived: false, workspaceId: ws, repoRoot: null, git: null, result: null,
	lastAssistant: "hi", model: null, attention: null, mode, groupId: null, createdByApp: true, ...over,
});
const wsOf = (id: string, mode: string) => ({ id, path: `/p/${id}`, name: id, kind: "project", sort: 0, mode });
const settle = () => act(async () => { await new Promise((x) => setTimeout(x, 60)); });

beforeEach(() => {
	localStorage.clear();
	H.gate = null;
	H.sessions = [meta("a", "code", "wsA"), meta("b", "research", "wsB")];
	H.workspaces = [wsOf("wsA", "code"), wsOf("wsB", "research")];
	useSessions.setState({ sessions: {}, workspaces: [], hasLoaded: false, loadError: null } as any);
	useSidebarStore.setState({ activeMode: "code" });
	usePendingSession.setState({ drafts: {}, selectedId: null });
	useForkDraft.setState({ draft: null });
	useUi.setState({ centerView: "home", previousCenterView: null, selectedSessionId: null, lastSessionId: null, sidebarOpen: true, modal: null, docPath: null } as any);
	installDraftAutoCleanup();
});
afterEach(() => cleanup());

describe("F2 selecting another space's session while the sidebar is collapsed", () => {
	it("control: sidebar open → space follows the selection", async () => {
		render(<App />); await settle();
		act(() => useUi.getState().selectSession("b")); await settle();
		console.log("F2 control activeMode =", useSidebarStore.getState().activeMode);
		expect(useSidebarStore.getState().activeMode).toBe("research");
	});
	it("sidebar collapsed (⌘B) → select b (as Inbox/Heatmap/Schedules do) → reopen", async () => {
		const r = render(<App />); await settle();
		act(() => useUi.getState().selectSession("a")); await settle();
		act(() => useUi.getState().toggleSidebar()); await settle();           // ⌘B collapse
		act(() => useUi.getState().selectSession("b")); await settle();       // e.g. Inbox entry
		act(() => useUi.getState().toggleSidebar()); await settle();           // ⌘B reopen
		const row = r.container.querySelector('[data-session-id="b"]');
		console.log("F2 activeMode =", useSidebarStore.getState().activeMode, "row b rendered =", !!row, "selected =", useUi.getState().selectedSessionId);
		expect(useSidebarStore.getState().activeMode).toBe("research");
	});
});

describe("F3 startup restore overrides what the user already opened", () => {
	it("opening Settings during the first session load is closed and replaced by the last session", async () => {
		localStorage.setItem("ompws:last-session", "a");
		let release!: () => void; H.gate = new Promise<void>((r) => { release = r; });
		useUi.setState({ lastSessionId: "a" } as any);
		render(<App />); await settle();
		act(() => useUi.getState().openSettings()); await settle();            // user hits ⌘, while list is loading
		expect(useUi.getState().centerView).toBe("settings");
		release(); await act(async () => { await useSessions.getState().load(); }); await settle();
		const ui = useUi.getState();
		console.log("F3 after load:", ui.centerView, ui.selectedSessionId);
		expect(ui.centerView).toBe("settings");
	});
});

describe("F4 new session while a fork draft is open", () => {
	it("⌘N shows the new draft, not the stale fork draft", async () => {
		H.sessions = [meta("a", "code", "wsA", { status: "working" })];
		const r = render(<App />); await settle();
		act(() => useUi.getState().selectSession("a")); await settle();
		act(() => { openForkDraft("a"); }); await settle();
		expect(r.container.textContent).toContain("发送第一条消息时将从这里创建分支");
		await act(async () => { await startNewSession(); }); await settle();
		const pendingId = usePendingSession.getState().selectedId;
		const composer = r.container.querySelector("[data-composer]")?.getAttribute("data-composer");
		console.log("F4 pendingSelected =", pendingId, "forkDraft =", !!useForkDraft.getState().draft, "visible composer =", composer);
		expect(composer).toBe(pendingId);
	});
});
