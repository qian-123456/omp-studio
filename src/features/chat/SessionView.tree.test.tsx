// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptItem, TranscriptPage } from "../../lib/contracts";
import type * as EventsModule from "../../lib/events";
import type * as IpcModule from "../../lib/ipc";
import type { SessionLive } from "../../stores/live";
import { emptySessionLive, useLive } from "../../stores/live";
import { useSessions } from "../../stores/sessions";
import { useTree } from "../../stores/tree";

const SID = "tree-session";
const h = vi.hoisted(() => ({ getTranscript: vi.fn(), getEntries: vi.fn(), treeNavigate: vi.fn(), ensureLive: vi.fn() }));

vi.mock("../../lib/ipc", async (importOriginal) => ({
	...(await importOriginal<typeof IpcModule>()),
	getTranscript: h.getTranscript,
	treeNavigate: h.treeNavigate,
	gitSessionTurns: vi.fn(async () => []),
	rpcPendingUi: vi.fn(async () => []),
	rpcSend: vi.fn(async (_sessionId: string, command: { type: string }) =>
		command.type === "get_entries" ? { data: await h.getEntries() } : {}),
	privacyList: vi.fn(async () => ({ entries: [], nativeStatus: "ok", nativeError: null })),
}));
vi.mock("../../lib/ensureLive", () => ({ ensureLive: h.ensureLive, isResumeCancelled: () => false }));
vi.mock("../../lib/events", async (importOriginal) => ({
	...(await importOriginal<typeof EventsModule>()),
	onTreeNavigated: vi.fn(async () => () => {}),
	onPrivacyChanged: vi.fn(async () => () => {}),
}));
vi.mock("./ChatTrace", () => ({ ChatTrace: () => null }));
vi.mock("./AnnotationMarkers", () => ({ AnnotationMarkers: () => null }));
vi.mock("./Composer", () => ({ Composer: () => null }));
vi.mock("./HeldQueueBar", () => ({ HeldQueueBar: () => null }));
vi.mock("./PendingUiCard", () => ({ PendingUiCard: () => null }));
vi.mock("./SelectionToolbar", () => ({ SelectionToolbar: () => null }));
vi.mock("./share/ShareSelectionBar", () => ({ ShareSelectionBar: () => null }));
vi.mock("./subagents/TopCapsule", () => ({ TopCapsule: () => null }));
vi.mock("./ask/AskPanel", () => ({
	AskPanel: () => null,
	useAskRouting: () => ({ route: null, awaiting: false, submit: () => {}, cancel: () => {} }),
}));

import { SessionView } from "./SessionView";
import { navigateTree, refetchTranscript } from "./treeNav";
import { UserRow } from "./MessageList";
import { TreeResendBanner } from "./TreeResendBanner";
import { useComposer } from "../../stores/composer";
import { useTreeEditPending } from "./treeNav";

function item(id: string, parentId: string | null, kind: TranscriptItem["kind"], text: string | null = null): TranscriptItem {
	return {
		id, parentId, kind, text,
		ts: "2026-01-01T00:00:00Z",
		thinking: null, assistantParts: [], toolCalls: [], toolResult: null,
		usage: null, model: null, stopReason: kind === "assistant" ? "stop" : null,
		images: [], hidden: false, duration: null, ttft: null, completedAt: null,
		firstKeptEntryId: null,
	};
}

const root = item("model-1", null, "model_change");
const model = item("model-2", root.id, "model_change");
const user = item("user-1", model.id, "user", "Shrink the button fill area");
const answer = item("answer-1", user.id, "assistant", "The button fill is smaller now.");
const other = item("answer-2", user.id, "assistant", "An abandoned alternative answer.");
const page = (items: TranscriptItem[], nextOffset = 10): TranscriptPage => ({
	sessionId: SID, items, nextOffset, reset: false, tailId: items[items.length - 1]?.id ?? null,
});

const entries = (items = [root, model, user, answer, other]) => items;

function setLive(patch: Partial<SessionLive>) {
	useLive.setState((state) => ({ sessions: { ...state.sessions, [SID]: { ...state.sessions[SID], ...patch } } }));
}

