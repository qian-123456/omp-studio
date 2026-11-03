import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLive } from "./live";

const SID = "s-probe";

const frame = (f: Record<string, unknown>) =>
	useLive.getState().reduceFrame({ sessionId: SID, frame: f });

const live = () => useLive.getState().sessions[SID];

beforeEach(() => {
	useLive.setState({ sessions: {} });
	vi.restoreAllMocks();
});

describe("probe: mid-flight attach replay window (DesktopTurn GhostFree)", () => {
	it("agent_start while idle stamps turnStartedAt → late replay after end is refused", () => {
		frame({ type: "agent_start" });
		frame({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } });
		expect(live().turnStartedAt).not.toBeNull();
		frame({ type: "agent_end", isTerminal: true });
		expect(live().streaming).toBe(false);
		frame({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "hello!" }] } });
		// turnSettled() is true here: the late snapshot is refused.
		expect(live().streamingMessage).toBeNull();
	});

	it("reattach via get_state(isStreaming) stamps turnStartedAt → late replay after end is refused", () => {
		// Mid-flight attach: the app never saw agent_start (live.ts:1497-1506),
		// but the get_state snapshot approximates the turn's start.
		frame({ type: "response", command: "get_state", success: true, data: { isStreaming: true } });
		expect(live().streaming).toBe(true);
		expect(live().turnStartedAt ?? null).not.toBeNull();
		frame({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } });
		expect(live().streamingMessage).not.toBeNull();
		frame({ type: "agent_end", isTerminal: true });
		expect(live().streaming).toBe(false);
		expect(live().streamingMessage).toBeNull();
		// A late replayed snapshot after the settled turn:
		frame({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "hello!" }] } });
		// turnSettled() is true here: the late snapshot is refused, no ghost.
		expect(live().streamingMessage).toBeNull();
		// ...and the window stays closed across the post-turn transcript refetch.
		frame({ type: "response", command: "get_state", success: true, data: { isStreaming: false } });
		frame({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "hello!!" }] } });
		expect(live().streamingMessage).toBeNull();
		// It closes only when the NEXT turn starts (stampTurnStart): that turn
		// runs normally, and once IT ends, late replays are refused again.
		frame({ type: "agent_start" });
		expect(live().turnStartedAt).not.toBeNull();
		frame({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "next" }] } });
		expect(live().streamingMessage).not.toBeNull(); // legit: this turn is running
		frame({ type: "agent_end", isTerminal: true });
		frame({ type: "message_update", message: { role: "assistant", content: [{ type: "text", text: "x" }] } });
		expect(live().streamingMessage).toBeNull(); // window closed by the new start frame
	});
});
