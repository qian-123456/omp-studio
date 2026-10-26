import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionMeta } from "../../lib/contracts";
import { useComposer } from "../../stores/composer";
import { useModelCatalog } from "../../stores/modelCatalog";
import { useSessions } from "../../stores/sessions";
import { useUi } from "../../stores/ui";
import {
	discardDraft,
	hasMeaningfulDraft,
	prewarmDraft,
	releaseBlankDraft,
	sendFromDraft,
	setDraftModel,
	setDraftThinking,
} from "./draftSession";
import { usePendingSession } from "./pendingSession";

const createSession = vi.fn();
const rpcSend = vi.fn();
const rpcRetain = vi.fn();
const rpcRelease = vi.fn();
const rpcTouch = vi.fn();
const deleteSession = vi.fn();

vi.mock("../../lib/createSession", () => ({
	createSession: (...a: unknown[]) => createSession(...a),
}));
vi.mock("../../lib/ipc", async (orig) => ({
	...(await orig<typeof import("../../lib/ipc")>()),
	rpcSend: (...a: unknown[]) => rpcSend(...a),
	rpcRetain: (...a: unknown[]) => rpcRetain(...a),
	rpcRelease: (...a: unknown[]) => rpcRelease(...a),
	rpcTouch: (...a: unknown[]) => rpcTouch(...a),
	deleteSession: (...a: unknown[]) => deleteSession(...a),
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

const stub = { id: "real-1", cwd: "/repo", title: "", label: "", status: "idle", lastAssistant: null } as unknown as SessionMeta;
type Created = { sessionId: string; stub: SessionMeta };

beforeEach(() => {
	for (const m of [createSession, rpcSend, rpcRetain, rpcRelease, rpcTouch, deleteSession]) m.mockReset();
	rpcSend.mockResolvedValue({});
	rpcRetain.mockResolvedValue(undefined);
	rpcRelease.mockResolvedValue(undefined);
	rpcTouch.mockResolvedValue(undefined);
	deleteSession.mockResolvedValue(undefined);
	usePendingSession.setState({ drafts: {}, selectedId: null });
	useComposer.setState({ drafts: {}, images: {}, files: {}, annotations: {}, planModes: {} });
	useSessions.setState({ sessions: {} });
	useUi.setState({ selectedSessionId: null, centerView: "session" });
	useModelCatalog.setState({
		models: [
			{ provider: "a", id: "m1", name: "m1", thinking: ["low", "high"] },
			{ provider: "a", id: "m2", name: "m2", thinking: ["low"] },
		],
	});
});

const open = () => usePendingSession.getState().open({ cwd: "/repo" });

describe("hasMeaningfulDraft", () => {
	it("is false for blank or whitespace-only input and true for any real input", () => {
		const id = open();
		expect(hasMeaningfulDraft(id)).toBe(false);
		useComposer.getState().setDraft(id, "   ");
		expect(hasMeaningfulDraft(id)).toBe(false);
		useComposer.getState().setDraft(id, "hi");
		expect(hasMeaningfulDraft(id)).toBe(true);
		useComposer.getState().setDraft(id, "");
		useComposer.getState().setPlanMode(id, true);
		expect(hasMeaningfulDraft(id)).toBe(true);
		useComposer.getState().setPlanMode(id, false);
		setDraftThinking(id, "high");
		expect(hasMeaningfulDraft(id)).toBe(true);
	});
});

describe("prewarmDraft", () => {
	it("is single-flight and retains the process once", async () => {
		const d = deferred<Created>();
		createSession.mockReturnValue(d.promise);
		const id = open();
		const a = prewarmDraft(id);
		const b = prewarmDraft(id);
		expect(a).toBe(b);
		d.resolve({ sessionId: "real-1", stub });
		expect(await a).toBe("real-1");
		expect(await prewarmDraft(id)).toBe("real-1");
		expect(createSession).toHaveBeenCalledTimes(1);
		expect(rpcRetain).toHaveBeenCalledTimes(1);
		expect(rpcRetain).toHaveBeenCalledWith("real-1");
	});

	it("keeps the draft and records the error when the spawn fails", async () => {
		createSession.mockRejectedValue(new Error("spawn failed"));
		const id = open();
		useComposer.getState().setDraft(id, "keep me");
		await expect(prewarmDraft(id)).rejects.toThrow("spawn failed");
		const draft = usePendingSession.getState().drafts[id];
		expect(draft.startError).toContain("spawn failed");
		expect(draft.sessionId).toBeNull();
		expect(useComposer.getState().drafts[id]).toBe("keep me");
	});
});

describe("sendFromDraft", () => {
	it("queues behind the spawn, applies model then thinking, and sends exactly once", async () => {
		const d = deferred<Created>();
		createSession.mockReturnValue(d.promise);
		const id = open();
		useComposer.getState().setDraft(id, "fix the bug");
		setDraftModel(id, "a/m1");
		setDraftThinking(id, "high");
		const order: string[] = [];
		rpcSend.mockImplementation(async (_sid: string, cmd: { type: string }) => {
			order.push(cmd.type);
			return {};
		});
		const send = vi.fn(async () => {
			order.push("send");
		});

		const first = sendFromDraft(id, send);
		const second = sendFromDraft(id, send); // double Enter
		expect(send).not.toHaveBeenCalled();
		d.resolve({ sessionId: "real-1", stub });
		await Promise.all([first, second]);

		expect(send).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledWith("real-1");
		expect(createSession).toHaveBeenCalledTimes(1);
		expect(order).toEqual(["set_model", "set_thinking_level", "get_state", "send"]);
		expect(rpcSend).toHaveBeenCalledWith("real-1", { type: "set_thinking_level", level: "high" });
		// Composer input moved to the real session; the draft is gone and the view swapped.
		expect(useComposer.getState().drafts["real-1"]).toBe("fix the bug");
		expect(usePendingSession.getState().drafts[id]).toBeUndefined();
		expect(useUi.getState().selectedSessionId).toBe("real-1");
		expect(rpcRelease).toHaveBeenCalledWith("real-1");
	});

	it("rejects with the draft intact when no process can start", async () => {
		createSession.mockRejectedValue(new Error("no omp"));
		const id = open();
		useComposer.getState().setDraft(id, "hello");
		const send = vi.fn();
		await expect(sendFromDraft(id, send)).rejects.toThrow("no omp");
		expect(send).not.toHaveBeenCalled();
		expect(usePendingSession.getState().drafts[id].startError).toContain("no omp");
		expect(useComposer.getState().drafts[id]).toBe("hello");
	});
});

describe("setDraftModel", () => {
	it("keeps a chosen thinking level only when the new model supports it", () => {
		const id = open();
		setDraftThinking(id, "high");
		setDraftModel(id, "a/m1");
		expect(usePendingSession.getState().drafts[id].thinking).toBe("high");
		setDraftModel(id, "a/m2");
		expect(usePendingSession.getState().drafts[id].thinking).toBeNull();
	});
});

describe("releaseBlankDraft / discardDraft", () => {
	it("releases an idle blank prewarm but keeps the draft", async () => {
		createSession.mockResolvedValue({ sessionId: "real-1", stub });
		const id = open();
		await prewarmDraft(id);
		await releaseBlankDraft(id);
		expect(usePendingSession.getState().drafts[id].sessionId).toBeNull();
		expect(rpcRelease).toHaveBeenCalledWith("real-1");
		expect(deleteSession).toHaveBeenCalledWith("real-1");
	});

	it("never releases a draft that holds input", async () => {
		createSession.mockResolvedValue({ sessionId: "real-1", stub });
		const id = open();
		await prewarmDraft(id);
		useComposer.getState().setDraft(id, "text");
		await releaseBlankDraft(id);
		expect(usePendingSession.getState().drafts[id].sessionId).toBe("real-1");
		expect(rpcRelease).not.toHaveBeenCalled();
	});

	it("explicit discard removes the draft, its input and the process", async () => {
		createSession.mockResolvedValue({ sessionId: "real-1", stub });
		const id = open();
		useComposer.getState().setDraft(id, "text");
		await prewarmDraft(id);
		await discardDraft(id);
		expect(usePendingSession.getState().drafts[id]).toBeUndefined();
		expect(useComposer.getState().drafts[id]).toBeUndefined();
		expect(deleteSession).toHaveBeenCalledWith("real-1");
	});
});
