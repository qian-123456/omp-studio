// @vitest-environment jsdom
/** External (terminal-driven) sessions re-read the tail only while the window is visible. */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";

const SID = "ext1";

const h = vi.hoisted(() => ({ getTranscript: vi.fn() }));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		getTranscript: h.getTranscript,
		gitSessionTurns: vi.fn(async () => []),
		rpcPendingUi: vi.fn(async () => []),
		rpcSend: vi.fn(async () => ({})),
	};
});
vi.mock("./ChatTrace", () => ({ ChatTrace: () => null }));
vi.mock("./AnnotationMarkers", () => ({ AnnotationMarkers: () => null }));
vi.mock("./Composer", () => ({ Composer: () => null }));
vi.mock("./HeldQueueBar", () => ({ HeldQueueBar: () => null }));
vi.mock("./MessageList", () => ({ MessageList: () => null }));
vi.mock("./PendingUiCard", () => ({ PendingUiCard: () => null }));
vi.mock("./SelectionToolbar", () => ({ SelectionToolbar: () => null }));
vi.mock("./share/ShareSelectionBar", () => ({ ShareSelectionBar: () => null }));
vi.mock("./subagents/TopCapsule", () => ({ TopCapsule: () => null }));
vi.mock("./ask/AskPanel", () => ({
	AskPanel: () => null,
	useAskRouting: () => ({ route: null, awaiting: false, submit: () => {}, cancel: () => {} }),
}));

import { SessionView } from "./SessionView";

let visibility: "visible" | "hidden" = "visible";

function setVisibility(v: "visible" | "hidden") {
	visibility = v;
	document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
	visibility = "visible";
	Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
	h.getTranscript.mockReset();
	h.getTranscript.mockResolvedValue({ items: [], nextOffset: 5, reset: false });
	useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), nextOffset: 5 } } });
	useSessions.setState({
		sessions: { [SID]: { id: SID, status: "external", updatedAt: "2026-01-01T00:00:00Z" } as never },
	});
});

afterEach(cleanup);

describe("SessionView external refresh", () => {
	it("skips re-reads while hidden and catches up once on show", async () => {
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(h.getTranscript).toHaveBeenCalled());

		act(() => setVisibility("hidden"));
		h.getTranscript.mockClear();
		act(() =>
			useSessions.setState({
				sessions: { [SID]: { id: SID, status: "external", updatedAt: "2026-01-01T00:01:00Z" } as never },
			}),
		);
		await new Promise((r) => setTimeout(r, 30));
		expect(h.getTranscript).not.toHaveBeenCalled();

		act(() => setVisibility("visible"));
		await waitFor(() => expect(h.getTranscript).toHaveBeenCalledTimes(1));
	});
});
