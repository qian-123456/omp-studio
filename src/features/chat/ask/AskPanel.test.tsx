// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptySessionLive, useLive } from "../../../stores/live";

const rpcUiRespond = vi.fn();
vi.mock("../../../lib/ipc", () => ({
	rpcUiRespond: (...a: unknown[]) => rpcUiRespond(...a),
}));
vi.mock("../../../lib/toast", () => ({ toast: { error: vi.fn() } }));

import { pruneAskState, useAskRouting } from "./AskPanel";

const SID = "ask-recovery";
const req = {
	sessionId: SID,
	receivedAt: "",
	request: {
		type: "extension_ui_request",
		id: "r1",
		method: "select",
		title: "Pick a colour",
		options: ["Red", "Blue", "Other (type your own)"],
	},
};

beforeEach(() => {
	rpcUiRespond.mockReset();
	useLive.setState({
		sessions: {
			[SID]: {
				...emptySessionLive(),
				tools: {
					t1: {
						toolCallId: "t1",
						toolName: "ask",
						status: "running",
						intent: null,
						text: "",
						details: null,
						args: {
							questions: [
								{ id: "c", question: "Pick a colour", options: [{ label: "Red" }, { label: "Blue" }] },
							],
						},
					},
				},
			},
		},
	});
});

describe("useAskRouting", () => {
	it("recovers after a failed submit so the next submit is sent again", async () => {
		rpcUiRespond.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(undefined);
		const { result } = renderHook(() => useAskRouting(SID, [req]));
		expect(result.current.route?.resolution.kind).toBe("present");

		act(() => result.current.submit([{ selected: ["Red"], custom: "" }]));
		await waitFor(() => expect(rpcUiRespond).toHaveBeenCalledTimes(1));
		await waitFor(() => expect(result.current.route?.resolution.kind).toBe("present"));

		act(() => result.current.submit([{ selected: ["Red"], custom: "" }]));
		await waitFor(() => expect(rpcUiRespond).toHaveBeenCalledTimes(2));
	});

	it("releases the composer as soon as the final answer is accepted", async () => {
		pruneAskState([SID]); // the previous test left an answered id behind
		rpcUiRespond.mockResolvedValue(undefined);
		const { result } = renderHook(() => useAskRouting(SID, [req]));
		act(() => result.current.submit([{ selected: ["Red"], custom: "" }]));
		await waitFor(() => expect(rpcUiRespond).toHaveBeenCalledTimes(1));
		// Well under the 4s fallback timer.
		await waitFor(() => expect(result.current.awaiting).toBe(false), { timeout: 1000 });
	});
});