beforeEach(() => {
	vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
	vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
	vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(800);
	h.getTranscript.mockReset();
	h.getEntries.mockReset();
	h.treeNavigate.mockReset();
	h.ensureLive.mockReset();
	useTreeEditPending.setState({ entries: {} });
	useComposer.setState({ drafts: {} });
	useLive.setState({ sessions: { [SID]: emptySessionLive() } });
	useSessions.setState({ sessions: {} });
	useTree.setState({ leaf: {}, resend: {} });
});

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("SessionView conversation tree history", () => {
	it("does not let a live tree older than disk hide the newest turn after reopening", async () => {
		h.getTranscript.mockResolvedValue(page([root, model, user, answer]));
		h.getEntries.mockResolvedValue({ entries: entries([root, model]), leafId: model.id });
		setLive({ alive: true });
		useTree.getState().setLeaf(SID, model.id);
		const view = render(<SessionView sessionId={SID} />);

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
		view.rerender(<SessionView key="reopened" sessionId={SID} />);
		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("honors an intentional rewind when the tree already knows the later turn", async () => {
		h.getTranscript.mockResolvedValue(page([root, model, user, answer]));
		h.getEntries.mockResolvedValue({ entries: entries(), leafId: model.id });
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(4));
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));

		expect(screen.queryByText(user.text!)).toBeNull();
		expect(screen.queryByText(answer.text!)).toBeNull();
	});

	it("keeps a completed turn visible when the next tree read fails", async () => {
		h.getTranscript.mockResolvedValue(page([root, model]));
		h.getEntries.mockResolvedValue({ entries: entries([root, model]), leafId: model.id });
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));

		h.getTranscript.mockResolvedValue(page([user, answer], 20));
		h.getEntries.mockRejectedValue(new Error("RPC disconnected"));
		act(() => {
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_start" } });
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_end" } });
		});

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("shows the first persisted user and answer after a stream advances the leaf", async () => {
		let leaf = model.id;
		h.getEntries.mockImplementation(async () => ({ entries: entries(), leafId: leaf }));
		h.getTranscript.mockImplementation(async (_sid: string, offset?: number) =>
			offset === undefined ? page([root, model]) : page([user, answer], 20),
		);
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));

		act(() => setLive({ streaming: true }));
		leaf = answer.id; // Upstream advances its current leaf on append, without a navigation event.
		act(() => setLive({ streaming: false }));

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("commits a turn whose start and end arrive before the next render", async () => {
		let leaf = model.id;
		h.getEntries.mockImplementation(async () => ({ entries: entries(), leafId: leaf }));
		h.getTranscript.mockImplementation(async (_sid: string, offset?: number) =>
			offset === undefined ? page([root, model]) : page([user, answer], 20),
		);
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));

		leaf = answer.id;
		act(() => {
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_start" } });
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_end" } });
		});

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("does not replace a committed answer with an older initial history response", async () => {
		let resolveInitial!: (value: TranscriptPage) => void;
		let leaf = model.id;
		h.getTranscript.mockImplementationOnce(() => new Promise<TranscriptPage>((resolve) => {
			resolveInitial = resolve;
		}));
		h.getTranscript.mockResolvedValue(page([user, answer], 20));
		h.getEntries.mockImplementation(async () => ({ entries: entries(), leafId: leaf }));
		setLive({ alive: true, items: [root, model], nextOffset: 10 });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));

		act(() => useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_start" } }));
		leaf = answer.id;
		act(() => useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_end" } }));
		await waitFor(() => expect(useLive.getState().sessions[SID].items.some((entry) => entry.id === answer.id)).toBe(true));
		await act(async () => { resolveInitial(page([root, model])); });

		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("keeps a newer answer when a separate navigation reader returns late", async () => {
		let leaf = model.id;
		h.getTranscript.mockResolvedValue(page([root, model]));
		h.getEntries.mockImplementation(async () => ({ entries: entries(), leafId: leaf }));
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));

		let resolveNavigation!: (value: TranscriptPage) => void;
		h.getTranscript.mockImplementationOnce(() => new Promise<TranscriptPage>((resolve) => {
			resolveNavigation = resolve;
		}));
		const navigating = refetchTranscript(SID);
		h.getTranscript.mockResolvedValue(page([user, answer], 20));
		leaf = answer.id;
		act(() => {
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_start" } });
			useLive.getState().reduceFrame({ sessionId: SID, frame: { type: "agent_end" } });
		});
		expect(await screen.findByText(answer.text!)).toBeTruthy();

		await act(async () => {
			resolveNavigation(page([root, model]));
			await navigating;
		});
		expect(screen.getByText(user.text!)).toBeTruthy();
		expect(screen.getByText(answer.text!)).toBeTruthy();
	});

	it("refreshes a cached pre-prompt leaf when a mounted cold session reconnects", async () => {
		h.getTranscript.mockResolvedValue(page([root, model, user, answer, other]));
		h.getEntries.mockResolvedValue({ entries: entries(), leafId: answer.id });
		useTree.getState().setLeaf(SID, model.id);
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(5));

		act(() => setLive({ alive: true }));
		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
		await waitFor(() => expect(screen.queryByText(other.text!)).toBeNull());
	});

	it("does not hide persisted history behind a stale leaf after suspension", async () => {
		h.getTranscript.mockResolvedValue(page([root, model]));
		h.getEntries.mockResolvedValue({ entries: entries(), leafId: model.id });
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(model.id));
		await waitFor(() => expect(useLive.getState().sessions[SID].items).toHaveLength(2));

		act(() => setLive({ alive: false, items: [root, model, user, answer] }));
		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
	});

	it("ignores an idle tree response that arrives after suspension", async () => {
		// The project's ES2021 library does not provide Promise.withResolvers.
		let resolveTree!: (value: { entries: TranscriptItem[]; leafId: string }) => void;
		h.getEntries.mockImplementation(() => new Promise<{ entries: TranscriptItem[]; leafId: string }>((resolve) => { resolveTree = resolve; }));
		h.getTranscript.mockResolvedValue(page([root, model, user, answer]));
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		await waitFor(() => expect(h.getEntries).toHaveBeenCalled());
		expect(await screen.findByText(answer.text!)).toBeTruthy();

		act(() => setLive({ alive: false }));
		await act(async () => { resolveTree({ entries: entries(), leafId: model.id }); });
		expect(screen.getByText(user.text!)).toBeTruthy();
		expect(screen.getByText(answer.text!)).toBeTruthy();
	});

	it("keeps an explicitly navigated branch rather than choosing the file tail", async () => {
		let leaf = other.id;
		h.getTranscript.mockResolvedValue(page([root, model, user, answer, other]));
		h.getEntries.mockImplementation(async () => ({ entries: entries(), leafId: leaf }));
		h.treeNavigate.mockImplementation(async (_sid: string, entryId: string) => {
			leaf = entryId;
			return { cancelled: false };
		});
		setLive({ alive: true });
		render(<SessionView sessionId={SID} />);
		expect(await screen.findByText(other.text!)).toBeTruthy();
		await waitFor(() => expect(screen.queryByText(answer.text!)).toBeNull());

		await act(async () => { await navigateTree(SID, answer.id); });
		expect(await screen.findByText(user.text!)).toBeTruthy();
		expect(await screen.findByText(answer.text!)).toBeTruthy();
		expect(screen.queryByText(other.text!)).toBeNull();
	});

	it("cancels a cold pencil edit back to the canonical branch, not a null cache or history tail", async () => {
		let leaf = answer.id;
		const history = [root, model, user, answer, other];
		setLive({ alive: false, items: history });
		useTree.getState().setLeaf(SID, null);
		h.ensureLive.mockImplementation(async () => { setLive({ alive: true }); });
		h.getTranscript.mockResolvedValue(page(history));
		h.getEntries.mockImplementation(async () => {
			expect(useLive.getState().sessions[SID].alive).toBe(true);
			return { entries: history, leafId: leaf };
		});
		h.treeNavigate.mockImplementation(async (_sid: string, entryId: string) => {
			leaf = entryId === user.id ? model.id : entryId;
			return { cancelled: false, editorText: entryId === user.id ? user.text : undefined };
		});
		render(<><UserRow sessionId={SID} item={user} /><TreeResendBanner sessionId={SID} /></>);

		fireEvent.click(screen.getByRole("button", { name: /编辑并重新发送|Edit and resend/ }));
		await waitFor(() => expect(useComposer.getState().drafts[SID]).toBe(user.text));
		expect(h.ensureLive).toHaveBeenCalledWith(SID);
		expect(useTree.getState().resend[SID]?.prevLeafId).toBe(answer.id);
		expect(useTreeEditPending.getState().entries[SID]).toBeUndefined();
		expect(leaf).toBe(model.id);

		fireEvent.click(screen.getByRole("button", { name: /^(取消|Cancel)$/ }));
		await waitFor(() => expect(h.treeNavigate).toHaveBeenLastCalledWith(SID, answer.id));
		await waitFor(() => expect(useTree.getState().leaf[SID]).toBe(answer.id));
		expect(leaf).toBe(answer.id);
		expect(leaf).not.toBe(history[history.length - 1].id);
		expect(useTree.getState().resend[SID]).toBeUndefined();
		expect(screen.queryByRole("button", { name: /^(取消|Cancel)$/ })).toBeNull();
	});
});
