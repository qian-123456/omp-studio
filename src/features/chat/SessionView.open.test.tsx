// @vitest-environment jsdom
/**
 * Opening a session must not clear its live items first: with a pending echo
 * for a just-sent message, an older history page must not consume that echo.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as IpcModule from "../../lib/ipc";
import type * as SendModule from "./send";
import { emptySessionLive, useLive } from "../../stores/live";

const SID = "s1";

const h = vi.hoisted(() => ({
	getTranscript: vi.fn(),
	rpcPendingUi: vi.fn(),
	abortTurn: vi.fn(async () => {}),
}));

vi.mock("../../lib/ipc", async (importOriginal) => {
	const orig = await importOriginal<typeof IpcModule>();
	return {
		...orig,
		getTranscript: h.getTranscript,
		gitSessionTurns: vi.fn(async () => []),
		rpcPendingUi: h.rpcPendingUi,
		rpcSend: vi.fn(async () => ({})),
	};
});
vi.mock("../../lib/events", () => ({
	onTreeNavigated: async () => () => {},
}));
vi.mock("./ChatTrace", () => ({ ChatTrace: () => null }));
vi.mock("./AnnotationMarkers", () => ({ AnnotationMarkers: () => null }));
vi.mock("./Composer", () => ({ Composer: ({ sessionId }: { sessionId: string }) => <textarea data-testid={`composer-${sessionId}`} data-composer={sessionId} /> }));
vi.mock("./HeldQueueBar", () => ({ HeldQueueBar: () => null }));
vi.mock("./MessageList", () => ({ MessageList: () => null }));
vi.mock("./PendingUiCard", () => ({ PendingUiCard: ({ req }: { req: { request?: { id?: string } } }) => <div>{req.request?.id}</div> }));
vi.mock("./SelectionToolbar", () => ({ SelectionToolbar: () => null }));
vi.mock("./share/ShareSelectionBar", () => ({ ShareSelectionBar: () => null }));
vi.mock("./subagents/TopCapsule", () => ({ TopCapsule: () => null }));
vi.mock("./ask/AskPanel", () => ({
	AskPanel: () => null,
	useAskRouting: () => ({ route: null, awaiting: false, submit: () => {}, cancel: () => {} }),
}));

vi.mock("./send", async (importOriginal) => ({ ...(await importOriginal<typeof SendModule>()), abortTurn: h.abortTurn }));
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
	h.rpcPendingUi.mockReset().mockResolvedValue([]);
	h.abortTurn.mockClear();
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

	it("a slow pending-dialog snapshot cannot resurrect an answered dialog", async () => {
		let finish!: (list: unknown[]) => void;
		h.getTranscript.mockResolvedValue({ items: [], nextOffset: 0, reset: false });
		h.rpcPendingUi.mockReturnValueOnce(new Promise<unknown[]>((resolve) => { finish = resolve; }));
		useLive.setState({ sessions: { [SID]: { ...emptySessionLive(), alive: true, streaming: true } } });
		render(<SessionView sessionId={SID} />);
		act(() => {
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "extension_ui_request", id: "old-dialog", method: "confirm" } });
			useLive.getState().dismissUi(SID, "old-dialog");
		});
		await act(async () => { finish([{ sessionId: SID, request: { id: "old-dialog", method: "confirm" }, receivedAt: "t" }]); });
		expect(useLive.getState().sessions[SID].pendingUi).toEqual([]);
		expect(screen.queryByText("old-dialog")).toBeNull();
	});

	it("Escape in a side composer never interrupts the main session", async () => {
		h.getTranscript.mockResolvedValue({ items: [], nextOffset: 0, reset: false });
		useLive.setState({ sessions: {
			main: { ...emptySessionLive(), alive: true, streaming: true },
			side: { ...emptySessionLive(), alive: true, streaming: true },
		} });
		render(<><SessionView sessionId="main" /><SessionView sessionId="side" compact /></>);
		const side = screen.getByTestId("composer-side");
		side.focus();
		fireEvent.keyDown(side, { key: "Escape" });
		expect(h.abortTurn).not.toHaveBeenCalled();
		const main = screen.getByTestId("composer-main");
		main.focus();
		fireEvent.keyDown(main, { key: "Escape" });
		await waitFor(() => expect(h.abortTurn).toHaveBeenCalledExactlyOnceWith("main"));
	});
});
