// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/ipc", () => ({ rpcListLive: vi.fn(), rpcRestart: vi.fn(), rpcSend: vi.fn() }));

import { rpcListLive, rpcRestart, rpcSend } from "../../lib/ipc";
import { useLive } from "../../stores/live";
import {
	__resetModelRegistrySyncForTests,
	isSessionRegistryStale,
	markLiveSessionsStale,
	prepareSessionForModelSelection,
} from "./modelRegistrySync";

const live = (patch: Record<string, unknown>) => ({ alive: true, streaming: false, pendingUi: [], ...patch });

describe("lazy registry refresh", () => {
	beforeEach(() => {
		__resetModelRegistrySyncForTests();
		vi.mocked(rpcSend).mockReset().mockResolvedValue(undefined as never);
		vi.mocked(rpcRestart).mockReset().mockResolvedValue({} as never);
		vi.mocked(rpcListLive).mockReset().mockResolvedValue([
			{ sessionId: "idle", sessionFile: "", pid: 1, cwd: "/" },
			{ sessionId: "busy", sessionFile: "", pid: 2, cwd: "/" },
		]);
		useLive.setState({ sessions: { idle: live({}), busy: live({ streaming: true }), other: live({}) } } as never);
	});

	it("marking stale after a provider save restarts nothing", async () => {
		await markLiveSessionsStale();
		expect(rpcRestart).not.toHaveBeenCalled();
		expect(isSessionRegistryStale("idle")).toBe(true);
		expect(isSessionRegistryStale("other")).toBe(false);
	});

	it("restarts only the stale idle session when a model is chosen for it", async () => {
		await markLiveSessionsStale();
		expect(await prepareSessionForModelSelection("idle")).toEqual({ status: "restarted" });
		expect(rpcRestart).toHaveBeenCalledTimes(1);
		expect(rpcRestart).toHaveBeenCalledWith("idle");
		// Restarted session is fresh now; repeated picks do not restart again.
		expect(await prepareSessionForModelSelection("idle")).toEqual({ status: "fresh" });
		expect(rpcRestart).toHaveBeenCalledTimes(1);
	});

	it("re-applies the held thinking level after the restart", async () => {
		useLive.setState({ sessions: { idle: live({ state: { thinkingLevel: "high" } }) } } as never);
		await markLiveSessionsStale();
		await prepareSessionForModelSelection("idle");
		expect(rpcSend).toHaveBeenCalledWith("idle", { type: "set_thinking_level", level: "high" });
	});

	it("keeps the held queue of every session untouched (frontend-persisted, busy sessions never restart)", async () => {
		const held = JSON.stringify([{ id: "h1", text: "later" }]);
		localStorage.setItem("ompws-held:busy", held);
		await markLiveSessionsStale();
		await prepareSessionForModelSelection("idle");
		await prepareSessionForModelSelection("busy");
		expect(localStorage.getItem("ompws-held:busy")).toBe(held);
		expect(rpcRestart).not.toHaveBeenCalledWith("busy");
	});

	it("never interrupts a busy session and leaves unaffected sessions alone", async () => {
		await markLiveSessionsStale();
		expect(await prepareSessionForModelSelection("busy")).toEqual({ status: "busy" });
		expect(await prepareSessionForModelSelection("other")).toEqual({ status: "fresh" });
		expect(rpcRestart).not.toHaveBeenCalled();
		expect(isSessionRegistryStale("busy")).toBe(true);
	});

	it("reports a failed restart without marking the session fresh", async () => {
		vi.mocked(rpcRestart).mockRejectedValueOnce(new Error("boom"));
		await markLiveSessionsStale();
		const res = await prepareSessionForModelSelection("idle");
		expect(res.status).toBe("failed");
		expect(isSessionRegistryStale("idle")).toBe(true);
		// No model or thinking command is sent on failure: the session keeps its selected model.
		expect(rpcSend).not.toHaveBeenCalled();
	});
});
