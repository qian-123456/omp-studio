// Replay F1: 本地草稿首条发送在设置浮层打开期间完成。Public entrypoints only: usePendingSession.open,
// useUi.openSettings/closeSettings, sendFromDraft. Mocks only the process/IPC boundary.
import { beforeEach, describe, expect, it, vi } from "vitest";
const createSession = vi.hoisted(() => vi.fn());
vi.mock("<repo>/src/lib/createSession", () => ({ createSession: (...a: unknown[]) => createSession(...a) }));
vi.mock("<repo>/src/lib/ipc", async (orig) => ({
	...(await orig<any>()),
	rpcSend: vi.fn().mockResolvedValue({}), rpcRetain: vi.fn().mockResolvedValue(undefined),
	rpcRelease: vi.fn().mockResolvedValue(undefined), rpcTouch: vi.fn().mockResolvedValue(undefined),
	deleteSession: vi.fn().mockResolvedValue(undefined),
	forkSession: vi.fn(), terminalSetCurrentSession: vi.fn(),
}));
import { useComposer } from "<repo>/src/stores/composer";
import { useSessions } from "<repo>/src/stores/sessions";
import { useUi } from "<repo>/src/stores/ui";
import { sendFromDraft } from "<repo>/src/features/sessions/draftSession";
import { installDraftAutoCleanup } from "<repo>/src/features/sessions/newSession";
import { usePendingSession } from "<repo>/src/features/sessions/pendingSession";
import { useForkDraft, openForkDraft, sendFromForkDraft } from "<repo>/src/features/sessions/forkDraft";
import * as ipc from "<repo>/src/lib/ipc";

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }
const stub = { id: "real-1", cwd: "/repo", title: "", label: "", status: "idle", lastAssistant: null, mode: "code" } as any;

beforeEach(() => {
	usePendingSession.setState({ drafts: {}, selectedId: null });
	useComposer.setState({ drafts: {}, images: {}, files: {}, annotations: {} });
	useSessions.setState({ sessions: {} });
	useUi.setState({ selectedSessionId: null, centerView: "session", previousCenterView: null });
	installDraftAutoCleanup();
});

describe("F1 draft handoff completes while settings overlay is open", () => {
	it("user lands on the new real session after closing settings (like fork draft)", async () => {
		const spawn = deferred<{ sessionId: string; stub: any }>();
		createSession.mockReturnValue(spawn.promise);
		const id = usePendingSession.getState().open({ cwd: "/repo" });
		useUi.setState({ selectedSessionId: null, centerView: "session" });
		useComposer.getState().setDraft(id, "hello");
		const send = vi.fn().mockResolvedValue(undefined);
		const sending = sendFromDraft(id, send);          // user presses Enter
		useUi.getState().openSettings();                    // then opens settings while the process spawns
		spawn.resolve({ sessionId: "real-1", stub });
		await sending;
		expect(send).toHaveBeenCalledWith("real-1");        // message was sent into real-1
		useUi.getState().closeSettings();
		const ui = useUi.getState();
		console.log("AFTER close:", JSON.stringify({ view: ui.centerView, selected: ui.selectedSessionId, pendingSelected: usePendingSession.getState().selectedId }));
		expect(ui.selectedSessionId).toBe("real-1");        // user should see the session they just sent to
	});

	it("control: fork draft handles the same overlay timing", async () => {
		const parent = { id: "p1", mode: "code", status: "idle" } as any;
		useSessions.setState({ sessions: { p1: parent } });
		const fork = deferred<{ sessionId: string }>();
		vi.spyOn(ipc, "forkSession").mockReturnValue(fork.promise as any);
		vi.spyOn(useSessions.getState(), "load").mockResolvedValue(undefined as any);
		const fid = openForkDraft("p1");
		const sending = sendFromForkDraft(fid, "hi", {}, async () => {});
		useUi.getState().openSettings();
		fork.resolve({ sessionId: "child-1" });
		await sending;
		expect(useUi.getState().selectedSessionId).toBe("child-1");
	});
});
