import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { useComposer } from "../../stores/composer";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import { startSessionOptimistic, usePendingSession } from "./pendingSession";

const createSession = vi.fn();
const sendPrompt = vi.fn().mockResolvedValue(undefined);

vi.mock("../../lib/createSession", () => ({
	createSession: (...a: unknown[]) => createSession(...a),
}));
vi.mock("../chat/send", () => ({
	sendPrompt: (...a: unknown[]) => sendPrompt(...a),
}));

function deferred<T>() {
	let resolve!: (v: T) => void;
	let reject!: (e: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

const stub = { id: "real-1", cwd: "/repo" } as SessionMeta;

beforeEach(() => {
	createSession.mockReset();
	sendPrompt.mockClear();
	usePendingSession.setState({ pending: null });
	useUi.setState({ selectedSessionId: null, centerView: "home" });
	useComposer.setState({ drafts: {} });
	useSessions.setState({ sessions: {} });
});

describe("startSessionOptimistic", () => {
	it("shows the placeholder immediately and moves typed text into the real composer", async () => {
		const d = deferred<{ sessionId: string; stub: SessionMeta }>();
		createSession.mockReturnValue(d.promise);
		const run = startSessionOptimistic({ cwd: "/repo" });

		expect(useUi.getState().centerView).toBe("session");
		expect(useUi.getState().selectedSessionId).toBeNull();
		usePendingSession.getState().setText("fix the bug");

		d.resolve({ sessionId: "real-1", stub });
		await run;

		expect(useUi.getState().selectedSessionId).toBe("real-1");
		expect(useComposer.getState().drafts["real-1"]).toBe("fix the bug");
		expect(usePendingSession.getState().pending).toBeNull();
		expect(sendPrompt).not.toHaveBeenCalled();
	});

	it("sends the text once ready when Enter was pressed before the session was up", async () => {
		const d = deferred<{ sessionId: string; stub: SessionMeta }>();
		createSession.mockReturnValue(d.promise);
		const run = startSessionOptimistic({ cwd: "/repo" });
		usePendingSession.getState().setText("hello");
		usePendingSession.getState().submit();
		d.resolve({ sessionId: "real-1", stub });
		await run;

		expect(sendPrompt).toHaveBeenCalledWith("real-1", "hello");
		expect(useComposer.getState().drafts["real-1"]).toBeUndefined();
	});

	it("keeps slash commands as a draft instead of sending them literally", async () => {
		createSession.mockResolvedValue({ sessionId: "real-1", stub });
		const run = startSessionOptimistic({ cwd: "/repo" });
		usePendingSession.getState().setText("/model");
		usePendingSession.getState().submit();
		await run;
		expect(sendPrompt).not.toHaveBeenCalled();
		expect(useComposer.getState().drafts["real-1"]).toBe("/model");
	});

	it("does not steal focus when the user navigated away, but keeps the typed text", async () => {
		const d = deferred<{ sessionId: string; stub: SessionMeta }>();
		createSession.mockReturnValue(d.promise);
		const run = startSessionOptimistic({ cwd: "/repo" });
		usePendingSession.getState().setText("later");
		useUi.getState().selectSession("other");
		d.resolve({ sessionId: "real-1", stub });
		await run;

		expect(useUi.getState().selectedSessionId).toBe("other");
		expect(useComposer.getState().drafts["real-1"]).toBe("later");
	});

	it("returns to the start page when creation fails", async () => {
		createSession.mockRejectedValue(new Error("boom"));
		await startSessionOptimistic({ cwd: "/repo" });
		expect(usePendingSession.getState().pending).toBeNull();
		expect(useUi.getState().centerView).toBe("home");
	});
});
