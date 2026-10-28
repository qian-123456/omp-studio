// Replays of statechart findings against the real composer/sidechat modules (repository is read-only).
import { beforeEach, describe, expect, it, vi } from "vitest";

const R = "<repo>/src";
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
(globalThis as { window?: unknown }).window = globalThis;

const h = vi.hoisted(() => ({
	rpcSend: vi.fn(),
	createSession: vi.fn(),
	createSideChat: vi.fn(),
	sideChatAsk: vi.fn(),
}));

vi.mock("<repo>/src/lib/ipc", async (orig) => ({
	...(await orig<Record<string, unknown>>()),
	rpcSend: (...a: unknown[]) => h.rpcSend(...a),
	createSideChat: (...a: unknown[]) => h.createSideChat(...a),
	sideChatAsk: (...a: unknown[]) => h.sideChatAsk(...a),
	listSessions: vi.fn(async () => []),
	takeoverExternal: vi.fn(),
	privacyClassify: vi.fn(),
	privacyMark: vi.fn(),
}));
vi.mock("<repo>/src/lib/createSession", () => ({
	createSession: (...a: unknown[]) => h.createSession(...a),
}));
vi.mock("<repo>/src/features/settings/store", () => {
	const state = { settings: undefined as { queueAutoSend?: boolean } | undefined };
	return { useSettings: Object.assign((sel: (s: typeof state) => unknown) => sel(state), { getState: () => state }) };
});

import { emptySessionLive, useLive } from "<repo>/src/stores/live";
import { useSessions } from "<repo>/src/stores/sessions";
import { useHeldQueue, heldQueueItems } from "<repo>/src/features/chat/heldQueue";
import "<repo>/src/features/chat/QueuedBar";
import { abortTurn } from "<repo>/src/features/chat/send";
import { approvePlan } from "<repo>/src/features/chat/plan/planActions";
import { sendFirstMessage } from "<repo>/src/features/sidechat/sideChatActions";
import { useSideChatView } from "<repo>/src/features/sidechat/viewStore";

const SID = "main-1";
const frame = (sid: string, f: Record<string, unknown>) => useLive.getState().reduceFrame({ sessionId: sid, frame: f });
const prompts = () => h.rpcSend.mock.calls.filter((c) => (c[1] as { type?: string })?.type === "prompt");

beforeEach(() => {
	mem.clear();
	h.rpcSend.mockReset().mockResolvedValue({});
	h.createSession.mockReset();
	h.createSideChat.mockReset();
	h.sideChatAsk.mockReset();
	useLive.setState({ sessions: {} });
	useSessions.setState({ sessions: {} });
	useHeldQueue.setState({ queues: {}, dismissed: {} });
});

describe("held queue: stop then turn end (HeldQueue.StopDoesNotResendHeld)", () => {
	it("a held message typed during a turn is sent automatically after the user pressed stop", async () => {
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true } } });
		frame(SID, { type: "agent_start" });
		expect(useLive.getState().sessions[SID].streaming).toBe(true);
		useHeldQueue.getState().push(SID, "follow-up typed while streaming");
		await abortTurn(SID); // the stop button entry point (Composer.handleAbort)
		expect(h.rpcSend.mock.calls.map((c) => (c[1] as { type: string }).type)).toContain("abort_and_restore_queue");
		expect(prompts()).toHaveLength(0);
		frame(SID, { type: "agent_end", isTerminal: true }); // the aborted turn ends
		await vi.waitFor(() => expect(prompts().length).toBeGreaterThan(0));
		expect((prompts()[0][1] as { message: string }).message).toBe("follow-up typed while streaming");
		expect(heldQueueItems(SID)).toHaveLength(0);
	});
});

describe("plan approve execute (PlanApprove.FailedApprovalCanRetryAtOnce)", () => {
	it("leaves plan mode (exit command already sent) when the fresh session cannot be created", async () => {
		useSessions.setState({ sessions: { [SID]: { id: SID, cwd: "/w", workspaceId: "w", mode: "global" } as never } });
		h.createSession.mockRejectedValue(new Error("spawn failed"));
		await expect(approvePlan(SID, { planFile: "local://x-plan.md" }, "execute", null)).rejects.toThrow("spawn failed");
		const msgs = prompts().map((c) => (c[1] as { message: string }).message);
		expect(msgs).toEqual(["/plan-action approve execute"]); // exit sent, run never sent
	});
});

describe("side chat first ask failure (SideChat.EchoMeansMessageSent)", () => {
	it("keeps a user bubble for a message that was never sent and does not restore the text", async () => {
		h.createSideChat.mockResolvedValue({ sessionId: "child-1" });
		h.sideChatAsk.mockRejectedValue(new Error("ask failed"));
		await sendFirstMessage({ parentId: SID, tabId: "new:t1", text: "my question", model: null });
		expect(h.sideChatAsk).toHaveBeenCalledTimes(1);
		const echoes = useLive.getState().sessions["child-1"]?.pendingUserEchoes ?? [];
		expect(echoes).toHaveLength(1); // bubble stays although the prompt failed
		expect(useSideChatView.getState().pending["new:t1"] ?? null).toBeNull();
	});
});
