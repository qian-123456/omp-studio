// @vitest-environment jsdom
/**
 * Opening a session must not clear its live items first: with a pending echo
 * for a just-sent message, an older history page must not consume that echo.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import { emptySessionLive, useLive } from "../../stores/live";

const SID = "s1";

const h = vi.hoisted(() => ({
	getTranscript: vi.fn(),
}));

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

const userItem = (id: string, text: string) =>
	({
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00Z",
		kind: "user",
		text,
	}) as never;

beforeEach(() => {
	h.getTranscript.mockReset();
	useLive.setState({ sessions: {} });
});

afterEach(cleanup);

describe("SessionView open", () => {
	it("keeps existing items and a pending echo when stale history arrives", async () => {
		const old = userItem("u0", "请继续完成这个任务");
		useLive.setState({
			sessions: { [SID]: { ...emptySessionLive(), alive: true, items: [old], nextOffset: 10 } },
		});
		useLive.getState().addUserEcho(SID, "继续", undefined, true);
		h.getTranscript.mockResolvedValue({ items: [old], nextOffset: 10, reset: false });

		render(<SessionView sessionId={SID} />);
		// Items are never emptied while the transcript is loading.
		expect(useLive.getState().sessions[SID].items).toHaveLength(1);
		await waitFor(() => expect(h.getTranscript).toHaveBeenCalled());
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(1));
		// The older history item does not consume the echo.
		expect(useLive.getState().sessions[SID].pendingUserEchoes).toHaveLength(1);
	});
});
