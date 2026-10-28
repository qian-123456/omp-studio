import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
globalThis.localStorage = {
	getItem: (k: string) => mem.get(k) ?? null,
	setItem: (k: string, v: string) => void mem.set(k, String(v)),
	removeItem: (k: string) => void mem.delete(k),
	clear: () => mem.clear(),
	key: () => null,
	get length() {
		return mem.size;
	},
} as Storage;

const rpcSend = vi.fn();
const ensureLive = vi.fn();
const confirmDialog = vi.fn();

vi.mock("../../lib/ipc", () => ({
	rpcSend: (...a: unknown[]) => rpcSend(...a),
	takeoverExternal: vi.fn(),
	privacyClassify: vi.fn(),
	privacyMark: vi.fn(),
}));
vi.mock("../../lib/dialogs", () => ({
	confirmDialog: (...a: unknown[]) => confirmDialog(...a),
	errMsg: String,
}));
vi.mock("../../lib/ensureLive", async (orig) => ({
	...(await orig<typeof EnsureLiveModule>()),
	ensureLive: (...a: unknown[]) => ensureLive(...a),
}));
vi.mock("../settings/store", () => ({
	useSettings: Object.assign(() => true, { getState: () => ({ settings: { queueAutoSend: true } }) }),
}));

import type * as EnsureLiveModule from "../../lib/ensureLive";
import { ResumeCancelledError, isResumeCancelled } from "../../lib/ensureLive";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useComposer } from "../../stores/composer";
import { abortTurn, interruptAndWait, sendPrompt, useAbortState } from "./send";
import { heldQueueItems, isHeldAutoSendPaused, resumeHeldAutoSend, useHeldQueue } from "./heldQueue";
import { drainNext } from "./QueuedBar";

const SID = "s1";
const echoes = () => useLive.getState().sessions[SID]?.pendingUserEchoes ?? [];

beforeEach(() => {
	resumeHeldAutoSend(SID);
	useHeldQueue.setState({ queues: {}, dismissed: {} });
	rpcSend.mockReset().mockResolvedValue(undefined);
	ensureLive.mockReset().mockResolvedValue({});
	confirmDialog.mockReset();
	useLive.setState({ sessions: {} });
	useSessions.setState({ sessions: {} });
});

describe("sendPrompt rollback", () => {
	it("removes its echo when rpcSend fails, so a retry doesn't duplicate", async () => {
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true } } });
		rpcSend.mockRejectedValueOnce(new Error("boom"));
		await expect(sendPrompt(SID, "hi")).rejects.toThrow("boom");
		expect(echoes()).toHaveLength(0);
	});

	it("removes its echo when the resume dialog is cancelled", async () => {
		ensureLive.mockRejectedValueOnce(new ResumeCancelledError());
		const onEchoed = vi.fn();
		const err = await sendPrompt(SID, "hi", { onEchoed }).catch((e) => e);
		expect(isResumeCancelled(err)).toBe(true);
		expect(onEchoed).toHaveBeenCalled();
		expect(echoes()).toHaveLength(0);
	});

	it("keeps the echo on success", async () => {
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true } } });
		await sendPrompt(SID, "hi");
		expect(echoes()).toHaveLength(1);
	});

	it("throws ResumeCancelledError (no echo) when takeover is declined", async () => {
		useSessions.setState({ sessions: { [SID]: { status: "external" } as never } });
		confirmDialog.mockResolvedValue(false);
		const err = await sendPrompt(SID, "hi").catch((e) => e);
		expect(isResumeCancelled(err)).toBe(true);
		expect(echoes()).toHaveLength(0);
		expect(rpcSend).not.toHaveBeenCalled();
	});
});

describe("abortTurn", () => {
	it("does not let an earlier prompt acknowledgement clear a newer stop", async () => {
		vi.stubGlobal("window", globalThis);
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: true } } });
		let acknowledge!: () => void;
		rpcSend.mockImplementationOnce(() => new Promise<void>((resolve) => { acknowledge = resolve; }));
		const sending = sendPrompt(SID, "already in flight");
		await abortTurn(SID);
		acknowledge();
		await sending;
		expect(isHeldAutoSendPaused(SID)).toBe(true);
	});
	it.each(["before response", "after response"])("does not auto-send held text when the stop frame arrives %s", async (timing) => {
		vi.stubGlobal("window", globalThis);
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: true } } });
		useHeldQueue.getState().push(SID, "keep for later", [{ id: "img", path: "/a.png", marker: "[Image #1]" }]);
		const end = () => useLive.setState((s) => ({ sessions: { ...s.sessions, [SID]: { ...s.sessions[SID], streaming: false } } }));
		rpcSend.mockImplementationOnce(async () => {
			if (timing === "before response") end();
			return {};
		});
		await abortTurn(SID);
		if (timing === "after response") end();
		await Promise.resolve();
		expect(rpcSend).toHaveBeenCalledTimes(1);
		expect(isHeldAutoSendPaused(SID)).toBe(true);
		expect(heldQueueItems(SID)).toMatchObject([{ text: "keep for later", images: [{ path: "/a.png" }] }]);
		// An explicit send remains available and resumes subsequent auto-send behavior.
		expect(await drainNext(SID)).toBe(true);
		expect(isHeldAutoSendPaused(SID)).toBe(false);
		expect(heldQueueItems(SID)).toEqual([]);
	});

	it("does not pause held auto-send for an intentional interrupt", async () => {
		vi.stubGlobal("window", globalThis);
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: true } } });
		rpcSend.mockImplementationOnce(async () => {
			useLive.setState((s) => ({ sessions: { ...s.sessions, [SID]: { ...s.sessions[SID], streaming: false } } }));
			return {};
		});
		expect(await interruptAndWait(SID, 10)).toBe(true);
		expect(isHeldAutoSendPaused(SID)).toBe(false);
	});

	it("keeps held auto-send paused when an explicit retry fails", async () => {
		vi.stubGlobal("window", globalThis);
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: true } } });
		await abortTurn(SID);
		rpcSend.mockRejectedValueOnce(new Error("offline"));
		await expect(sendPrompt(SID, "retry")).rejects.toThrow("offline");
		expect(isHeldAutoSendPaused(SID)).toBe(true);
	});
	it("hands queued steer text back to the composer draft and drops its echo", async () => {
		vi.stubGlobal("window", globalThis);
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: true } } });
		useLive.getState().addUserEcho(SID, "steer me", undefined, true);
		useComposer.setState({ drafts: {} });
		rpcSend.mockResolvedValueOnce({
			type: "response",
			command: "abort_and_restore_queue",
			success: true,
			data: { steering: [{ text: "steer me" }], followUp: [] },
		});
		await abortTurn(SID);
		expect(rpcSend).toHaveBeenCalledWith(SID, { type: "abort_and_restore_queue" });
		expect(echoes()).toHaveLength(0);
		expect(useComposer.getState().drafts[SID]).toBe("steer me");
		useAbortState.getState().setAborting(SID, false);
	});
});
