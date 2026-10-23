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

import type * as EnsureLiveModule from "../../lib/ensureLive";
import { ResumeCancelledError, isResumeCancelled } from "../../lib/ensureLive";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useComposer } from "../../stores/composer";
import { abortTurn, sendPrompt, useAbortState } from "./send";

const SID = "s1";
const echoes = () => useLive.getState().sessions[SID]?.pendingUserEchoes ?? [];

beforeEach(() => {
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
