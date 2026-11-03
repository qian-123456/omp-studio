// @vitest-environment jsdom
/**
 * Regression tests for the persistent stop-timeout hint (任务 D3): the banner
 * appears when the stop request times out, its two actions retry the stop /
 * restart the session, and it disappears once the turn really ends.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcRestart, abortTurn } = vi.hoisted(() => ({
	rpcRestart: vi.fn(),
	abortTurn: vi.fn(),
}));
vi.mock("../../lib/ipc", () => ({ rpcRestart: (...a: unknown[]) => rpcRestart(...a) }));
vi.mock("./send", () => ({
	abortTurn: (...a: unknown[]) => abortTurn(...a),
}));

import { useLive } from "../../stores/live";
import { useStopHint } from "./stopHint";
import { StopTimeoutBanner } from "./StopTimeoutBanner";

const SID = "stop-hint-session";
let root: Root;
let container: HTMLDivElement;

const render = () => {
	act(() => {
		root.render(createElement(StopTimeoutBanner, { sessionId: SID }));
	});
	return container;
};

const buttons = () => Array.from(container.querySelectorAll<HTMLButtonElement>("button"));

beforeEach(() => {
	vi.clearAllMocks();
	useStopHint.setState({ timedOut: {} });
	useLive.setState({ sessions: {} });
	container = document.createElement("div");
	root = createRoot(container);
	const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
	act(() => root.unmount());
});

describe("StopTimeoutBanner", () => {
	it("renders nothing until the stop request timed out", () => {
		render();
		expect(container.querySelector("[data-stop-timeout-banner]")).toBeNull();
	});

	it("appears persistently on show() and explains the situation", () => {
		act(() => useStopHint.getState().show(SID));
		render();
		expect(container.querySelector("[data-stop-timeout-banner]")).not.toBeNull();
		expect(container.textContent).toContain("停止请求未响应");
		const labels = buttons().map((b) => b.textContent);
		expect(labels).toEqual(["再次尝试停止", "重启会话"]);
	});

	it("「再次尝试停止」 re-sends the turn-level stop and keeps the hint on failure", async () => {
		act(() => useStopHint.getState().show(SID));
		render();
		abortTurn.mockRejectedValueOnce(new Error("still stuck"));
		await act(async () => {
			await buttons()[0].click();
		});
		expect(abortTurn).toHaveBeenCalledWith(SID);
		expect(useStopHint.getState().timedOut[SID]).toBe(true);
	});

	it("「重启会话」 goes through rpc_restart, keeps history, and retires the hint", async () => {
		act(() => useStopHint.getState().show(SID));
		render();
		rpcRestart.mockResolvedValueOnce({});
		await act(async () => {
			await buttons()[1].click();
		});
		expect(rpcRestart).toHaveBeenCalledWith(SID);
		expect(useStopHint.getState().timedOut[SID]).toBeUndefined();
	});

	it("disappears by itself once the turn really ends", () => {
		act(() => {
			useLive.setState((s) => ({
				sessions: {
					...s.sessions,
					[SID]: {
						streaming: true,
						state: null,
						pendingUi: [],
						subagents: {},
						streamingMessage: null,
						commands: [],
						commandOutputs: [],
						pendingCommand: null,
						liveRequests: [],
						flowNotices: [],
						ompQueue: { steering: [], followUp: [] },
						tools: {},
						items: [],
						pendingUserEchoes: [],
						nextOffset: 0,
						alive: true,
						scrollRequest: null,
						thinkingStartedAt: null,
						thinkingEndedAt: null,
						thinkingDurations: {},
					},
				},
			}));
		});
		// The turn is running and the stop request just timed out.
		act(() => useStopHint.getState().show(SID));
		render();
		expect(container.querySelector("[data-stop-timeout-banner]")).not.toBeNull();
		act(() => {
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_end", isTerminal: true, messages: [] } });
		});
		expect(container.querySelector("[data-stop-timeout-banner]")).toBeNull();
	});
});
