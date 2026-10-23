import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/ipc", () => ({ rpcRestart: vi.fn(), rpcOmpStaleness: vi.fn() }));
vi.mock("../lib/toast", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { rpcOmpStaleness, rpcRestart } from "../lib/ipc";
import { toast } from "../lib/toast";
import { emptySessionLive, type SessionLive, useLive } from "./live";
import {
	__resetForTests,
	classifyLive,
	setExternalUpdateHandler,
	switchPendingNow,
	syncStaleness,
	useOmpUpdateSessions,
} from "./ompUpdateSessions";

const restart = vi.mocked(rpcRestart);
const staleness = vi.mocked(rpcOmpStaleness);

function live(p: Partial<SessionLive>): SessionLive {
	return { ...emptySessionLive(), ...p };
}

function setSessions(sessions: Record<string, SessionLive>): void {
	useLive.setState({ sessions });
}

function patch(id: string, p: Partial<SessionLive>): void {
	const cur = useLive.getState().sessions;
	useLive.setState({ sessions: { ...cur, [id]: { ...cur[id], ...p } } });
}

function report(fingerprint: string | null, staleSessionIds: string[]): void {
	staleness.mockResolvedValue({ fingerprint, staleSessionIds });
}

const pending = () => useOmpUpdateSessions.getState().pendingSessionIds;

beforeEach(() => {
	__resetForTests();
	restart.mockReset();
	restart.mockResolvedValue({} as never);
	staleness.mockReset();
	report("fp1", []);
	vi.mocked(toast.success).mockReset();
	vi.mocked(toast.error).mockReset();
	useLive.setState({ sessions: {} });
});

afterEach(() => {
	__resetForTests();
});

describe("classifyLive", () => {
	it("classifies dead / idle / busy", () => {
		expect(classifyLive(undefined)).toBe("dead");
		expect(classifyLive(live({ alive: false }))).toBe("dead");
		expect(classifyLive(live({ alive: true }))).toBe("idle");
		expect(classifyLive(live({ alive: true, streaming: true }))).toBe("busy");
		expect(classifyLive(live({ alive: true, pendingUi: [{} as never] }))).toBe("busy");
	});
});

describe("syncStaleness", () => {
	it("restarts stale idle sessions, parks stale busy ones, leaves fresh ones alone", async () => {
		setSessions({
			idle: live({ alive: true }),
			busy: live({ alive: true, streaming: true }),
			dead: live({ alive: false }),
			fresh: live({ alive: true }),
		});
		report("fp2", ["idle", "busy", "dead"]);
		await syncStaleness();
		expect(restart).toHaveBeenCalledTimes(1);
		expect(restart).toHaveBeenCalledWith("idle");
		expect(pending()).toEqual(["busy"]);
		expect(useOmpUpdateSessions.getState().fingerprint).toBe("fp2");
	});

	it("restarts a pending session once it goes idle", async () => {
		setSessions({ busy: live({ alive: true, streaming: true }) });
		report("fp1", ["busy"]);
		await syncStaleness();
		expect(restart).not.toHaveBeenCalled();
		patch("busy", { streaming: false });
		expect(restart).toHaveBeenCalledWith("busy");
		expect(pending()).toEqual([]);
	});

	it("evicts sessions that die while pending", async () => {
		setSessions({ busy: live({ alive: true, streaming: true }) });
		report("fp1", ["busy"]);
		await syncStaleness();
		patch("busy", { alive: false, streaming: false });
		expect(pending()).toEqual([]);
		expect(restart).not.toHaveBeenCalled();
	});

	it("reports failed restarts once", async () => {
		vi.useFakeTimers();
		try {
			restart.mockRejectedValue(new Error("boom"));
			setSessions({ a: live({ alive: true }) });
			report("fp1", ["a"]);
			await syncStaleness();
			await vi.runAllTimersAsync();
			expect(toast.error).toHaveBeenCalledTimes(1);
			expect(toast.success).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});

	it("emits one aggregate success toast with the version", async () => {
		vi.useFakeTimers();
		try {
			setSessions({ a: live({ alive: true }), b: live({ alive: true }), c: live({ alive: true, streaming: true }) });
			report("fp2", ["a", "b", "c"]);
			await syncStaleness({ selfUpdate: true, version: "18.8.5" });
			patch("c", { streaming: false });
			await vi.runAllTimersAsync();
			expect(toast.success).toHaveBeenCalledTimes(1);
			expect(toast.success).toHaveBeenCalledWith("已将 3 个会话切换到 omp 18.8.5");
		} finally {
			vi.useRealTimers();
		}
	});

	it("calls the external-update handler when the fingerprint changes outside the app", async () => {
		const handler = vi.fn().mockResolvedValue("19.0.0");
		setExternalUpdateHandler(handler);
		await syncStaleness(); // first sight: fp1, not a change
		expect(handler).not.toHaveBeenCalled();
		setSessions({ a: live({ alive: true }) });
		report("fp2", ["a"]);
		await syncStaleness();
		expect(handler).toHaveBeenCalledTimes(1);
		expect(handler).toHaveBeenCalledWith(1);
		expect(restart).toHaveBeenCalledWith("a");
	});

	it("does not treat an in-app update as external", async () => {
		const handler = vi.fn().mockResolvedValue(null);
		setExternalUpdateHandler(handler);
		await syncStaleness();
		report("fp2", []);
		await syncStaleness({ selfUpdate: true });
		report(null, []);
		await syncStaleness();
		expect(handler).not.toHaveBeenCalled();
	});

	it("shares one run between overlapping callers", async () => {
		await Promise.all([syncStaleness(), syncStaleness(), syncStaleness()]);
		expect(staleness.mock.calls.length).toBeLessThanOrEqual(2);
	});
});

describe("switchPendingNow", () => {
	it("restarts only pending (stale, busy) sessions", async () => {
		setSessions({
			a: live({ alive: true, streaming: true }),
			b: live({ alive: true, streaming: true }),
		});
		report("fp1", ["a"]);
		await syncStaleness();
		expect(await switchPendingNow()).toBe(1);
		expect(restart.mock.calls.map((c) => c[0])).toEqual(["a"]);
		expect(pending()).toEqual([]);
	});
});
